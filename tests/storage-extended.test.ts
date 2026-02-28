/**
 * Storage Tests
 * 
 * Comprehensive tests for the in-memory storage implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    MemoryStorage,
    generateWalletAddress,
    generateWalletId,
    USERS,
    SEED_WALLETS
} from '../server/storage';

describe('Storage', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
    });

    // ============================================
    // Wallet Address Generation
    // ============================================
    describe('generateWalletAddress', () => {
        it('should generate address starting with kx1', () => {
            const address = generateWalletAddress();

            expect(address).toMatch(/^kx1/);
        });

        it('should generate 35-character address (kx1 + 32 chars)', () => {
            const address = generateWalletAddress();

            expect(address).toHaveLength(35);
        });

        it('should generate consistent address for same seed', () => {
            const address1 = generateWalletAddress('test-seed');
            const address2 = generateWalletAddress('test-seed');

            expect(address1).toBe(address2);
        });

        it('should generate different addresses for different seeds', () => {
            const address1 = generateWalletAddress('seed-1');
            const address2 = generateWalletAddress('seed-2');

            expect(address1).not.toBe(address2);
        });

        it('should use lowercase base32 characters after prefix', () => {
            const address = generateWalletAddress('test');
            const suffix = address.substring(3); // Remove 'kx1'

            expect(suffix).toMatch(/^[a-z2-7]+$/);
        });
    });

    describe('generateWalletId', () => {
        it('should generate ID starting with wal_', () => {
            const id = generateWalletId();

            expect(id).toMatch(/^wal_/);
        });

        it('should generate unique IDs', () => {
            const ids = new Set();
            for (let i = 0; i < 100; i++) {
                ids.add(generateWalletId());
            }

            expect(ids.size).toBe(100);
        });
    });

    // ============================================
    // Seed Data
    // ============================================
    describe('Seed Data', () => {
        it('should have seed users', () => {
            expect(USERS).toHaveLength(2);
            expect(USERS.find(u => u.id === 'user_seed_001')).toBeDefined();
            expect(USERS.find(u => u.id === 'user_seed_002')).toBeDefined();
        });

        it('should have seed wallets for primary and secondary', () => {
            expect(SEED_WALLETS.primary).toBeDefined();
            expect(SEED_WALLETS.secondary).toBeDefined();
            expect(SEED_WALLETS.primary.address).toMatch(/^kx1/);
            expect(SEED_WALLETS.secondary.address).toMatch(/^kx1/);
        });
    });

    // ============================================
    // User Operations
    // ============================================
    describe('User Operations', () => {
        it('should get all users', async () => {
            const users = await storage.getUsers();

            expect(users).toEqual(USERS);
        });

        it('should get user by ID', async () => {
            const user = await storage.getUser('user_seed_001');

            expect(user).toBeDefined();
            expect(user?.name).toBe('Primary User');
        });

        it('should return undefined for unknown user', async () => {
            const unknown = await storage.getUser('unknown');

            expect(unknown).toBeUndefined();
        });
    });

    // ============================================
    // Krystaline Wallet Operations
    // ============================================
    describe('Wallet Operations', () => {
        it('should get wallet by address', async () => {
            const wallet = await storage.getWalletByAddress(SEED_WALLETS.primary.address);

            expect(wallet).toBeDefined();
            expect(wallet?.ownerId).toBe('seed.user.primary@krystaline.io');
        });

        it('should return undefined for unknown address', async () => {
            const wallet = await storage.getWalletByAddress('kx1unknown');

            expect(wallet).toBeUndefined();
        });

        it('should get wallet by ID', async () => {
            const wallet = await storage.getWalletById(SEED_WALLETS.primary.walletId);

            expect(wallet).toBeDefined();
            expect(wallet?.address).toBe(SEED_WALLETS.primary.address);
        });

        it('should get wallets by owner', async () => {
            const wallets = await storage.getWalletsByOwner('seed.user.primary@krystaline.io');

            expect(wallets.length).toBeGreaterThan(0);
            expect(wallets[0].ownerId).toBe('seed.user.primary@krystaline.io');
        });

        it('should return empty array for owner with no wallets', async () => {
            const wallets = await storage.getWalletsByOwner('unknown@example.com');

            expect(wallets).toEqual([]);
        });

        it('should create new wallet', async () => {
            const wallet = await storage.createWallet('newuser@test.com', 'Test Wallet');

            expect(wallet.walletId).toMatch(/^wal_/);
            expect(wallet.address).toMatch(/^kx1/);
            expect(wallet.ownerId).toBe('newuser@test.com');
            expect(wallet.label).toBe('Test Wallet');
        });

        it('should track created wallet in indexes', async () => {
            const wallet = await storage.createWallet('indexed@test.com');

            const byAddress = await storage.getWalletByAddress(wallet.address);
            const byOwner = await storage.getWalletsByOwner('indexed@test.com');

            expect(byAddress).toBeDefined();
            expect(byOwner).toContainEqual(expect.objectContaining({ walletId: wallet.walletId }));
        });
    });

    // ============================================
    // Balance Operations
    // ============================================
    describe('Balance Operations', () => {
        it('should get balance for seed wallet', async () => {
            const balance = await storage.getBalance(SEED_WALLETS.primary.walletId, 'BTC');

            expect(balance).toBeDefined();
            expect(balance?.asset).toBe('BTC');
            expect(balance?.balance).toBe(150000000); // 1.5 BTC in satoshis
        });

        it('should return undefined for non-existent balance', async () => {
            const balance = await storage.getBalance(SEED_WALLETS.primary.walletId, 'ETH');

            expect(balance).toBeUndefined();
        });

        it('should get all balances for wallet', async () => {
            const balances = await storage.getAllBalances(SEED_WALLETS.primary.walletId);

            expect(balances.length).toBeGreaterThan(0);
            expect(balances.some(b => b.asset === 'BTC')).toBe(true);
            expect(balances.some(b => b.asset === 'USD')).toBe(true);
        });

        it('should return empty array for wallet with no balances', async () => {
            const wallet = await storage.createWallet('empty@test.com');
            const balances = await storage.getAllBalances(wallet.walletId);

            expect(balances).toEqual([]);
        });

        it('should update balance', async () => {
            const wallet = await storage.createWallet('balance@test.com');
            await storage.updateBalance(wallet.walletId, 'BTC', 50000000);

            const balance = await storage.getBalance(wallet.walletId, 'BTC');

            expect(balance?.balance).toBe(50000000);
            expect(balance?.decimals).toBe(8);
        });

        it('should use correct decimals for different assets', async () => {
            const wallet = await storage.createWallet('decimals@test.com');

            await storage.updateBalance(wallet.walletId, 'BTC', 100);
            await storage.updateBalance(wallet.walletId, 'ETH', 100);
            await storage.updateBalance(wallet.walletId, 'USD', 100);

            const btc = await storage.getBalance(wallet.walletId, 'BTC');
            const eth = await storage.getBalance(wallet.walletId, 'ETH');
            const usd = await storage.getBalance(wallet.walletId, 'USD');

            expect(btc?.decimals).toBe(8);
            expect(eth?.decimals).toBe(18);
            expect(usd?.decimals).toBe(2);
        });
    });

    // ============================================
    // User-Wallet Mapping
    // ============================================
    describe('User-Wallet Mapping', () => {
        it('should get user wallet mapping', async () => {
            const mapping = await storage.getUserWalletMapping('seed.user.primary@krystaline.io');

            expect(mapping).toBeDefined();
            expect(mapping?.userId).toBe('seed.user.primary@krystaline.io');
            expect(mapping?.walletIds.length).toBeGreaterThan(0);
        });

        it('should get default wallet', async () => {
            const wallet = await storage.getDefaultWallet('seed.user.primary@krystaline.io');

            expect(wallet).toBeDefined();
            expect(wallet?.ownerId).toBe('seed.user.primary@krystaline.io');
        });

        it('should return undefined for user with no wallet', async () => {
            const wallet = await storage.getDefaultWallet('nowallets@test.com');

            expect(wallet).toBeUndefined();
        });
    });

    // ============================================
    // Address Resolution
    // ============================================
    describe('Address Resolution', () => {
        it('should return kx1 address as-is', async () => {
            const address = await storage.resolveAddress('kx1testaddress12345');

            expect(address).toBe('kx1testaddress12345');
        });

        it('should resolve email to address', async () => {
            const address = await storage.resolveAddress('seed.user.primary@krystaline.io');

            expect(address).toBe(SEED_WALLETS.primary.address);
        });

        it('should return undefined for unknown identifier', async () => {
            const address = await storage.resolveAddress('unknown@test.com');

            expect(address).toBeUndefined();
        });
    });

    // ============================================
    // Legacy Wallet Operations
    // ============================================
    describe('Legacy Wallet Operations', () => {
        it('should get legacy wallet', async () => {
            const wallet = await storage.getWallet('primary');

            expect(wallet).toBeDefined();
            expect(wallet?.btc).toBe(1.5);
            expect(wallet?.usd).toBe(50000);
        });

        it('should update legacy wallet', async () => {
            await storage.updateWallet('primary', { btc: 2.0 });
            const wallet = await storage.getWallet('primary');

            expect(wallet?.btc).toBe(2.0);
        });

        it('should return undefined for unknown user', async () => {
            const wallet = await storage.getWallet('nonexistent');

            expect(wallet).toBeUndefined();
        });

        it('should update only specified fields', async () => {
            const before = await storage.getWallet('secondary');
            await storage.updateWallet('secondary', { usd: 20000 });
            const after = await storage.getWallet('secondary');

            expect(after?.btc).toBe(before?.btc);
            expect(after?.usd).toBe(20000);
        });
    });

    // ============================================
    // Transfer Operations
    // ============================================
    describe('Transfer Operations', () => {
        it('should create transfer', async () => {
            const transfer = await storage.createTransfer({
                transferId: 'txf-123',
                fromAddress: SEED_WALLETS.primary.address,
                toAddress: SEED_WALLETS.secondary.address,
                amount: 0.5,
                traceId: 'trace-1',
                spanId: 'span-1',
            });

            expect(transfer.transferId).toBe('txf-123');
            expect(transfer.status).toBe('PENDING');
            expect(transfer.fromUserId).toBe('seed.user.primary@krystaline.io');
            expect(transfer.toUserId).toBe('seed.user.secondary@krystaline.io');
        });

        it('should get transfers with limit', async () => {
            // Create multiple transfers
            for (let i = 0; i < 5; i++) {
                await storage.createTransfer({
                    transferId: `txf-${i}`,
                    fromAddress: SEED_WALLETS.primary.address,
                    toAddress: SEED_WALLETS.secondary.address,
                    amount: 0.1,
                    traceId: `trace-${i}`,
                    spanId: `span-${i}`,
                });
            }

            const transfers = await storage.getTransfers(3);

            expect(transfers.length).toBe(3);
        });

        it('should update transfer status', async () => {
            await storage.createTransfer({
                transferId: 'txf-update',
                fromAddress: SEED_WALLETS.primary.address,
                toAddress: SEED_WALLETS.secondary.address,
                amount: 1,
                traceId: 'trace-u',
                spanId: 'span-u',
            });

            const updated = await storage.updateTransfer('txf-update', 'COMPLETED');

            expect(updated?.status).toBe('COMPLETED');
        });

        it('should return undefined for unknown transfer', async () => {
            const updated = await storage.updateTransfer('nonexistent', 'FAILED');

            expect(updated).toBeUndefined();
        });
    });

    // ============================================
    // Order Operations
    // ============================================
    describe('Order Operations', () => {
        it('should create order', async () => {
            const order = await storage.createOrder({
                orderId: 'ord-123',
                pair: 'BTC/USD',
                side: 'BUY',
                quantity: 0.5,
                orderType: 'MARKET',
                traceId: 'trace-o1',
                spanId: 'span-o1',
            });

            expect(order.orderId).toBe('ord-123');
            expect(order.status).toBe('PENDING');
            expect(order.side).toBe('BUY');
        });

        it('should get orders with limit', async () => {
            for (let i = 0; i < 5; i++) {
                await storage.createOrder({
                    orderId: `ord-${i}`,
                    pair: 'BTC/USD',
                    side: 'SELL',
                    quantity: 0.1,
                    orderType: 'MARKET',
                    traceId: `trace-${i}`,
                    spanId: `span-${i}`,
                });
            }

            const orders = await storage.getOrders(2);

            expect(orders.length).toBe(2);
        });

        it('should update order', async () => {
            await storage.createOrder({
                orderId: 'ord-update',
                pair: 'BTC/USD',
                side: 'BUY',
                quantity: 1,
                orderType: 'MARKET',
                traceId: 'trace-u',
                spanId: 'span-u',
            });

            const updated = await storage.updateOrder('ord-update', {
                status: 'FILLED',
                fillPrice: 50000,
                totalValue: 50000,
            });

            expect(updated?.status).toBe('FILLED');
            expect(updated?.fillPrice).toBe(50000);
        });

        it('should return undefined for unknown order', async () => {
            const updated = await storage.updateOrder('nonexistent', { status: 'REJECTED' });

            expect(updated).toBeUndefined();
        });
    });

    // ============================================
    // Trace Operations
    // ============================================
    describe('Trace Operations', () => {
        it('should create trace', async () => {
            const trace = await storage.createTrace({
                traceId: 'trace-create',
                name: 'test-operation',
                serviceName: 'test-service',
            });

            expect(trace.traceId).toBe('trace-create');
            expect(trace.status).toBe('active');
            expect(trace.id).toBeDefined();
        });

        it('should get trace', async () => {
            await storage.createTrace({
                traceId: 'trace-get',
                name: 'test',
                serviceName: 'test',
            });

            const trace = await storage.getTrace('trace-get');

            expect(trace?.traceId).toBe('trace-get');
        });

        it('should get traces with limit', async () => {
            for (let i = 0; i < 5; i++) {
                await storage.createTrace({
                    traceId: `trace-list-${i}`,
                    name: 'test',
                    serviceName: 'test',
                });
            }

            const traces = await storage.getTraces(3);

            expect(traces.length).toBe(3);
        });

        it('should update trace status', async () => {
            await storage.createTrace({
                traceId: 'trace-status',
                name: 'test',
                serviceName: 'test',
            });

            const updated = await storage.updateTraceStatus('trace-status', 'completed', 150);

            expect(updated?.status).toBe('completed');
            expect(updated?.duration).toBe(150);
            expect(updated?.endTime).toBeDefined();
        });

        it('should return undefined for unknown trace', async () => {
            const updated = await storage.updateTraceStatus('nonexistent', 'error');

            expect(updated).toBeUndefined();
        });
    });

    // ============================================
    // Span Operations
    // ============================================
    describe('Span Operations', () => {
        it('should create span', async () => {
            const span = await storage.createSpan({
                spanId: 'span-create',
                traceId: 'trace-1',
                parentSpanId: null,
                name: 'test-span',
                serviceName: 'test',
                kind: 'internal',
            });

            expect(span.spanId).toBe('span-create');
            expect(span.status).toBe('OK');
        });

        it('should get span', async () => {
            await storage.createSpan({
                spanId: 'span-get',
                traceId: 'trace-1',
                parentSpanId: null,
                name: 'test',
                serviceName: 'test',
                kind: 'server',
            });

            const span = await storage.getSpan('span-get');

            expect(span?.spanId).toBe('span-get');
        });

        it('should get spans by trace', async () => {
            await storage.createSpan({
                spanId: 'span-trace-1',
                traceId: 'trace-filter',
                parentSpanId: null,
                name: 'root',
                serviceName: 'test',
                kind: 'server',
            });
            await storage.createSpan({
                spanId: 'span-trace-2',
                traceId: 'trace-filter',
                parentSpanId: 'span-trace-1',
                name: 'child',
                serviceName: 'test',
                kind: 'internal',
            });
            await storage.createSpan({
                spanId: 'span-other',
                traceId: 'other-trace',
                parentSpanId: null,
                name: 'other',
                serviceName: 'test',
                kind: 'client',
            });

            const spans = await storage.getSpansByTrace('trace-filter');

            expect(spans.length).toBe(2);
            expect(spans.every(s => s.traceId === 'trace-filter')).toBe(true);
        });

        it('should update span', async () => {
            await storage.createSpan({
                spanId: 'span-update',
                traceId: 'trace-1',
                parentSpanId: null,
                name: 'test',
                serviceName: 'test',
                kind: 'internal',
            });

            const updated = await storage.updateSpan('span-update', {
                status: 'ERROR',
                duration: 100,
            });

            expect(updated?.status).toBe('ERROR');
            expect(updated?.duration).toBe(100);
        });

        it('should return undefined for unknown span', async () => {
            const updated = await storage.updateSpan('nonexistent', { status: 'OK' });

            expect(updated).toBeUndefined();
        });
    });

    // ============================================
    // Clear All Data
    // ============================================
    describe('clearAllData', () => {
        it('should clear all orders and transfers', async () => {
            await storage.createOrder({
                orderId: 'ord-clear',
                pair: 'BTC/USD',
                side: 'BUY',
                quantity: 1,
                orderType: 'MARKET',
                traceId: 'trace',
                spanId: 'span',
            });
            await storage.createTransfer({
                transferId: 'txf-clear',
                fromAddress: SEED_WALLETS.primary.address,
                toAddress: SEED_WALLETS.secondary.address,
                amount: 1,
                traceId: 'trace',
                spanId: 'span',
            });

            await storage.clearAllData();

            const orders = await storage.getOrders();
            const transfers = await storage.getTransfers();

            expect(orders.length).toBe(0);
            expect(transfers.length).toBe(0);
        });

        it('should reset seed wallets', async () => {
            // Modify primary's balance
            await storage.updateWallet('primary', { btc: 100 });

            await storage.clearAllData();

            // Seed data should be re-initialized
            const primary = await storage.getWallet('primary');
            expect(primary?.btc).toBe(1.5);
        });
    });
});
