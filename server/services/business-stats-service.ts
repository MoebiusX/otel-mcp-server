/**
 * Business Stats Service
 * 
 * Database-backed aggregation service for business KPIs.
 * Provides trade counts, volume, and user activity metrics.
 */

import db from '../db';
import { createLogger } from '../lib/logger';
import { setActiveUsers, syncTradesToday, recordTrade } from '../metrics/prometheus';

const logger = createLogger('business-stats');

// ============================================
// Types
// ============================================

export interface TradeStat {
    pair: string;
    side: string;
    count: number;
    volume: number;
    valueUsd: number;
}

export interface VolumeByPair {
    pair: string;
    volume: number;
    valueUsd: number;
    buyVolume: number;
    sellVolume: number;
}

export interface BusinessStats {
    activeUsers: number;
    tradesToday: TradeStat[];
    totalTradesToday: number;
    volumeByPair: VolumeByPair[];
    totalVolumeUsd: number;
    lastUpdated: Date;
}

// ============================================
// Service Implementation
// ============================================

class BusinessStatsService {
    private lastActiveUsersSync = 0;
    private readonly ACTIVE_USER_CACHE_MS = 30_000; // 30 seconds

    /**
     * Get comprehensive business stats
     * @param timezoneOffsetMinutes - User's timezone offset from UTC (e.g., -60 for UTC+1)
     */
    async getStats(timezoneOffsetMinutes: number = 0): Promise<BusinessStats> {
        const now = new Date();

        // Calculate user's local midnight in UTC
        const userLocalMidnight = this.getUserLocalMidnight(now, timezoneOffsetMinutes);

        const [activeUsers, tradesToday, volumeByPair] = await Promise.all([
            this.getActiveUsers(),
            this.getTradesToday(userLocalMidnight),
            this.getVolumeByPair(userLocalMidnight),
        ]);

        const totalTradesToday = tradesToday.reduce((sum, t) => sum + t.count, 0);
        const totalVolumeUsd = volumeByPair.reduce((sum, v) => sum + v.valueUsd, 0);

        // Sync to Prometheus gauges
        syncTradesToday(tradesToday);
        setActiveUsers(activeUsers);

        return {
            activeUsers,
            tradesToday,
            totalTradesToday,
            volumeByPair,
            totalVolumeUsd,
            lastUpdated: now,
        };
    }

    /**
     * Get count of users active in the last 15 minutes
     */
    async getActiveUsers(): Promise<number> {
        try {
            const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

            const result = await db.query(
                `SELECT COUNT(DISTINCT user_id) as count 
                 FROM sessions 
                 WHERE created_at > $1 OR expires_at > NOW()`,
                [fifteenMinutesAgo]
            );

            const count = parseInt(result.rows[0]?.count || '0', 10);
            return count;
        } catch (error) {
            logger.error({ err: error }, 'Failed to get active users');
            return 0;
        }
    }

    /**
     * Get trades since user's local midnight
     */
    async getTradesToday(userLocalMidnight: Date): Promise<TradeStat[]> {
        try {
            const result = await db.query(
                `SELECT 
                    pair,
                    side,
                    COUNT(*) as count,
                    COALESCE(SUM(CAST(quantity AS DECIMAL)), 0) as volume,
                    COALESCE(SUM(CAST(quantity AS DECIMAL) * COALESCE(CAST(price AS DECIMAL), 0)), 0) as value_usd
                 FROM orders
                 WHERE status = 'filled' 
                   AND created_at >= $1
                 GROUP BY pair, side
                 ORDER BY pair, side`,
                [userLocalMidnight]
            );

            return result.rows.map(row => ({
                pair: row.pair,
                side: row.side.toUpperCase(),
                count: parseInt(row.count, 10),
                volume: parseFloat(row.volume) || 0,
                valueUsd: parseFloat(row.value_usd) || 0,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to get trades today');
            return [];
        }
    }

    /**
     * Get volume aggregated by pair
     */
    async getVolumeByPair(since: Date): Promise<VolumeByPair[]> {
        try {
            const result = await db.query(
                `SELECT 
                    pair,
                    COALESCE(SUM(CAST(quantity AS DECIMAL)), 0) as total_volume,
                    COALESCE(SUM(CAST(quantity AS DECIMAL) * COALESCE(CAST(price AS DECIMAL), 0)), 0) as total_value_usd,
                    COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN CAST(quantity AS DECIMAL) ELSE 0 END), 0) as buy_volume,
                    COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN CAST(quantity AS DECIMAL) ELSE 0 END), 0) as sell_volume
                 FROM orders
                 WHERE status = 'filled' 
                   AND created_at >= $1
                 GROUP BY pair
                 ORDER BY total_value_usd DESC`,
                [since]
            );

            return result.rows.map(row => ({
                pair: row.pair,
                volume: parseFloat(row.total_volume) || 0,
                valueUsd: parseFloat(row.total_value_usd) || 0,
                buyVolume: parseFloat(row.buy_volume) || 0,
                sellVolume: parseFloat(row.sell_volume) || 0,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to get volume by pair');
            return [];
        }
    }

    /**
     * Get all-time volume stats
     */
    async getAllTimeVolume(): Promise<VolumeByPair[]> {
        try {
            const result = await db.query(
                `SELECT 
                    pair,
                    COALESCE(SUM(CAST(quantity AS DECIMAL)), 0) as total_volume,
                    COALESCE(SUM(CAST(quantity AS DECIMAL) * COALESCE(CAST(price AS DECIMAL), 0)), 0) as total_value_usd,
                    COALESCE(SUM(CASE WHEN UPPER(side) = 'BUY' THEN CAST(quantity AS DECIMAL) ELSE 0 END), 0) as buy_volume,
                    COALESCE(SUM(CASE WHEN UPPER(side) = 'SELL' THEN CAST(quantity AS DECIMAL) ELSE 0 END), 0) as sell_volume
                 FROM orders
                 WHERE status = 'filled'
                 GROUP BY pair
                 ORDER BY total_value_usd DESC`
            );

            return result.rows.map(row => ({
                pair: row.pair,
                volume: parseFloat(row.total_volume) || 0,
                valueUsd: parseFloat(row.total_value_usd) || 0,
                buyVolume: parseFloat(row.buy_volume) || 0,
                sellVolume: parseFloat(row.sell_volume) || 0,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to get all-time volume');
            return [];
        }
    }

    /**
     * Get recent user activity (last 15 minutes)
     */
    async getRecentActivity(limit: number = 20): Promise<Array<{
        userId: string;
        email: string;
        lastActivity: Date;
        activityType: string;
    }>> {
        try {
            const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

            // Combine session and order activity
            const result = await db.query(
                `SELECT DISTINCT ON (user_id) 
                    u.id as user_id,
                    u.email,
                    GREATEST(
                        COALESCE(s.created_at, '1970-01-01'::timestamptz),
                        COALESCE(o.created_at, '1970-01-01'::timestamptz)
                    ) as last_activity,
                    CASE 
                        WHEN o.created_at > COALESCE(s.created_at, '1970-01-01'::timestamptz) THEN 'trade'
                        ELSE 'session'
                    END as activity_type
                 FROM users u
                 LEFT JOIN sessions s ON u.id = s.user_id AND s.created_at > $1
                 LEFT JOIN orders o ON u.id = o.user_id AND o.created_at > $1
                 WHERE s.id IS NOT NULL OR o.id IS NOT NULL
                 ORDER BY user_id, last_activity DESC
                 LIMIT $2`,
                [fifteenMinutesAgo, limit]
            );

            return result.rows.map(row => ({
                userId: row.user_id,
                email: row.email,
                lastActivity: new Date(row.last_activity),
                activityType: row.activity_type,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to get recent activity');
            return [];
        }
    }

    /**
     * Record a trade for metrics (called from order service)
     */
    recordTradeExecution(pair: string, side: string, quantity: number, valueUsd: number): void {
        recordTrade(pair, side, quantity, valueUsd);
    }

    /**
     * Calculate user's local midnight in UTC
     */
    private getUserLocalMidnight(now: Date, timezoneOffsetMinutes: number): Date {
        // timezoneOffsetMinutes is like getTimezoneOffset() - positive for west of UTC
        // For UTC+1, offset would be -60
        const userLocalTime = new Date(now.getTime() - timezoneOffsetMinutes * 60 * 1000);

        // Set to midnight in user's local time
        const midnight = new Date(userLocalTime);
        midnight.setUTCHours(0, 0, 0, 0);

        // Convert back to UTC
        return new Date(midnight.getTime() + timezoneOffsetMinutes * 60 * 1000);
    }
}

// Singleton export
export const businessStatsService = new BusinessStatsService();
