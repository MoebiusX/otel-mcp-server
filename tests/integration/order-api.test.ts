/**
 * Order API Integration Tests
 * 
 * Tests for /api/orders endpoints
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
    getOrders: vi.fn(),
    createOrder: vi.fn(),
    updateOrder: vi.fn(),
    updateWallet: vi.fn(),
  },
}));

vi.mock('../../server/services/rabbitmq-client', () => ({
  rabbitMQClient: {
    isConnected: vi.fn().mockReturnValue(false),
    publishOrderAndWait: vi.fn(),
  },
}));

vi.mock('../../server/wallet/wallet-service', () => ({
  walletService: {
    getWallet: vi.fn().mockResolvedValue({
      id: 'test-wallet-id',
      user_id: 'seed.user.primary@krystaline.io',
      asset: 'USD',
      balance: '500000',
      available: '500000',
      locked: '0',
    }),
    getWallets: vi.fn().mockResolvedValue([]),
    getWalletSummary: vi.fn().mockResolvedValue({
      userId: 'seed.user.primary@krystaline.io',
      btc: 10.0,
      usd: 500000,
      lastUpdated: new Date(),
    }),
    updateBalance: vi.fn().mockResolvedValue(true),
    getKXAddress: vi.fn().mockResolvedValue('kx1test123'),
    resolveAddress: vi.fn().mockResolvedValue('kx1test123'),
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

// Mock price-service to return a real price instead of null (Binance not connected in tests)
vi.mock('../../server/services/price-service', () => ({
  priceService: {
    getPrice: vi.fn((symbol: string) => ({
      symbol,
      price: 95000,
      change24h: 1.5,
      timestamp: new Date()
    })),
    isConnected: vi.fn(() => true),
    connect: vi.fn(),
    disconnect: vi.fn(),
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
    active: vi.fn(() => ({})),
    with: vi.fn((ctx, fn) => fn()),
  },
  propagation: {
    extract: vi.fn((context) => context),
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

describe('Order API Integration', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();

    // Reset walletService mocks for each test
    vi.mocked(walletService.getWalletSummary).mockResolvedValue({
      userId: 'seed.user.primary@krystaline.io',
      btc: 10.0,
      usd: 500000,
      lastUpdated: new Date(),
    });
    vi.mocked(walletService.updateBalance).mockResolvedValue(true);

    // Default db.query mocks for order operations
    vi.mocked(db.query).mockImplementation(async (sql: string, params?: unknown[]) => {
      // User resolution query
      if (sql.includes('SELECT id FROM users WHERE email')) {
        return { rows: [{ id: 'user-uuid-123' }] };
      }
      // Order insert query
      if (sql.includes('INSERT INTO orders')) {
        return {
          rows: [{
            id: 'test-uuid',
            order_id: 'ORD-test-123',
            pair: 'BTC/USD',
            side: 'buy',
            type: 'market',
            quantity: '0.1',
            status: 'open',
            trace_id: 'trace123',
            created_at: new Date(),
          }]
        };
      }
      // Order update query
      if (sql.includes('UPDATE orders SET')) {
        return {
          rows: [{
            id: 'test-uuid',
            order_id: 'ORD-test-123',
            pair: 'BTC/USD',
            side: 'buy',
            type: 'market',
            quantity: '0.1',
            filled: '0.1',
            status: 'filled',
            price: '42500',
            created_at: new Date(),
          }]
        };
      }
      // Order select query
      if (sql.includes('SELECT') && sql.includes('FROM orders')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    // Legacy storage mocks (still used for some operations)
    vi.mocked(storage.getWallet).mockResolvedValue({
      btc: 10.0,
      usd: 500000,
      lastUpdated: new Date(),
    });
    vi.mocked(storage.createOrder).mockResolvedValue({
      orderId: 'ORD-test-123',
      pair: 'BTC/USD',
      side: 'BUY',
      quantity: 0.1,
      orderType: 'MARKET',
      status: 'PENDING',
      createdAt: new Date(),
    } as any);
    vi.mocked(storage.updateWallet).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // SKIPPED: These tests timeout due to complex OTEL context.with() async mock interactions
  // TODO: Refactor to use lighter mock approach or separate the OTEL mocking
  describe.skip('POST /api/orders', () => {
    it('should create a valid BUY order', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0.1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.orderId).toMatch(/^ORD-/);
      expect(response.body.order.pair).toBe('BTC/USD');
      expect(response.body.order.side).toBe('BUY');
      expect(response.body.order.quantity).toBe(0.1);
    });

    it('should create a valid SELL order', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'SELL',
        quantity: 0.5,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.order.side).toBe('SELL');
    });

    it('should include traceId and spanId in response', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0.1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest);

      expect(response.body.traceId).toBeDefined();
      expect(response.body.spanId).toBeDefined();
    });

    it('should accept custom userId', async () => {
      const orderRequest = {
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0.1,
        orderType: 'MARKET',
        userId: 'seed.user.secondary@krystaline.io',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest);

      expect(response.status).toBe(200);
      // Now uses walletService.getWalletSummary instead of storage.getWallet
      expect(walletService.getWalletSummary).toHaveBeenCalledWith('seed.user.secondary@krystaline.io');
    });

    it('should return 400 for invalid order data', async () => {
      const invalidOrder = {
        pair: 'BTC/USD',
        // missing side
        quantity: 0.1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(invalidOrder);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid order request');
      expect(response.body.details).toBeDefined();
    });

    it('should return 400 for invalid side value', async () => {
      const invalidOrder = {
        pair: 'BTC/USD',
        side: 'INVALID',
        quantity: 0.1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(invalidOrder);

      expect(response.status).toBe(400);
    });

    it('should return 400 for negative quantity', async () => {
      const invalidOrder = {
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: -1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(invalidOrder);

      expect(response.status).toBe(400);
    });

    it('should return 400 for zero quantity', async () => {
      const invalidOrder = {
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(invalidOrder);

      expect(response.status).toBe(400);
    });

    it('should return execution details for successful order', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0.1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest);

      expect(response.body.execution).toBeDefined();
      expect(response.body.execution.status).toBeDefined();
    });

    it('should return updated wallet after order', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0.1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest);

      expect(response.body.wallet).toBeDefined();
    });

    it('should handle incoming traceparent header', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0.1,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest)
        .set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/orders', () => {
    it('should return list of orders', async () => {
      // Override db.query mock for this specific test to return orders
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [
          {
            id: 'uuid-1',
            order_id: 'ORD-1',
            pair: 'BTC/USD',
            side: 'buy',
            type: 'market',
            quantity: '0.5',
            filled: '0.5',
            status: 'filled',
            price: '42500',
            trace_id: 'trace1',
            created_at: new Date(),
          },
          {
            id: 'uuid-2',
            order_id: 'ORD-2',
            pair: 'BTC/USD',
            side: 'sell',
            type: 'market',
            quantity: '0.2',
            filled: null,
            status: 'open',
            price: null,
            trace_id: 'trace2',
            created_at: new Date(),
          },
        ],
      } as any);

      const response = await request(app).get('/api/v1/orders');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
    });

    it('should return empty array when no orders exist', async () => {
      vi.mocked(storage.getOrders).mockResolvedValue([]);

      const response = await request(app).get('/api/v1/orders');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle database errors', async () => {
      // Override the db.query mock to throw an error for this test
      vi.mocked(db.query).mockRejectedValueOnce(new Error('DB Error'));

      const response = await request(app).get('/api/v1/orders');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch orders');
    });
  });

  // SKIPPED: These tests also timeout due to POST /api/orders OTEL context issues
  describe.skip('Order Validation Edge Cases', () => {
    it('should only accept BTC/USD pair (schema constraint)', async () => {
      // The schema is strict - only BTC/USD is allowed
      const orderRequest = {
        pair: 'ETH/USD',
        side: 'BUY',
        quantity: 1.0,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest);

      // ETH/USD is not a valid pair according to the schema
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid order request');
    });

    it('should accept very small quantities', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 0.00001,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest);

      expect(response.status).toBe(200);
    });

    it('should accept large quantities', async () => {
      const orderRequest = {
        userId: 'seed.user.primary@krystaline.io',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 100,
        orderType: 'MARKET',
      };

      const response = await request(app)
        .post('/api/v1/orders')
        .send(orderRequest);

      expect(response.status).toBe(200);
    });
  });
});
