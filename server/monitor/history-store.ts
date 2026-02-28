/**
 * History Store
 * 
 * Persists baselines, anomalies, and analyses to PostgreSQL
 * for trend analysis and recovery after restart.
 */

import { drizzleDb } from '../db/drizzle';
import { spanBaselines, timeBaselines, anomalies as anomaliesTable } from '../db/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';
import type {
    SpanBaseline,
    Anomaly,
    AnalysisResponse,
    TimeBaseline,
    AdaptiveThresholds
} from './types';
import { createLogger } from '../lib/logger';

const logger = createLogger('history-store');

const MAX_ANOMALIES = 1000; // Keep last 1000 anomalies in memory cache

export class HistoryStore {
    // In-memory cache for analyses (not persisted to DB - ephemeral)
    private analysesCache: AnalysisResponse[] = [];

    constructor() {
        logger.info('History store initialized (PostgreSQL-backed)');
    }

    /**
     * Start - no-op for DB-backed store
     */
    start(): void {
        logger.info('History store started (PostgreSQL-backed)');
    }

    /**
     * Stop - no-op for DB-backed store
     */
    stop(): void {
        logger.info('History store stopped');
    }

    /**
     * Update baselines (ADDITIVE merge with existing data using weighted averages)
     */
    async updateBaselines(baselines: SpanBaseline[]): Promise<void> {
        try {
            // First, get existing baselines to merge with
            const existingRows = await drizzleDb.select().from(spanBaselines);
            const existingMap = new Map(existingRows.map(row => [row.spanKey, row]));

            for (const baseline of baselines) {
                const existing = existingMap.get(baseline.spanKey);

                if (existing) {
                    // ADDITIVE: Merge new data with existing using weighted average
                    const existingCount = existing.sampleCount;
                    const newCount = baseline.sampleCount;
                    const totalCount = existingCount + newCount;
                    const existingWeight = existingCount / totalCount;
                    const newWeight = newCount / totalCount;

                    // Weighted average for mean
                    const existingMean = parseFloat(existing.mean);
                    const mergedMean = existingMean * existingWeight + baseline.mean * newWeight;

                    // Combine stdDev using pooled variance formula
                    const existingStdDev = parseFloat(existing.stdDev);
                    const existingVar = existingStdDev * existingStdDev;
                    const newVar = baseline.stdDev * baseline.stdDev;
                    // Pooled variance: weighted average of variances + correction for mean difference
                    const meanDiffSq = Math.pow(existingMean - baseline.mean, 2);
                    const pooledVar = existingVar * existingWeight + newVar * newWeight +
                        meanDiffSq * existingWeight * newWeight;
                    const mergedStdDev = Math.sqrt(pooledVar);

                    // For percentiles, take the max of existing or new (conservative approach)
                    const mergedP50 = Math.max(parseFloat(existing.p50 || '0'), baseline.p50 || 0);
                    const mergedP95 = Math.max(parseFloat(existing.p95 || '0'), baseline.p95 || 0);
                    const mergedP99 = Math.max(parseFloat(existing.p99 || '0'), baseline.p99 || 0);
                    const mergedMin = Math.min(parseFloat(existing.min || '0') || Infinity, baseline.min || Infinity);
                    const mergedMax = Math.max(parseFloat(existing.max || '0'), baseline.max || 0);

                    await drizzleDb.update(spanBaselines)
                        .set({
                            mean: mergedMean.toFixed(2),
                            stdDev: mergedStdDev.toFixed(2),
                            variance: pooledVar.toFixed(2),
                            p50: mergedP50.toFixed(2),
                            p95: mergedP95.toFixed(2),
                            p99: mergedP99.toFixed(2),
                            min: mergedMin === Infinity ? '0' : mergedMin.toFixed(2),
                            max: mergedMax.toFixed(2),
                            sampleCount: totalCount,
                            updatedAt: new Date(),
                        })
                        .where(eq(spanBaselines.spanKey, baseline.spanKey));

                    logger.debug({ spanKey: baseline.spanKey, existingCount, newCount, totalCount }, 'Merged baseline (additive)');
                } else {
                    // New baseline - insert directly
                    await drizzleDb.insert(spanBaselines).values({
                        spanKey: baseline.spanKey,
                        service: baseline.service,
                        operation: baseline.operation,
                        mean: baseline.mean.toString(),
                        stdDev: baseline.stdDev.toString(),
                        variance: baseline.variance.toString(),
                        p50: baseline.p50?.toString(),
                        p95: baseline.p95?.toString(),
                        p99: baseline.p99?.toString(),
                        min: baseline.min?.toString(),
                        max: baseline.max?.toString(),
                        sampleCount: baseline.sampleCount,
                        updatedAt: new Date(),
                    }).onConflictDoNothing();

                    logger.debug({ spanKey: baseline.spanKey, sampleCount: baseline.sampleCount }, 'Inserted new baseline');
                }
            }
            logger.info({ count: baselines.length }, 'Updated span baselines in database (additive merge)');
        } catch (error) {
            logger.error({ err: error }, 'Failed to update baselines');
            throw error;
        }
    }

    /**
     * Add anomaly to database
     */
    async addAnomaly(anomaly: Anomaly): Promise<void> {
        try {
            await drizzleDb.insert(anomaliesTable).values({
                id: anomaly.id,
                traceId: anomaly.traceId,
                spanId: anomaly.spanId,
                service: anomaly.service,
                operation: anomaly.operation,
                duration: anomaly.duration.toString(),
                expectedMean: anomaly.expectedMean.toString(),
                expectedStdDev: anomaly.expectedStdDev.toString(),
                deviation: anomaly.deviation.toString(),
                severity: anomaly.severity,
                severityName: anomaly.severityName,
                attributes: anomaly.attributes,
                dayOfWeek: anomaly.dayOfWeek,
                hourOfDay: anomaly.hourOfDay,
                createdAt: new Date(anomaly.timestamp),
            }).onConflictDoNothing();

            logger.debug({ anomalyId: anomaly.id, service: anomaly.service }, 'Anomaly persisted');
        } catch (error) {
            logger.error({ err: error }, 'Failed to add anomaly');
        }
    }

    /**
     * Add analysis (in-memory cache only)
     */
    addAnalysis(analysis: AnalysisResponse): void {
        this.analysesCache.push(analysis);
        if (this.analysesCache.length > 100) {
            this.analysesCache = this.analysesCache.slice(-100);
        }
    }

    /**
     * Get anomaly history with optional filtering
     */
    async getAnomalyHistory(options: {
        hours?: number;
        service?: string;
        limit?: number;
    } = {}): Promise<Anomaly[]> {
        try {
            const conditions = [];

            if (options.hours) {
                const since = new Date(Date.now() - options.hours * 60 * 60 * 1000);
                conditions.push(gte(anomaliesTable.createdAt, since));
            }

            if (options.service) {
                conditions.push(eq(anomaliesTable.service, options.service));
            }

            const rows = await drizzleDb.select()
                .from(anomaliesTable)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(anomaliesTable.createdAt))
                .limit(options.limit || MAX_ANOMALIES);

            return rows.map(row => ({
                id: row.id,
                traceId: row.traceId,
                spanId: row.spanId,
                service: row.service,
                operation: row.operation,
                duration: parseFloat(row.duration),
                expectedMean: parseFloat(row.expectedMean),
                expectedStdDev: parseFloat(row.expectedStdDev),
                deviation: parseFloat(row.deviation),
                severity: row.severity as 1 | 2 | 3 | 4 | 5,
                severityName: row.severityName,
                timestamp: row.createdAt,
                attributes: row.attributes as Record<string, any> || {},
                dayOfWeek: row.dayOfWeek ?? undefined,
                hourOfDay: row.hourOfDay ?? undefined,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to get anomaly history');
            return [];
        }
    }

    /**
     * Get hourly anomaly counts for trend chart
     */
    async getHourlyTrend(hours: number = 24): Promise<Array<{ hour: string; count: number; critical: number }>> {
        const buckets = new Map<string, { count: number; critical: number }>();

        // Initialize hourly buckets
        const now = new Date();
        for (let i = 0; i < hours; i++) {
            const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
            const key = hour.toISOString().slice(0, 13);
            buckets.set(key, { count: 0, critical: 0 });
        }

        try {
            const since = new Date(Date.now() - hours * 60 * 60 * 1000);
            const rows = await drizzleDb.select()
                .from(anomaliesTable)
                .where(gte(anomaliesTable.createdAt, since));

            for (const row of rows) {
                const hour = new Date(row.createdAt).toISOString().slice(0, 13);
                if (buckets.has(hour)) {
                    const bucket = buckets.get(hour)!;
                    bucket.count++;
                    if (row.severity <= 2) {
                        bucket.critical++;
                    }
                }
            }
        } catch (error) {
            logger.error({ err: error }, 'Failed to get hourly trend');
        }

        return Array.from(buckets.entries())
            .map(([hour, data]) => ({
                hour: hour.slice(11) + ':00',
                count: data.count,
                critical: data.critical
            }))
            .reverse();
    }

    /**
     * Get stored baselines from database
     */
    async getBaselines(): Promise<SpanBaseline[]> {
        try {
            const rows = await drizzleDb.select().from(spanBaselines);
            return rows.map(row => ({
                spanKey: row.spanKey,
                service: row.service,
                operation: row.operation,
                mean: parseFloat(row.mean),
                stdDev: parseFloat(row.stdDev),
                variance: parseFloat(row.variance),
                p50: row.p50 ? parseFloat(row.p50) : 0,
                p95: row.p95 ? parseFloat(row.p95) : 0,
                p99: row.p99 ? parseFloat(row.p99) : 0,
                min: row.min ? parseFloat(row.min) : 0,
                max: row.max ? parseFloat(row.max) : 0,
                sampleCount: row.sampleCount,
                lastUpdated: row.updatedAt,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to get baselines');
            return [];
        }
    }

    /**
     * Get analysis for trace (from cache)
     */
    getAnalysis(traceId: string): AnalysisResponse | undefined {
        return this.analysesCache.find(a => a.traceId === traceId);
    }

    /**
     * Set time baselines (ADDITIVE merge with existing data using weighted averages)
     */
    async setTimeBaselines(baselines: TimeBaseline[]): Promise<void> {
        try {
            // First, get existing time baselines to merge with
            const existingRows = await drizzleDb.select().from(timeBaselines);
            const existingMap = new Map(existingRows.map(row =>
                [`${row.spanKey}:${row.dayOfWeek}:${row.hourOfDay}`, row]
            ));

            for (const baseline of baselines) {
                const key = `${baseline.spanKey}:${baseline.dayOfWeek}:${baseline.hourOfDay}`;
                const existing = existingMap.get(key);

                if (existing) {
                    // ADDITIVE: Merge new data with existing using weighted average
                    const existingCount = existing.sampleCount;
                    const newCount = baseline.sampleCount;
                    const totalCount = existingCount + newCount;
                    const existingWeight = existingCount / totalCount;
                    const newWeight = newCount / totalCount;

                    // Weighted average for mean
                    const existingMean = parseFloat(existing.mean);
                    const mergedMean = existingMean * existingWeight + baseline.mean * newWeight;

                    // Combine stdDev using pooled variance formula
                    const existingStdDev = parseFloat(existing.stdDev);
                    const existingVar = existingStdDev * existingStdDev;
                    const newVar = baseline.stdDev * baseline.stdDev;
                    const meanDiffSq = Math.pow(existingMean - baseline.mean, 2);
                    const pooledVar = existingVar * existingWeight + newVar * newWeight +
                        meanDiffSq * existingWeight * newWeight;
                    const mergedStdDev = Math.sqrt(pooledVar);

                    await drizzleDb.update(timeBaselines)
                        .set({
                            mean: mergedMean.toFixed(2),
                            stdDev: mergedStdDev.toFixed(2),
                            sampleCount: totalCount,
                            thresholds: baseline.thresholds, // Use latest thresholds
                            updatedAt: new Date(),
                        })
                        .where(and(
                            eq(timeBaselines.spanKey, baseline.spanKey),
                            eq(timeBaselines.dayOfWeek, baseline.dayOfWeek),
                            eq(timeBaselines.hourOfDay, baseline.hourOfDay)
                        ));

                    logger.debug({ key, existingCount, newCount, totalCount }, 'Merged time baseline (additive)');
                } else {
                    // New baseline - insert directly
                    await drizzleDb.insert(timeBaselines).values({
                        spanKey: baseline.spanKey,
                        service: baseline.service,
                        operation: baseline.operation,
                        dayOfWeek: baseline.dayOfWeek,
                        hourOfDay: baseline.hourOfDay,
                        mean: baseline.mean.toString(),
                        stdDev: baseline.stdDev.toString(),
                        sampleCount: baseline.sampleCount,
                        thresholds: baseline.thresholds,
                        updatedAt: new Date(),
                    }).onConflictDoNothing();

                    logger.debug({ spanKey: baseline.spanKey, sampleCount: baseline.sampleCount }, 'Inserted new time baseline');
                }
            }
            logger.info({ count: baselines.length }, 'Updated time baselines in database (additive merge)');
        } catch (error) {
            logger.error({ err: error }, 'Failed to set time baselines');
            throw error;
        }
    }

    /**
     * Get time baselines from database
     */
    async getTimeBaselines(): Promise<TimeBaseline[]> {
        try {
            const rows = await drizzleDb.select().from(timeBaselines);
            return rows.map(row => ({
                spanKey: row.spanKey,
                service: row.service,
                operation: row.operation,
                dayOfWeek: row.dayOfWeek,
                hourOfDay: row.hourOfDay,
                mean: parseFloat(row.mean),
                stdDev: parseFloat(row.stdDev),
                sampleCount: row.sampleCount,
                thresholds: row.thresholds as AdaptiveThresholds,
                lastUpdated: row.updatedAt,
            }));
        } catch (error) {
            logger.error({ err: error }, 'Failed to get time baselines');
            return [];
        }
    }
}

// Singleton instance
export const historyStore = new HistoryStore();
