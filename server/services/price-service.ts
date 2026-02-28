/**
 * Price Service
 * 
 * Provides real-time cryptocurrency prices from external APIs.
 * 
 * PHILOSOPHY: Everything MUST be real. No fake/mocked data.
 * If prices are unavailable, we clearly indicate that rather than fake it.
 */

import { createLogger } from '../lib/logger';
import { Gauge } from 'prom-client';
import { getMetricsRegistry } from '../metrics/prometheus';

const logger = createLogger('price-service');

// Prometheus metric for price feed monitoring
const register = getMetricsRegistry();
const priceFeedLastUpdate = new Gauge({
  name: 'price_feed_last_update_timestamp',
  help: 'Unix timestamp of the last price feed update',
  registers: [register],
});

// Initialize to current time so alert doesn't fire on startup
priceFeedLastUpdate.set(Date.now() / 1000);

export interface PriceData {
  symbol: string;
  price: number;
  source: string;
  timestamp: Date;
}

export interface PriceServiceStatus {
  connected: boolean;
  source: string;
  lastUpdate: Date | null;
  availableAssets: string[];
}

// Cache for prices with TTL
const priceCache: Map<string, PriceData> = new Map();
const CACHE_TTL_MS = 60000; // 1 minute cache

// Rate-limiting for price update logs (avoid spamming logs every second)
const lastLoggedPrice: Map<string, { price: number; time: number }> = new Map();
const LOG_INTERVAL_MS = 30000; // Only log same price every 30 seconds
const PRICE_CHANGE_THRESHOLD = 0.001; // Log if price changes by 0.1%

// Service status
let serviceStatus: PriceServiceStatus = {
  connected: false,
  source: 'none',
  lastUpdate: null,
  availableAssets: [],
};

// Stable coin prices (these are pegged, not variable)
const STABLE_PRICES: Record<string, number> = {
  USDT: 1.00,
  USDC: 1.00,
  USD: 1.00,
};

/**
 * Price Service - Real prices only, no fakes
 */
export const priceService = {
  /**
   * Get current price for an asset
   * Returns null if price is not available (NOT a fake price)
   */
  getPrice(symbol: string): PriceData | null {
    const upperSymbol = symbol.toUpperCase();

    // Stable coins have fixed prices
    if (STABLE_PRICES[upperSymbol] !== undefined) {
      return {
        symbol: upperSymbol,
        price: STABLE_PRICES[upperSymbol],
        source: 'stable-peg',
        timestamp: new Date(),
      };
    }

    // Check cache
    const cached = priceCache.get(upperSymbol);
    if (cached) {
      const age = Date.now() - cached.timestamp.getTime();
      if (age < CACHE_TTL_MS) {
        return cached;
      }
      // Cache expired, remove it
      priceCache.delete(upperSymbol);
    }

    // No cached price available
    return null;
  },

  /**
   * Get exchange rate between two assets
   * Returns null if either price is unavailable
   */
  getRate(fromSymbol: string, toSymbol: string): number | null {
    const fromPrice = this.getPrice(fromSymbol);
    const toPrice = this.getPrice(toSymbol);

    if (!fromPrice || !toPrice) {
      return null;
    }

    if (toPrice.price === 0) {
      return null;
    }

    return fromPrice.price / toPrice.price;
  },

  /**
   * Check if prices are available for trading
   */
  isPriceAvailable(symbol: string): boolean {
    return this.getPrice(symbol) !== null;
  },

  /**
   * Get service status
   */
  getStatus(): PriceServiceStatus {
    return { ...serviceStatus };
  },

  /**
   * Update price from external source
   * Called by WebSocket handlers or polling mechanisms
   */
  updatePrice(symbol: string, price: number, source: string): void {
    const upperSymbol = symbol.toUpperCase();

    const priceData: PriceData = {
      symbol: upperSymbol,
      price,
      source,
      timestamp: new Date(),
    };

    priceCache.set(upperSymbol, priceData);

    // Update Prometheus metric for alerting
    const updateTime = Date.now();
    priceFeedLastUpdate.set(updateTime / 1000);  // Unix timestamp in seconds

    serviceStatus.lastUpdate = new Date();
    if (!serviceStatus.availableAssets.includes(upperSymbol)) {
      serviceStatus.availableAssets.push(upperSymbol);
      // Always log first price for an asset
      logger.info(`Price feed started: ${upperSymbol} = $${price.toFixed(2)} (${source})`);
      lastLoggedPrice.set(upperSymbol, { price, time: Date.now() });
      return;
    }

    // Rate-limited logging: only log on significant change or time interval
    const lastLogged = lastLoggedPrice.get(upperSymbol);
    const now = Date.now();
    const shouldLog = !lastLogged ||
      (now - lastLogged.time > LOG_INTERVAL_MS) ||
      (Math.abs(price - lastLogged.price) / lastLogged.price > PRICE_CHANGE_THRESHOLD);

    if (shouldLog) {
      const changeStr = lastLogged
        ? ` (${((price - lastLogged.price) / lastLogged.price * 100).toFixed(2)}%)`
        : '';
      logger.debug(`Price: ${upperSymbol} = $${price.toFixed(2)}${changeStr}`);
      lastLoggedPrice.set(upperSymbol, { price, time: now });
    }
  },

  /**
   * Set service connection status
   */
  setConnected(connected: boolean, source: string): void {
    serviceStatus.connected = connected;
    serviceStatus.source = source;
    logger.info(`Price service ${connected ? 'connected' : 'disconnected'}: ${source}`);
  },

  /**
   * Clear all cached prices (for testing/reset)
   */
  clearCache(): void {
    priceCache.clear();
    serviceStatus.availableAssets = [];
    serviceStatus.lastUpdate = null;
  },

  /**
   * Get all available prices
   */
  getAllPrices(): PriceData[] {
    const prices: PriceData[] = [];

    // Add stable coins
    for (const [symbol, price] of Object.entries(STABLE_PRICES)) {
      prices.push({
        symbol,
        price,
        source: 'stable-peg',
        timestamp: new Date(),
      });
    }

    // Add cached prices
    for (const priceData of Array.from(priceCache.values())) {
      const age = Date.now() - priceData.timestamp.getTime();
      if (age < CACHE_TTL_MS) {
        prices.push(priceData);
      }
    }

    return prices;
  },
};

export default priceService;
