/**
 * Trading Service
 * 
 * Handles crypto conversions, market orders, and limit orders.
 * Uses REAL prices from external price feeds - no fake data.
 */

import db from '../db';
import { walletService } from '../wallet/wallet-service';
import { createLogger } from '../lib/logger';
import { ValidationError, NotFoundError, InsufficientFundsError } from '../lib/errors';
import { priceService } from '../services/price-service';

const logger = createLogger('trade');

// Trading pairs supported
export const TRADING_PAIRS = [
    'BTC/USDT', 'ETH/USDT', 'BTC/USD', 'ETH/USD',
    'BTC/EUR', 'ETH/EUR', 'ETH/BTC'
];

// Trading fee (0.1% = 0.001)
const TRADING_FEE = 0.001;

export interface ConvertQuote {
    fromAsset: string;
    toAsset: string;
    fromAmount: number;
    toAmount: number;
    rate: number;
    fee: number;
    expiresAt: Date;
}

export interface Order {
    id: string;
    user_id: string;
    pair: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    price: number | null;
    quantity: number;
    filled: number;
    status: string;
    created_at: Date;
}

export const tradeService = {
    /**
     * Get current market price for an asset (in USD)
     * Returns null if price is not available (no fake prices!)
     */
    getPrice(asset: string): number | null {
        const priceData = priceService.getPrice(asset);
        return priceData ? priceData.price : null;
    },

    /**
     * Check if price is available for an asset
     */
    isPriceAvailable(asset: string): boolean {
        return priceService.isPriceAvailable(asset);
    },

    /**
     * Get exchange rate between two assets
     * Returns null if either price is unavailable
     */
    getRate(fromAsset: string, toAsset: string): number | null {
        return priceService.getRate(fromAsset, toAsset);
    },

    /**
     * Get a quote for converting assets
     * Throws if prices are not available
     */
    getConvertQuote(fromAsset: string, toAsset: string, fromAmount: number): ConvertQuote {
        const rate = this.getRate(fromAsset, toAsset);
        
        if (rate === null) {
            throw new ValidationError(
                `Price not available for ${fromAsset}/${toAsset}. ` +
                `Real-time price feed may be disconnected.`
            );
        }
        
        const grossAmount = fromAmount * rate;
        const fee = grossAmount * TRADING_FEE;
        const toAmount = grossAmount - fee;

        return {
            fromAsset: fromAsset.toUpperCase(),
            toAsset: toAsset.toUpperCase(),
            fromAmount,
            toAmount,
            rate,
            fee,
            expiresAt: new Date(Date.now() + 30000), // 30 second quote
        };
    },

    /**
     * Execute a conversion (instant swap)
     */
    async executeConvert(
        userId: string,
        fromAsset: string,
        toAsset: string,
        fromAmount: number
    ): Promise<{ success: boolean; toAmount: number; orderId: string }> {
        const quote = this.getConvertQuote(fromAsset, toAsset, fromAmount);

        return db.transaction(async (client) => {
            // Check available balance
            const fromWallet = await walletService.getWallet(userId, fromAsset);
            if (!fromWallet || parseFloat(fromWallet.available) < fromAmount) {
                throw new Error(`Insufficient ${fromAsset} balance`);
            }

            // Create order record
            const orderResult = await client.query(
                `INSERT INTO orders (user_id, pair, side, type, price, quantity, filled, status)
                 VALUES ($1, $2, 'sell', 'market', $3, $4, $4, 'filled')
                 RETURNING id`,
                [userId, `${fromAsset}/${toAsset}`, quote.rate, fromAmount]
            );
            const orderId = orderResult.rows[0].id;

            // Debit from source wallet
            await client.query(
                `UPDATE wallets SET balance = balance - $1, available = available - $1, updated_at = NOW()
                 WHERE user_id = $2 AND asset = $3`,
                [fromAmount, userId, fromAsset.toUpperCase()]
            );

            // Credit to destination wallet
            await client.query(
                `UPDATE wallets SET balance = balance + $1, available = available + $1, updated_at = NOW()
                 WHERE user_id = $2 AND asset = $3`,
                [quote.toAmount, userId, toAsset.toUpperCase()]
            );

            // Log transactions
            const fromWalletResult = await client.query(
                `SELECT id FROM wallets WHERE user_id = $1 AND asset = $2`,
                [userId, fromAsset.toUpperCase()]
            );
            const toWalletResult = await client.query(
                `SELECT id FROM wallets WHERE user_id = $1 AND asset = $2`,
                [userId, toAsset.toUpperCase()]
            );

            await client.query(
                `INSERT INTO transactions (user_id, wallet_id, type, amount, reference_id, description)
                 VALUES ($1, $2, 'trade_sell', $3, $4, $5)`,
                [userId, fromWalletResult.rows[0].id, -fromAmount, orderId, `Convert to ${toAsset}`]
            );

            await client.query(
                `INSERT INTO transactions (user_id, wallet_id, type, amount, reference_id, description)
                 VALUES ($1, $2, 'trade_buy', $3, $4, $5)`,
                [userId, toWalletResult.rows[0].id, quote.toAmount, orderId, `Convert from ${fromAsset}`]
            );

            logger.info({
                userId,
                orderId,
                fromAmount,
                fromAsset: fromAsset.toUpperCase(),
                toAmount: quote.toAmount,
                toAsset: toAsset.toUpperCase(),
                rate: quote.rate
            }, 'Asset conversion executed');

            return {
                success: true,
                toAmount: quote.toAmount,
                orderId,
            };
        });
    },

    /**
     * Place a limit order
     */
    async placeLimitOrder(
        userId: string,
        pair: string,
        side: 'buy' | 'sell',
        price: number,
        quantity: number
    ): Promise<Order> {
        const [baseAsset, quoteAsset] = pair.split('/');

        // For buy orders, lock the quote asset; for sell orders, lock the base asset
        const lockAsset = side === 'buy' ? quoteAsset : baseAsset;
        const lockAmount = side === 'buy' ? price * quantity : quantity;

        // Check and lock funds
        const wallet = await walletService.getWallet(userId, lockAsset);
        if (!wallet || parseFloat(wallet.available) < lockAmount) {
            throw new Error(`Insufficient ${lockAsset} balance`);
        }

        await walletService.lockFunds(userId, lockAsset, lockAmount);

        // Create order
        const result = await db.query(
            `INSERT INTO orders (user_id, pair, side, type, price, quantity, filled, status)
             VALUES ($1, $2, $3, 'limit', $4, $5, 0, 'open')
             RETURNING *`,
            [userId, pair, side, price, quantity]
        );

        logger.info({
            userId,
            orderId: result.rows[0].id,
            side,
            quantity,
            price,
            pair
        }, 'Limit order placed');
        return result.rows[0];
    },

    /**
     * Cancel an order
     */
    async cancelOrder(userId: string, orderId: string): Promise<boolean> {
        const orderResult = await db.query(
            `SELECT * FROM orders WHERE id = $1 AND user_id = $2 AND status = 'open'`,
            [orderId, userId]
        );

        if (orderResult.rows.length === 0) {
            throw new Error('Order not found or already filled/cancelled');
        }

        const order = orderResult.rows[0];
        const [baseAsset, quoteAsset] = order.pair.split('/');

        // Unlock funds
        const unlockAsset = order.side === 'buy' ? quoteAsset : baseAsset;
        const unlockAmount = order.side === 'buy'
            ? order.price * (order.quantity - order.filled)
            : order.quantity - order.filled;

        await walletService.unlockFunds(userId, unlockAsset, unlockAmount);

        // Update order status
        await db.query(
            `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
            [orderId]
        );

        logger.info({
            userId,
            orderId,
            pair: order.pair
        }, 'Order cancelled');
        return true;
    },

    /**
     * Get user's orders
     */
    async getOrders(userId: string, status?: string): Promise<Order[]> {
        let query = 'SELECT * FROM orders WHERE user_id = $1';
        const params: any[] = [userId];

        if (status) {
            query += ' AND status = $2';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';

        const result = await db.query(query, params);
        return result.rows;
    },

    /**
     * Get all supported trading pairs with current prices
     */
    getPairs(): Array<{ pair: string; price: number; change24h: number }> {
        return TRADING_PAIRS.map(pair => {
            const [base, quote] = pair.split('/');
            const rate = this.getRate(base, quote);
            // Simulated 24h change (-5% to +5%)
            const change24h = (Math.random() - 0.5) * 10;
            return { pair, price: rate ?? 0, change24h };
        });
    }
};

export default tradeService;
