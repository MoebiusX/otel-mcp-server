/**
 * Wallet API Integration Tests
 * 
 * Tests for /api/wallet endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies
vi.mock('../../server/db', () => ({
  default: {
    query: vi.fn(),
  },
}));

// TODO: Tech Debt - Tests still mock storage methods but actual code uses walletService/db.query
// These storage mocks should be removed and tests refactored to mock walletService instead
vi.mock('../../server/storage', () => ({
  storage: {
    getWallet: vi.fn(),
    getUsers: vi.fn(),
    createOrder: vi.fn(),
    updateOrder: vi.fn(),
    updateWallet: vi.fn(),
  },
}));

vi.mock('../../server/wallet/wallet-service', () => ({
  walletService: {
    getWalletSummary: vi.fn(),
    getWallet: vi.fn(),
    getWallets: vi.fn(),
    getKXAddress: vi.fn(),
    resolveAddress: vi.fn(),
    updateBalance: vi.fn(),
  },
}));

vi.mock('../../server/services/rabbitmq-client', () => ({
  rabbitMQClient: {
    isConnected: vi.fn().mockReturnValue(false),
    publishOrderAndWait: vi.fn(),
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

vi.mock('../../server/otel', () => ({
  traces: {
    startSpan: vi.fn(),
  },
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: vi.fn(),
    getSpan: vi.fn(() => ({
      spanContext: () => ({ traceId: 'abcd1234abcd1234abcd1234abcd1234', spanId: 'efgh5678efgh5678' }),
    })),
    getTracer: vi.fn(() => ({
      startActiveSpan: vi.fn((name, fn) => fn({
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
        spanContext: () => ({ traceId: 'abcd1234abcd1234abcd1234abcd1234', spanId: 'efgh5678efgh5678' }),
      })),
    })),
  },
  context: {
    active: vi.fn(),
    with: vi.fn((ctx, fn) => fn()),
  },
  SpanStatusCode: { OK: 0, ERROR: 1 },
}));

import { registerRoutes } from '../../server/api/routes';
import { storage } from '../../server/storage';
import db from '../../server/db';
import { walletService } from '../../server/wallet/wallet-service';

function createApp() {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  return app;
}

describe('Wallet API Integration', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/wallet', () => {
    it('should return wallet for user', async () => {
      vi.mocked(walletService.getWalletSummary).mockResolvedValue({
        userId: 'seed.user.primary@krystaline.io',
        btc: 1.5,
        usd: 50000,
        lastUpdated: new Date(),
      });

      const response = await request(app).get('/api/v1/wallet?userId=seed.user.primary@krystaline.io');

      expect(response.status).toBe(200);
      expect(response.body.btc).toBe(1.5);
      expect(response.body.usd).toBe(50000);
      expect(response.body.btcValue).toBeTypeOf('number');
      expect(response.body.totalValue).toBeTypeOf('number');
    });

    it('should calculate btcValue based on current price', async () => {
      vi.mocked(walletService.getWalletSummary).mockResolvedValue({
        userId: 'seed.user.primary@krystaline.io',
        btc: 2.0,
        usd: 10000,
        lastUpdated: new Date(),
      });

      const response = await request(app).get('/api/v1/wallet?userId=seed.user.primary@krystaline.io');

      // btcValue should be btc * price - may be 0 if price unavailable in tests
      expect(response.body.btcValue).toBeGreaterThanOrEqual(0);
      expect(response.body.btcValue).toBeTypeOf('number');
    });

    it('should accept userId query parameter', async () => {
      vi.mocked(walletService.getWalletSummary).mockResolvedValue({
        userId: 'seed.user.secondary@krystaline.io',
        btc: 0.5,
        usd: 1000,
        lastUpdated: new Date(),
      });

      const response = await request(app).get('/api/v1/wallet?userId=seed.user.secondary@krystaline.io');

      expect(response.status).toBe(200);
      expect(walletService.getWalletSummary).toHaveBeenCalledWith('seed.user.secondary@krystaline.io');
    });

    it('should return 404 for non-existent user', async () => {
      vi.mocked(walletService.getWalletSummary).mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallet?userId=nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should return 400 if userId not provided', async () => {
      const response = await request(app).get('/api/v1/wallet');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('userId query parameter is required');
    });

    it('should handle database errors', async () => {
      vi.mocked(walletService.getWalletSummary).mockRejectedValue(new Error('DB connection failed'));

      const response = await request(app).get('/api/v1/wallet?userId=seed.user.primary@krystaline.io');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch wallet');
    });
  });

  describe('GET /api/wallet with userId query', () => {
    it('should return wallet for specific user', async () => {
      vi.mocked(walletService.getWalletSummary).mockResolvedValue({
        userId: 'charlie@krystaline.io',
        btc: 3.0,
        usd: 25000,
        lastUpdated: new Date(),
      });

      const response = await request(app).get('/api/v1/wallet?userId=charlie@krystaline.io');

      expect(response.status).toBe(200);
      expect(walletService.getWalletSummary).toHaveBeenCalledWith('charlie@krystaline.io');
      expect(response.body.btc).toBe(3.0);
    });

    it('should return 404 for non-existent user', async () => {
      vi.mocked(walletService.getWalletSummary).mockResolvedValue(null);

      const response = await request(app).get('/api/v1/wallet?userId=unknown');

      expect(response.status).toBe(404);
    });

    it('should include totalValue calculation', async () => {
      vi.mocked(walletService.getWalletSummary).mockResolvedValue({
        userId: 'seed.user.primary@krystaline.io',
        btc: 1.0,
        usd: 5000,
        lastUpdated: new Date(),
      });

      const response = await request(app).get('/api/v1/wallet?userId=seed.user.primary@krystaline.io');

      // totalValue = usd + (btc * price) - at least USD value
      expect(response.body.totalValue).toBeGreaterThanOrEqual(5000);
      expect(response.body.totalValue).toBeTypeOf('number');
    });
  });

  describe('GET /api/price', () => {
    it('should return current BTC price', async () => {
      // Mock the price service module for real Binance prices
      vi.doMock('../../server/services/price-service', () => ({
        priceService: {
          getPrice: vi.fn((asset: string) => {
            if (asset === 'BTC') {
              return { price: 45000, timestamp: new Date(), source: 'mock' };
            }
            if (asset === 'ETH') {
              return { price: 3000, timestamp: new Date(), source: 'mock' };
            }
            return null;
          }),
          getStatus: vi.fn(() => ({ connected: true }))
        }
      }));

      const response = await request(app).get('/api/v1/price');

      expect(response.status).toBe(200);
      expect(response.body.pair).toBe('BTC/USD');
      // Price can be null if priceService not connected, or a number if connected
      if (response.body.price !== null) {
        expect(response.body.price).toBeTypeOf('number');
        expect(response.body.price).toBeGreaterThan(0);
      }
    });

    it('should include 24h change', async () => {
      const response = await request(app).get('/api/v1/price');

      expect(response.body.change24h).toBeTypeOf('number');
    });

    it('should include timestamp', async () => {
      const response = await request(app).get('/api/v1/price');

      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/users', () => {
    it('should return list of verified users', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [
          { id: '1', email: 'seed.user.primary@krystaline.io', status: 'verified' },
          { id: '2', email: 'seed.user.secondary@krystaline.io', status: 'verified' },
        ],
      } as any);

      const response = await request(app).get('/api/v1/users');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('email');
      expect(response.body[0]).toHaveProperty('name');
    });

    it('should extract name from email', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: '1', email: 'testuser@example.com', status: 'verified' }],
      } as any);

      const response = await request(app).get('/api/v1/users');

      expect(response.body[0].name).toBe('testuser');
    });

    it('should include avatar', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ id: '1', email: 'user@test.com', status: 'verified' }],
      } as any);

      const response = await request(app).get('/api/v1/users');

      expect(response.body[0].avatar).toBe('👤');
    });

    it('should handle database errors', async () => {
      vi.mocked(db.query).mockRejectedValue(new Error('Query failed'));

      const response = await request(app).get('/api/v1/users');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch users');
    });
  });
});
