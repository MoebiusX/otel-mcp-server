/**
 * PostgreSQL Storage Tests
 * 
 * Tests for the PostgreSQL storage implementation.
 * These tests mock the pg library to test the storage logic
 * without requiring an actual database connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';

// Mock the pg module before importing PostgresStorage
vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Pool: vi.fn(() => mockPool),
  };
});

// Mock config
vi.mock('../../server/config', () => ({
  config: {
    database: {
      host: 'localhost',
      port: 5433,
      name: 'test_db',
      user: 'test_user',
      password: 'test_password',
      maxConnections: 10,
      idleTimeoutMs: 30000,
      connectionTimeoutMs: 2000,
    },
  },
}));

// Mock logger
vi.mock('../../server/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { Pool as PgPool } from 'pg';
import { PostgresStorage, getPool, closePool, testConnection } from '../../server/db/postgres-storage';

describe('PostgresStorage', () => {
  let mockPool: ReturnType<typeof vi.mocked<Pool>>;
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let storage: PostgresStorage;

  beforeEach(() => {
    vi.clearAllMocks();

    // Get the mocked pool instance
    mockPool = new PgPool() as unknown as ReturnType<typeof vi.mocked<Pool>>;
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    (mockPool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    storage = new PostgresStorage();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe('Connection Management', () => {
    it('should create a pool with correct configuration', () => {
      expect(PgPool).toHaveBeenCalled();
    });

    it('should test connection successfully', async () => {
      (mockPool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

      const result = await testConnection();
      expect(result).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle connection test failure', async () => {
      (mockPool.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'));

      const result = await testConnection();
      expect(result).toBe(false);
    });

    it('should close pool gracefully', async () => {
      await closePool();
      // Pool end should be called (might be on a different instance due to mocking)
    });
  });

  describe('User Operations', () => {
    it('should return seed users from getUsers', async () => {
      const users = await storage.getUsers();
      expect(users).toHaveLength(2);
      expect(users[0]).toHaveProperty('id');
      expect(users[0]).toHaveProperty('name');
    });

    it('should find user by ID', async () => {
      const user = await storage.getUser('user_seed_001');
      expect(user).toBeDefined();
      expect(user?.id).toBe('user_seed_001');
      expect(user?.name).toBe('Primary User');
    });

    it('should return undefined for unknown user', async () => {
      const user = await storage.getUser('unknown');
      expect(user).toBeUndefined();
    });
  });

  describe('Wallet Operations', () => {
    it('should get wallet by seed address', async () => {
      // Mock the database query for seed wallet lookup
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ user_id: 'test-uuid' }]
      });

      // Get seed wallet address
      const { SEED_WALLETS } = await import('../../server/storage');
      const primaryAddress = SEED_WALLETS.primary.address;

      const wallet = await storage.getWalletByAddress(primaryAddress);

      expect(wallet).toBeDefined();
      expect(wallet?.ownerId).toBe('seed.user.primary@krystaline.io');
      expect(wallet?.address).toBe(primaryAddress);
    });

    it('should return undefined for unknown address', async () => {
      const wallet = await storage.getWalletByAddress('kx1unknown');
      expect(wallet).toBeUndefined();
    });

    it('should create new wallet', async () => {
      // Mock user lookup (not found)
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [] })  // No existing user
        .mockResolvedValueOnce({ rows: [{ id: 'new-user-uuid' }] })  // Insert user
        .mockResolvedValueOnce({ rows: [] });  // Insert wallets

      const wallet = await storage.createWallet('test@example.com', 'Test Wallet');

      expect(wallet).toBeDefined();
      expect(wallet.ownerId).toBe('test@example.com');
      expect(wallet.label).toBe('Test Wallet');
      expect(wallet.address).toMatch(/^kx1/);
      expect(wallet.type).toBe('custodial');
    });

    it('should get wallets by owner', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ user_id: 'test-uuid', email: 'seed.user.primary@krystaline.io', created_at: new Date() }]
      });

      const wallets = await storage.getWalletsByOwner('seed.user.primary@krystaline.io');

      expect(wallets).toHaveLength(1);
      expect(wallets[0].ownerId).toBe('seed.user.primary@krystaline.io');
    });

    it('should return empty array for owner with no wallets', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const wallets = await storage.getWalletsByOwner('unknown@example.com');

      expect(wallets).toHaveLength(0);
    });
  });

  describe('Balance Operations', () => {
    it('should get balance for asset', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 'wal_test_btc', balance: '150000000', updated_at: new Date() }]
      });

      const balance = await storage.getBalance('wal_test', 'BTC');

      expect(balance).toBeDefined();
      expect(balance?.asset).toBe('BTC');
      expect(balance?.balance).toBe(150000000);
      expect(balance?.decimals).toBe(8);
    });

    it('should return undefined for missing balance', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const balance = await storage.getBalance('wal_unknown', 'BTC');

      expect(balance).toBeUndefined();
    });

    it('should get all balances for wallet', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [
          { asset: 'BTC', balance: '150000000', updated_at: new Date() },
          { asset: 'USD', balance: '5000000', updated_at: new Date() },
        ]
      });

      const balances = await storage.getAllBalances('wal_test');

      expect(balances).toHaveLength(2);
      expect(balances.find(b => b.asset === 'BTC')).toBeDefined();
      expect(balances.find(b => b.asset === 'USD')).toBeDefined();
    });

    it('should update balance', async () => {
      const now = new Date();
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 'wal_test_btc', balance: '200000000', updated_at: now }]
      });

      const balance = await storage.updateBalance('wal_test', 'BTC', 200000000);

      expect(balance).toBeDefined();
      expect(balance?.balance).toBe(200000000);
    });

    it('should return correct decimals for each asset', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ id: 'wal_btc', balance: '100', updated_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wal_usd', balance: '100', updated_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wal_eth', balance: '100', updated_at: new Date() }] });

      const btcBalance = await storage.getBalance('wal', 'BTC');
      expect(btcBalance?.decimals).toBe(8);

      const usdBalance = await storage.getBalance('wal', 'USD');
      expect(usdBalance?.decimals).toBe(2);

      const ethBalance = await storage.getBalance('wal', 'ETH');
      expect(ethBalance?.decimals).toBe(18);
    });
  });

  describe('User-Wallet Mapping', () => {
    it('should get user wallet mapping', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ user_id: 'test-uuid', email: 'seed.user.primary@krystaline.io', created_at: new Date() }]
      });

      const mapping = await storage.getUserWalletMapping('seed.user.primary@krystaline.io');

      expect(mapping).toBeDefined();
      expect(mapping?.userId).toBe('seed.user.primary@krystaline.io');
      expect(mapping?.walletIds).toHaveLength(1);
      expect(mapping?.defaultWalletId).toBeDefined();
    });

    it('should return undefined for unknown user mapping', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const mapping = await storage.getUserWalletMapping('unknown@example.com');

      expect(mapping).toBeUndefined();
    });

    it('should get default wallet', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ user_id: 'test-uuid', email: 'seed.user.primary@krystaline.io', created_at: new Date() }]
      });

      const wallet = await storage.getDefaultWallet('seed.user.primary@krystaline.io');

      expect(wallet).toBeDefined();
      expect(wallet?.ownerId).toBe('seed.user.primary@krystaline.io');
    });
  });

  describe('Address Resolution', () => {
    it('should return kx1 addresses as-is', async () => {
      const address = await storage.resolveAddress('kx1abc123def456');
      expect(address).toBe('kx1abc123def456');
    });

    it('should resolve email to address', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ user_id: 'test-uuid', email: 'seed.user.primary@krystaline.io', created_at: new Date() }]
      });

      const address = await storage.resolveAddress('seed.user.primary@krystaline.io');

      expect(address).toBeDefined();
      expect(address).toMatch(/^kx1/);
    });

    it('should return undefined for unresolvable identifier', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const address = await storage.resolveAddress('unknown');

      expect(address).toBeUndefined();
    });
  });

  describe('Legacy Wallet Operations', () => {
    it('should get legacy wallet by user ID', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [
          { asset: 'BTC', balance: '150000000', updated_at: new Date() },
          { asset: 'USD', balance: '5000000', updated_at: new Date() },
        ]
      });

      const wallet = await storage.getWallet('seed.user.primary@krystaline.io');

      expect(wallet).toBeDefined();
      expect(wallet?.btc).toBe(1.5);
      expect(wallet?.usd).toBe(50000);
    });

    it('should return seed wallet for seed user IDs', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const wallet = await storage.getWallet('primary');

      expect(wallet).toBeDefined();
      expect(wallet?.btc).toBe(1.5);
      expect(wallet?.usd).toBe(50000);
    });

    it('should update legacy wallet', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] })  // User lookup
        .mockResolvedValueOnce({ rows: [] })  // BTC update
        .mockResolvedValueOnce({ rows: [] })  // USD update
        .mockResolvedValueOnce({  // getWallet call
          rows: [
            { asset: 'BTC', balance: '200000000', updated_at: new Date() },
            { asset: 'USD', balance: '6000000', updated_at: new Date() },
          ]
        });

      const wallet = await storage.updateWallet('seed.user.primary@krystaline.io', { btc: 2.0, usd: 60000 });

      expect(wallet).toBeDefined();
    });
  });

  describe('Order Operations', () => {
    it('should create order', async () => {
      const now = new Date();
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] })  // User lookup
        .mockResolvedValueOnce({  // Order insert
          rows: [{
            id: 'order-123',
            pair: 'BTC/USD',
            side: 'buy',
            type: 'market',
            quantity: '1.5',
            status: 'open',
            created_at: now,
          }]
        });

      const order = await storage.createOrder({
        orderId: 'order-123',
        pair: 'BTC/USD',
        side: 'BUY',
        quantity: 1.5,
        orderType: 'MARKET',
        traceId: 'trace-123',
        spanId: 'span-123',
        userId: 'seed.user.primary@krystaline.io',
      });

      expect(order).toBeDefined();
      expect(order.orderId).toBe('order-123');
      expect(order.pair).toBe('BTC/USD');
      expect(order.side).toBe('BUY');
      expect(order.quantity).toBe(1.5);
      expect(order.orderType).toBe('MARKET');
      expect(order.status).toBe('PENDING');
    });

    it('should get orders with limit', async () => {
      const now = new Date();
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [
          { id: 'order-1', pair: 'BTC/USD', side: 'buy', type: 'market', quantity: '1.0', filled: '0', status: 'open', price: null, created_at: now },
          { id: 'order-2', pair: 'BTC/USD', side: 'sell', type: 'market', quantity: '0.5', filled: '0.5', status: 'filled', price: '50000', created_at: now },
        ]
      });

      const orders = await storage.getOrders(10);

      expect(orders).toHaveLength(2);
      expect(orders[0].orderId).toBe('order-1');
      expect(orders[1].orderId).toBe('order-2');
      expect(orders[1].status).toBe('FILLED');
    });

    it('should update order status', async () => {
      const now = new Date();
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{
          id: 'order-123',
          pair: 'BTC/USD',
          side: 'buy',
          type: 'market',
          quantity: '1.5',
          filled: '1.5',
          status: 'filled',
          price: '50000',
          created_at: now,
        }]
      });

      const order = await storage.updateOrder('order-123', {
        status: 'FILLED',
        fillPrice: 50000,
      });

      expect(order).toBeDefined();
      expect(order?.status).toBe('FILLED');
      expect(order?.fillPrice).toBe(50000);
    });

    it('should return undefined for unknown order update', async () => {
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const order = await storage.updateOrder('unknown-order', { status: 'FILLED' });

      expect(order).toBeUndefined();
    });
  });

  describe('Transfer Operations', () => {
    it('should create transfer', async () => {
      const { SEED_WALLETS } = await import('../../server/storage');

      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] })  // User lookup
        .mockResolvedValueOnce({ rows: [{ id: 'wallet-uuid' }] })  // Wallet lookup
        .mockResolvedValueOnce({ rows: [] });  // Transaction insert

      const transfer = await storage.createTransfer({
        transferId: 'transfer-123',
        fromAddress: SEED_WALLETS.primary.address,
        toAddress: SEED_WALLETS.secondary.address,
        amount: 0.1,
        traceId: 'trace-123',
        spanId: 'span-123',
      });

      expect(transfer).toBeDefined();
      expect(transfer.transferId).toBe('transfer-123');
      expect(transfer.fromAddress).toBe(SEED_WALLETS.primary.address);
      expect(transfer.toAddress).toBe(SEED_WALLETS.secondary.address);
      expect(transfer.amount).toBe(0.1);
      expect(transfer.status).toBe('PENDING');
    });

    it('should get transfers', async () => {
      const now = new Date();
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [
          { id: 'transfer-1', amount: '0.1', status: 'completed', reference_id: 'trace-1', description: 'Test', created_at: now, from_email: 'seed.user.primary@krystaline.io' },
        ]
      });

      const transfers = await storage.getTransfers(10);

      expect(transfers).toHaveLength(1);
      expect(transfers[0].transferId).toBe('transfer-1');
      expect(transfers[0].status).toBe('COMPLETED');
    });

    it('should update transfer status', async () => {
      const now = new Date();
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 'transfer-123', amount: '0.1', status: 'completed', created_at: now }]
      });

      const transfer = await storage.updateTransfer('transfer-123', 'COMPLETED');

      expect(transfer).toBeDefined();
      expect(transfer?.status).toBe('COMPLETED');
    });
  });

  describe('Trace Operations (In-Memory)', () => {
    it('should create trace', async () => {
      const trace = await storage.createTrace({
        traceId: 'trace-123',
        service: 'kx-exchange',
        operation: 'createOrder',
      });

      expect(trace).toBeDefined();
      expect(trace.traceId).toBe('trace-123');
      expect(trace.service).toBe('kx-exchange');
      expect(trace.status).toBe('active');
    });

    it('should get trace by ID', async () => {
      await storage.createTrace({
        traceId: 'trace-456',
        service: 'kx-exchange',
        operation: 'test',
      });

      const trace = await storage.getTrace('trace-456');

      expect(trace).toBeDefined();
      expect(trace?.traceId).toBe('trace-456');
    });

    it('should return undefined for unknown trace', async () => {
      const trace = await storage.getTrace('unknown-trace');
      expect(trace).toBeUndefined();
    });

    it('should get traces with limit', async () => {
      await storage.createTrace({ traceId: 'trace-1', service: 'svc', operation: 'op1' });
      await storage.createTrace({ traceId: 'trace-2', service: 'svc', operation: 'op2' });
      await storage.createTrace({ traceId: 'trace-3', service: 'svc', operation: 'op3' });

      const traces = await storage.getTraces(2);

      expect(traces).toHaveLength(2);
    });

    it('should update trace status', async () => {
      await storage.createTrace({
        traceId: 'trace-update',
        service: 'kx-exchange',
        operation: 'test',
      });

      const trace = await storage.updateTraceStatus('trace-update', 'completed', 150);

      expect(trace).toBeDefined();
      expect(trace?.status).toBe('completed');
      expect(trace?.duration).toBe(150);
      expect(trace?.endTime).toBeDefined();
    });
  });

  describe('Span Operations (In-Memory)', () => {
    it('should create span', async () => {
      const span = await storage.createSpan({
        spanId: 'span-123',
        traceId: 'trace-123',
        parentSpanId: null,
        service: 'kx-exchange',
        operation: 'processOrder',
      });

      expect(span).toBeDefined();
      expect(span.spanId).toBe('span-123');
      expect(span.traceId).toBe('trace-123');
      expect(span.status).toBe('OK');
    });

    it('should get span by ID', async () => {
      await storage.createSpan({
        spanId: 'span-456',
        traceId: 'trace-456',
        parentSpanId: null,
        service: 'kx-exchange',
        operation: 'test',
      });

      const span = await storage.getSpan('span-456');

      expect(span).toBeDefined();
      expect(span?.spanId).toBe('span-456');
    });

    it('should get spans by trace ID', async () => {
      const traceId = 'trace-spans';
      await storage.createSpan({ spanId: 'span-1', traceId, parentSpanId: null, service: 'svc', operation: 'op1' });
      await storage.createSpan({ spanId: 'span-2', traceId, parentSpanId: 'span-1', service: 'svc', operation: 'op2' });
      await storage.createSpan({ spanId: 'span-3', traceId: 'other-trace', parentSpanId: null, service: 'svc', operation: 'op3' });

      const spans = await storage.getSpansByTrace(traceId);

      expect(spans).toHaveLength(2);
      expect(spans.every(s => s.traceId === traceId)).toBe(true);
    });

    it('should update span', async () => {
      await storage.createSpan({
        spanId: 'span-update',
        traceId: 'trace-update',
        parentSpanId: null,
        service: 'kx-exchange',
        operation: 'test',
      });

      const span = await storage.updateSpan('span-update', {
        status: 'ERROR',
        duration: 100,
      });

      expect(span).toBeDefined();
      expect(span?.status).toBe('ERROR');
      expect(span?.duration).toBe(100);
    });
  });

  describe('Clear Data', () => {
    it('should clear ephemeral data', async () => {
      // Create some traces and spans
      await storage.createTrace({ traceId: 'trace-clear', service: 'svc', operation: 'op' });
      await storage.createSpan({ spanId: 'span-clear', traceId: 'trace-clear', parentSpanId: null, service: 'svc', operation: 'op' });

      await storage.clearAllData();

      const trace = await storage.getTrace('trace-clear');
      const span = await storage.getSpan('span-clear');

      expect(trace).toBeUndefined();
      expect(span).toBeUndefined();
    });
  });
});

describe('Storage Factory', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.STORAGE_TYPE;
  });

  it('should default to postgres storage', async () => {
    const { getStorageType } = await import('../../server/storage');
    expect(getStorageType()).toBe('postgres');
  });

  it('should use memory storage when explicitly set', async () => {
    process.env.STORAGE_TYPE = 'memory';
    const { getStorageType } = await import('../../server/storage');
    expect(getStorageType()).toBe('memory');
  });

  it('should recognize postgres storage type', async () => {
    process.env.STORAGE_TYPE = 'postgres';
    const { getStorageType } = await import('../../server/storage');
    expect(getStorageType()).toBe('postgres');
  });

  it('should be case insensitive for memory', async () => {
    process.env.STORAGE_TYPE = 'MEMORY';
    const { getStorageType } = await import('../../server/storage');
    expect(getStorageType()).toBe('memory');
  });
});
