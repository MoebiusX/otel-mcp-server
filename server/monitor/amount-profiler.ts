/**
 * Amount Profiler
 * 
 * Tracks baseline statistics for transaction amounts by operation type and asset.
 * Uses Welford's algorithm for incremental mean/variance calculation.
 * 
 * This is the data collection component for whale/amount anomaly detection.
 */

import type { AmountBaseline, AmountOperationType } from './types';
import { drizzleDb } from '../db/drizzle';
import { orders, transactions, wallets } from '../db/schema';
import { gte, desc, eq } from 'drizzle-orm';
import { createLogger } from '../lib/logger';

const logger = createLogger('amount-profiler');
const POLL_INTERVAL = 60000; // 1 minute (less frequent than trace profiler)
const LOOKBACK_HOURS = 24;   // 24 hours of historical data for baselines

export class AmountProfiler {
    private baselines: Map<string, AmountBaseline> = new Map();
    private pollInterval: NodeJS.Timeout | null = null;
    private isRunning = false;

    /**
     * Start the profiler polling loop
     */
    start(): void {
        if (this.isRunning) return;

        logger.info('Starting amount profiler...');
        this.isRunning = true;

        // Initial collection
        this.collectAndUpdate();

        // Schedule periodic updates
        this.pollInterval = setInterval(() => {
            this.collectAndUpdate();
        }, POLL_INTERVAL);
    }

    /**
     * Stop the profiler
     */
    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isRunning = false;
        logger.info('Stopped');
    }

    /**
     * Get current baselines
     */
    getBaselines(): AmountBaseline[] {
        return Array.from(this.baselines.values());
    }

    /**
     * Get baseline for specific operation type and asset
     */
    getBaseline(operationType: AmountOperationType, asset: string): AmountBaseline | undefined {
        return this.baselines.get(`${operationType}:${asset}`);
    }

    /**
     * Reset all baselines (clears whale detector averages)
     */
    reset(): { clearedCount: number } {
        const count = this.baselines.size;
        this.baselines.clear();
        logger.info({ clearedCount: count }, 'Amount baselines reset');
        return { clearedCount: count };
    }

    /**
     * Collect recent transactions and update baselines
     */
    private async collectAndUpdate(): Promise<void> {
        try {
            const lookbackTime = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

            // Collect from orders table
            const recentOrders = await drizzleDb.select({
                side: orders.side,
                pair: orders.pair,
                quantity: orders.quantity,
            }).from(orders).where(
                gte(orders.createdAt, lookbackTime)
            ).orderBy(desc(orders.createdAt)).limit(1000);

            // Process orders into amount data
            const amounts: Array<{ operationType: AmountOperationType; asset: string; amount: number }> = [];

            for (const order of recentOrders) {
                if (order.quantity && order.pair) {
                    const [baseAsset] = order.pair.split('/');
                    // Schema uses lowercase 'buy'/'sell', convert to uppercase for our types
                    const opType: AmountOperationType = order.side === 'buy' ? 'BUY' : 'SELL';
                    amounts.push({
                        operationType: opType,
                        asset: baseAsset,
                        amount: Number(order.quantity),
                    });
                }
            }

            // Collect from transactions table (deposits, withdrawals) with join to get asset
            const recentTransactions = await drizzleDb.select({
                type: transactions.type,
                amount: transactions.amount,
                walletAsset: wallets.asset,
            }).from(transactions)
                .innerJoin(wallets, eq(transactions.walletId, wallets.id))
                .where(
                    gte(transactions.createdAt, lookbackTime)
                ).limit(500);

            for (const tx of recentTransactions) {
                if (tx.amount && tx.walletAsset) {
                    // Convert schema types to our AmountOperationType
                    let opType: AmountOperationType;
                    switch (tx.type) {
                        case 'deposit':
                            opType = 'DEPOSIT';
                            break;
                        case 'withdrawal':
                            opType = 'WITHDRAW';
                            break;
                        default:
                            opType = 'TRANSFER';
                            break;
                    }
                    amounts.push({
                        operationType: opType,
                        asset: tx.walletAsset,
                        amount: Number(tx.amount),
                    });
                }
            }

            // Update baselines
            this.updateBaselines(amounts);

            logger.info({
                baselinesCount: this.baselines.size,
                ordersCount: recentOrders.length,
                transactionsCount: recentTransactions.length,
            }, 'Updated amount baselines');
        } catch (error: unknown) {
            logger.error({ err: error }, 'Error collecting amount data');
        }
    }

    /**
     * Update baselines using Welford's online algorithm
     * This allows incremental updates without storing all values
     */
    private updateBaselines(amounts: Array<{ operationType: AmountOperationType; asset: string; amount: number }>): void {
        // Group amounts by operation:asset
        const amountGroups = new Map<string, number[]>();

        for (const { operationType, asset, amount } of amounts) {
            const key = `${operationType}:${asset}`;
            if (!amountGroups.has(key)) {
                amountGroups.set(key, []);
            }
            amountGroups.get(key)!.push(amount);
        }

        // Calculate statistics for each group
        for (const [key, values] of Array.from(amountGroups.entries())) {
            const [operationType, asset] = key.split(':') as [AmountOperationType, string];

            // Sort for percentiles
            values.sort((a: number, b: number) => a - b);

            const n = values.length;
            if (n === 0) continue;

            const mean = values.reduce((a: number, b: number) => a + b, 0) / n;
            const variance = values.reduce((sum: number, d: number) => sum + Math.pow(d - mean, 2), 0) / n;
            const stdDev = Math.sqrt(variance);

            const baseline: AmountBaseline = {
                key,
                operationType,
                asset,
                mean: Math.round(mean * 100000) / 100000,  // More precision for crypto
                stdDev: Math.round(stdDev * 100000) / 100000,
                variance: Math.round(variance * 100000) / 100000,
                p50: values[Math.floor(n * 0.5)] || 0,
                p95: values[Math.floor(n * 0.95)] || 0,
                p99: values[Math.floor(n * 0.99)] || 0,
                min: values[0] || 0,
                max: values[n - 1] || 0,
                sampleCount: n,
                lastUpdated: new Date(),
            };

            this.baselines.set(key, baseline);
        }
    }

    /**
     * Manually record a transaction for baseline update
     * Called by order/transaction services in real-time
     */
    recordTransaction(operationType: AmountOperationType, asset: string, amount: number): void {
        const key = `${operationType}:${asset}`;
        const existing = this.baselines.get(key);

        if (!existing) {
            // Create new baseline
            this.baselines.set(key, {
                key,
                operationType,
                asset,
                mean: amount,
                stdDev: 0,
                variance: 0,
                p50: amount,
                p95: amount,
                p99: amount,
                min: amount,
                max: amount,
                sampleCount: 1,
                lastUpdated: new Date(),
            });
            return;
        }

        // Welford's online algorithm for incremental mean/variance
        const n = existing.sampleCount + 1;
        const delta = amount - existing.mean;
        const newMean = existing.mean + delta / n;
        const delta2 = amount - newMean;
        const newVariance = ((existing.variance * (n - 1)) + delta * delta2) / n;

        existing.mean = newMean;
        existing.variance = newVariance;
        existing.stdDev = Math.sqrt(newVariance);
        existing.sampleCount = n;
        existing.min = Math.min(existing.min, amount);
        existing.max = Math.max(existing.max, amount);
        existing.lastUpdated = new Date();
    }
}

// Singleton instance
export const amountProfiler = new AmountProfiler();
