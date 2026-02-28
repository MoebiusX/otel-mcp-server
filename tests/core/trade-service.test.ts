/**
 * Trade Service Unit Tests
 * 
 * Tests for crypto conversions, quotes, and trading pairs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/db', () => ({
  default: {
    query: vi.fn(),
    transaction: vi.fn((fn) => fn({
      query: vi.fn(),
    })),
  },
}));

vi.mock('../../server/wallet/wallet-service', () => ({
  walletService: {
    getWallet: vi.fn(),
  },
}));

vi.mock('../../server/services/price-service', () => ({
  priceService: {
    getPrice: vi.fn(),
    isPriceAvailable: vi.fn(),
    getRate: vi.fn(),
  },
}));

vi.mock('../../server/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { tradeService, TRADING_PAIRS, type ConvertQuote } from '../../server/trade/trade-service';
import { priceService } from '../../server/services/price-service';
import { walletService } from '../../server/wallet/wallet-service';
import db from '../../server/db';

describe('Trade Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('TRADING_PAIRS', () => {
    it('should include BTC/USD pair', () => {
      expect(TRADING_PAIRS).toContain('BTC/USD');
    });

    it('should include ETH/USD pair', () => {
      expect(TRADING_PAIRS).toContain('ETH/USD');
    });

    it('should include BTC/USDT pair', () => {
      expect(TRADING_PAIRS).toContain('BTC/USDT');
    });

    it('should include ETH/BTC pair', () => {
      expect(TRADING_PAIRS).toContain('ETH/BTC');
    });

    it('should have at least 5 trading pairs', () => {
      expect(TRADING_PAIRS.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('getPrice', () => {
    it('should return price from price service', () => {
      vi.mocked(priceService.getPrice).mockReturnValue({
        symbol: 'BTC',
        price: 42500,
        source: 'binance',
        timestamp: new Date(),
      });

      const price = tradeService.getPrice('BTC');

      expect(priceService.getPrice).toHaveBeenCalledWith('BTC');
      expect(price).toBe(42500);
    });

    it('should return null if price not available', () => {
      vi.mocked(priceService.getPrice).mockReturnValue(null);

      const price = tradeService.getPrice('UNKNOWN');

      expect(price).toBeNull();
    });
  });

  describe('isPriceAvailable', () => {
    it('should return true when price is available', () => {
      vi.mocked(priceService.isPriceAvailable).mockReturnValue(true);

      const available = tradeService.isPriceAvailable('BTC');

      expect(priceService.isPriceAvailable).toHaveBeenCalledWith('BTC');
      expect(available).toBe(true);
    });

    it('should return false when price is not available', () => {
      vi.mocked(priceService.isPriceAvailable).mockReturnValue(false);

      const available = tradeService.isPriceAvailable('FAKE');

      expect(available).toBe(false);
    });
  });

  describe('getRate', () => {
    it('should return rate from price service', () => {
      vi.mocked(priceService.getRate).mockReturnValue(42500);

      const rate = tradeService.getRate('BTC', 'USD');

      expect(priceService.getRate).toHaveBeenCalledWith('BTC', 'USD');
      expect(rate).toBe(42500);
    });

    it('should return null if rate not available', () => {
      vi.mocked(priceService.getRate).mockReturnValue(null);

      const rate = tradeService.getRate('UNKNOWN', 'USD');

      expect(rate).toBeNull();
    });
  });

  describe('getConvertQuote', () => {
    it('should return valid quote when rate is available', () => {
      vi.mocked(priceService.getRate).mockReturnValue(42500);

      const quote = tradeService.getConvertQuote('BTC', 'USD', 1);

      expect(quote.fromAsset).toBe('BTC');
      expect(quote.toAsset).toBe('USD');
      expect(quote.fromAmount).toBe(1);
      expect(quote.rate).toBe(42500);
    });

    it('should calculate fee correctly (0.1%)', () => {
      vi.mocked(priceService.getRate).mockReturnValue(42500);

      const quote = tradeService.getConvertQuote('BTC', 'USD', 1);

      // 1 BTC * 42500 = 42500 USD
      // Fee = 42500 * 0.001 = 42.5
      expect(quote.fee).toBe(42.5);
      expect(quote.toAmount).toBe(42500 - 42.5);
    });

    it('should calculate to amount after fee', () => {
      vi.mocked(priceService.getRate).mockReturnValue(10000);

      const quote = tradeService.getConvertQuote('ETH', 'USD', 2);

      // 2 ETH * 10000 = 20000 USD
      // Fee = 20000 * 0.001 = 20
      // toAmount = 20000 - 20 = 19980
      expect(quote.toAmount).toBe(19980);
    });

    it('should throw error when rate is not available', () => {
      vi.mocked(priceService.getRate).mockReturnValue(null);

      expect(() => {
        tradeService.getConvertQuote('FAKE', 'USD', 1);
      }).toThrow(/Price not available/);
    });

    it('should set expiration 30 seconds in future', () => {
      vi.mocked(priceService.getRate).mockReturnValue(42500);
      const before = Date.now();

      const quote = tradeService.getConvertQuote('BTC', 'USD', 1);

      const after = Date.now();
      const expiresAt = quote.expiresAt.getTime();
      
      expect(expiresAt).toBeGreaterThanOrEqual(before + 29000);
      expect(expiresAt).toBeLessThanOrEqual(after + 31000);
    });

    it('should uppercase asset symbols', () => {
      vi.mocked(priceService.getRate).mockReturnValue(42500);

      const quote = tradeService.getConvertQuote('btc', 'usd', 1);

      expect(quote.fromAsset).toBe('BTC');
      expect(quote.toAsset).toBe('USD');
    });
  });

  describe('getPairs', () => {
    it('should return all trading pairs with prices', () => {
      vi.mocked(priceService.getRate).mockReturnValue(42500);

      const pairs = tradeService.getPairs();

      expect(pairs.length).toBe(TRADING_PAIRS.length);
      pairs.forEach(pair => {
        expect(pair).toHaveProperty('pair');
        expect(pair).toHaveProperty('price');
        expect(pair).toHaveProperty('change24h');
      });
    });

    it('should use 0 for null rates', () => {
      vi.mocked(priceService.getRate).mockReturnValue(null);

      const pairs = tradeService.getPairs();

      pairs.forEach(pair => {
        expect(pair.price).toBe(0);
      });
    });

    it('should generate change24h between -5% and +5%', () => {
      vi.mocked(priceService.getRate).mockReturnValue(42500);

      const pairs = tradeService.getPairs();

      pairs.forEach(pair => {
        expect(pair.change24h).toBeGreaterThanOrEqual(-5);
        expect(pair.change24h).toBeLessThanOrEqual(5);
      });
    });
  });
});

describe('Trade Fee Calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should apply 0.1% fee consistently', () => {
    const testCases = [
      { amount: 1, rate: 42500, expectedFee: 42.5 },
      { amount: 0.5, rate: 42500, expectedFee: 21.25 },
      { amount: 10, rate: 3000, expectedFee: 30 },
      { amount: 100, rate: 1, expectedFee: 0.1 },
    ];

    testCases.forEach(({ amount, rate, expectedFee }) => {
      vi.mocked(priceService.getRate).mockReturnValue(rate);
      const quote = tradeService.getConvertQuote('TEST', 'USD', amount);
      expect(quote.fee).toBe(expectedFee);
    });
  });
});
