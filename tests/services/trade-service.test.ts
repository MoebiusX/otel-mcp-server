/**
 * Trade Service Tests
 * 
 * Comprehensive unit tests for trading service operations.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock dependencies before importing
vi.mock('../../server/db', () => ({
    default: {
        query: vi.fn(),
        transaction: vi.fn((callback) => callback({
            query: vi.fn()
        })),
    }
}));

vi.mock('../../server/wallet/wallet-service', () => ({
    walletService: {
        getWallet: vi.fn(),
        lockFunds: vi.fn(),
        unlockFunds: vi.fn(),
    }
}));

vi.mock('../../server/services/price-service', () => ({
    priceService: {
        getPrice: vi.fn(),
        isPriceAvailable: vi.fn(),
        getRate: vi.fn(),
    }
}));

vi.mock('../../server/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }))
}));

import db from '../../server/db';
import { walletService } from '../../server/wallet/wallet-service';
import { priceService } from '../../server/services/price-service';
import { tradeService, TRADING_PAIRS } from '../../server/trade/trade-service';

describe('Trade Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ============================================
    // TRADING_PAIRS
    // ============================================
    describe('TRADING_PAIRS', () => {
        it('should include major trading pairs', () => {
            expect(TRADING_PAIRS).toContain('BTC/USDT');
            expect(TRADING_PAIRS).toContain('ETH/USDT');
            expect(TRADING_PAIRS).toContain('BTC/USD');
            expect(TRADING_PAIRS).toContain('ETH/USD');
        });

        it('should include EUR pairs', () => {
            expect(TRADING_PAIRS).toContain('BTC/EUR');
            expect(TRADING_PAIRS).toContain('ETH/EUR');
        });

        it('should include ETH/BTC cross pair', () => {
            expect(TRADING_PAIRS).toContain('ETH/BTC');
        });
    });

    // ============================================
    // getPrice
    // ============================================
    describe('getPrice', () => {
        it('should return price when available', () => {
            (priceService.getPrice as Mock).mockReturnValue({ price: 50000, timestamp: Date.now() });

            const price = tradeService.getPrice('BTC');

            expect(price).toBe(50000);
            expect(priceService.getPrice).toHaveBeenCalledWith('BTC');
        });

        it('should return null when price not available', () => {
            (priceService.getPrice as Mock).mockReturnValue(null);

            const price = tradeService.getPrice('XYZ');

            expect(price).toBeNull();
        });
    });

    // ============================================
    // isPriceAvailable
    // ============================================
    describe('isPriceAvailable', () => {
        it('should return true when price is available', () => {
            (priceService.isPriceAvailable as Mock).mockReturnValue(true);

            expect(tradeService.isPriceAvailable('BTC')).toBe(true);
        });

        it('should return false when price not available', () => {
            (priceService.isPriceAvailable as Mock).mockReturnValue(false);

            expect(tradeService.isPriceAvailable('XYZ')).toBe(false);
        });
    });

    // ============================================
    // getRate
    // ============================================
    describe('getRate', () => {
        it('should return rate between assets', () => {
            (priceService.getRate as Mock).mockReturnValue(0.05);

            const rate = tradeService.getRate('ETH', 'BTC');

            expect(rate).toBe(0.05);
            expect(priceService.getRate).toHaveBeenCalledWith('ETH', 'BTC');
        });

        it('should return null when rate unavailable', () => {
            (priceService.getRate as Mock).mockReturnValue(null);

            const rate = tradeService.getRate('XYZ', 'ABC');

            expect(rate).toBeNull();
        });
    });

    // ============================================
    // getConvertQuote
    // ============================================
    describe('getConvertQuote', () => {
        it('should return valid quote when price available', () => {
            (priceService.getRate as Mock).mockReturnValue(2500); // 1 ETH = 2500 USDT

            const quote = tradeService.getConvertQuote('ETH', 'USDT', 2);

            expect(quote.fromAsset).toBe('ETH');
            expect(quote.toAsset).toBe('USDT');
            expect(quote.fromAmount).toBe(2);
            expect(quote.rate).toBe(2500);
            // grossAmount = 2 * 2500 = 5000
            // fee = 5000 * 0.001 = 5
            // toAmount = 5000 - 5 = 4995
            expect(quote.toAmount).toBe(4995);
            expect(quote.fee).toBe(5);
            expect(quote.expiresAt).toBeInstanceOf(Date);
        });

        it('should throw when price not available', () => {
            (priceService.getRate as Mock).mockReturnValue(null);

            expect(() => tradeService.getConvertQuote('XYZ', 'USDT', 1))
                .toThrow('Price not available');
        });

        it('should normalize assets to uppercase', () => {
            (priceService.getRate as Mock).mockReturnValue(50000);

            const quote = tradeService.getConvertQuote('btc', 'usdt', 1);

            expect(quote.fromAsset).toBe('BTC');
            expect(quote.toAsset).toBe('USDT');
        });

        it('should set quote expiry to 30 seconds', () => {
            (priceService.getRate as Mock).mockReturnValue(1);
            const before = Date.now();

            const quote = tradeService.getConvertQuote('USDT', 'USD', 100);

            const expectedExpiry = before + 30000;
            expect(quote.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 100);
            expect(quote.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 100);
        });
    });

    // ============================================
    // executeConvert
    // ============================================
    describe('executeConvert', () => {
        it('should execute conversion when sufficient balance', async () => {
            (priceService.getRate as Mock).mockReturnValue(50000);
            
            const mockClient = {
                query: vi.fn()
                    .mockResolvedValueOnce({ rows: [{ id: 'order-123' }] }) // INSERT order
                    .mockResolvedValueOnce({ rows: [] }) // debit from
                    .mockResolvedValueOnce({ rows: [] }) // credit to
                    .mockResolvedValueOnce({ rows: [{ id: 'from-wallet' }] }) // get from wallet
                    .mockResolvedValueOnce({ rows: [{ id: 'to-wallet' }] }) // get to wallet
                    .mockResolvedValueOnce({ rows: [] }) // tx from
                    .mockResolvedValueOnce({ rows: [] }) // tx to
            };
            (db.transaction as Mock).mockImplementation(async (callback) => callback(mockClient));
            (walletService.getWallet as Mock).mockResolvedValue({ available: '1' });

            const result = await tradeService.executeConvert('user1', 'BTC', 'USDT', 0.5);

            expect(result.success).toBe(true);
            expect(result.orderId).toBe('order-123');
            expect(result.toAmount).toBeGreaterThan(0);
        });

        it('should throw when insufficient balance', async () => {
            (priceService.getRate as Mock).mockReturnValue(50000);
            (walletService.getWallet as Mock).mockResolvedValue({ available: '0.1' });
            (db.transaction as Mock).mockImplementation(async (callback) => {
                // getWallet is called inside the transaction
                return callback({
                    query: vi.fn()
                });
            });

            await expect(tradeService.executeConvert('user1', 'BTC', 'USDT', 1))
                .rejects.toThrow('Insufficient BTC balance');
        });

        it('should throw when wallet not found', async () => {
            (priceService.getRate as Mock).mockReturnValue(50000);
            (walletService.getWallet as Mock).mockResolvedValue(null);
            (db.transaction as Mock).mockImplementation(async (callback) => {
                return callback({
                    query: vi.fn()
                });
            });

            await expect(tradeService.executeConvert('user1', 'BTC', 'USDT', 1))
                .rejects.toThrow('Insufficient BTC balance');
        });
    });

    // ============================================
    // placeLimitOrder
    // ============================================
    describe('placeLimitOrder', () => {
        it('should place buy order and lock quote asset', async () => {
            (walletService.getWallet as Mock).mockResolvedValue({ available: '10000' });
            (walletService.lockFunds as Mock).mockResolvedValue(undefined);
            (db.query as Mock).mockResolvedValue({
                rows: [{
                    id: 'order-1',
                    pair: 'BTC/USDT',
                    side: 'buy',
                    type: 'limit',
                    price: 50000,
                    quantity: 0.1,
                    status: 'open'
                }]
            });

            const order = await tradeService.placeLimitOrder('user1', 'BTC/USDT', 'buy', 50000, 0.1);

            expect(order.side).toBe('buy');
            expect(walletService.getWallet).toHaveBeenCalledWith('user1', 'USDT');
            expect(walletService.lockFunds).toHaveBeenCalledWith('user1', 'USDT', 5000); // 50000 * 0.1
        });

        it('should place sell order and lock base asset', async () => {
            (walletService.getWallet as Mock).mockResolvedValue({ available: '1' });
            (walletService.lockFunds as Mock).mockResolvedValue(undefined);
            (db.query as Mock).mockResolvedValue({
                rows: [{
                    id: 'order-2',
                    pair: 'BTC/USDT',
                    side: 'sell',
                    type: 'limit',
                    status: 'open'
                }]
            });

            const order = await tradeService.placeLimitOrder('user1', 'BTC/USDT', 'sell', 55000, 0.5);

            expect(order.side).toBe('sell');
            expect(walletService.getWallet).toHaveBeenCalledWith('user1', 'BTC');
            expect(walletService.lockFunds).toHaveBeenCalledWith('user1', 'BTC', 0.5);
        });

        it('should throw when insufficient balance for buy', async () => {
            (walletService.getWallet as Mock).mockResolvedValue({ available: '100' });

            await expect(tradeService.placeLimitOrder('user1', 'BTC/USDT', 'buy', 50000, 0.1))
                .rejects.toThrow('Insufficient USDT balance');
        });

        it('should throw when wallet not found', async () => {
            (walletService.getWallet as Mock).mockResolvedValue(null);

            await expect(tradeService.placeLimitOrder('user1', 'BTC/USDT', 'buy', 50000, 0.1))
                .rejects.toThrow('Insufficient USDT balance');
        });
    });

    // ============================================
    // cancelOrder
    // ============================================
    describe('cancelOrder', () => {
        it('should cancel order and unlock funds for buy order', async () => {
            (db.query as Mock)
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'order-1',
                        pair: 'BTC/USDT',
                        side: 'buy',
                        price: 50000,
                        quantity: 0.1,
                        filled: 0,
                        status: 'open'
                    }]
                })
                .mockResolvedValueOnce({ rows: [] }); // UPDATE

            (walletService.unlockFunds as Mock).mockResolvedValue(undefined);

            const result = await tradeService.cancelOrder('user1', 'order-1');

            expect(result).toBe(true);
            expect(walletService.unlockFunds).toHaveBeenCalledWith('user1', 'USDT', 5000);
        });

        it('should cancel order and unlock funds for sell order', async () => {
            (db.query as Mock)
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'order-2',
                        pair: 'ETH/USD',
                        side: 'sell',
                        price: 2500,
                        quantity: 2,
                        filled: 0.5,
                        status: 'open'
                    }]
                })
                .mockResolvedValueOnce({ rows: [] });

            (walletService.unlockFunds as Mock).mockResolvedValue(undefined);

            const result = await tradeService.cancelOrder('user1', 'order-2');

            expect(result).toBe(true);
            // Unlock remaining: quantity - filled = 2 - 0.5 = 1.5
            expect(walletService.unlockFunds).toHaveBeenCalledWith('user1', 'ETH', 1.5);
        });

        it('should throw when order not found', async () => {
            (db.query as Mock).mockResolvedValue({ rows: [] });

            await expect(tradeService.cancelOrder('user1', 'invalid-id'))
                .rejects.toThrow('Order not found or already filled/cancelled');
        });
    });

    // ============================================
    // getOrders
    // ============================================
    describe('getOrders', () => {
        it('should get all orders for user', async () => {
            const mockOrders = [
                { id: 'order-1', status: 'open' },
                { id: 'order-2', status: 'filled' },
            ];
            (db.query as Mock).mockResolvedValue({ rows: mockOrders });

            const orders = await tradeService.getOrders('user1');

            expect(orders).toHaveLength(2);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE user_id = $1'),
                ['user1']
            );
        });

        it('should filter by status when provided', async () => {
            (db.query as Mock).mockResolvedValue({ rows: [{ id: 'order-1', status: 'open' }] });

            await tradeService.getOrders('user1', 'open');

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('AND status = $2'),
                ['user1', 'open']
            );
        });
    });

    // ============================================
    // getPairs
    // ============================================
    describe('getPairs', () => {
        it('should return all trading pairs with prices', () => {
            (priceService.getRate as Mock).mockReturnValue(50000);

            const pairs = tradeService.getPairs();

            expect(pairs).toHaveLength(TRADING_PAIRS.length);
            pairs.forEach(p => {
                expect(p).toHaveProperty('pair');
                expect(p).toHaveProperty('price');
                expect(p).toHaveProperty('change24h');
            });
        });

        it('should return 0 price when rate unavailable', () => {
            (priceService.getRate as Mock).mockReturnValue(null);

            const pairs = tradeService.getPairs();

            pairs.forEach(p => {
                expect(p.price).toBe(0);
            });
        });

        it('should return 24h change between -5% and 5%', () => {
            (priceService.getRate as Mock).mockReturnValue(100);

            const pairs = tradeService.getPairs();

            pairs.forEach(p => {
                expect(p.change24h).toBeGreaterThanOrEqual(-5);
                expect(p.change24h).toBeLessThanOrEqual(5);
            });
        });
    });
});
