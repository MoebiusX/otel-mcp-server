/**
 * History Store Tests
 * 
 * Tests for the monitor history persistence store.
 * Now using PostgreSQL via Drizzle ORM.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpanBaseline, Anomaly, AnalysisResponse, TimeBaseline } from '../../server/monitor/types';

// Use vi.hoisted for mock references that need to be available before imports
const mocks = vi.hoisted(() => {
    return {
        insert: vi.fn(),
        select: vi.fn(),
    };
});

// Mock logger first
vi.mock('../../server/lib/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })
}));

// Mock drizzle DB
vi.mock('../../server/db/drizzle', () => ({
    drizzleDb: mocks
}));

// Mock schema
vi.mock('../../server/db/schema', () => ({
    spanBaselines: { spanKey: 'span_key' },
    timeBaselines: { spanKey: 'span_key', dayOfWeek: 'day', hourOfDay: 'hour' },
    anomalies: { createdAt: 'created_at', service: 'service' },
}));

// Import after mocks
import { HistoryStore } from '../../server/monitor/history-store';

describe('HistoryStore', () => {
    let store: HistoryStore;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup mock chain for insert
        const mockOnConflictDoUpdate = vi.fn().mockResolvedValue([]);
        const mockOnConflictDoNothing = vi.fn().mockResolvedValue([]);
        const mockValues = vi.fn().mockReturnValue({
            onConflictDoUpdate: mockOnConflictDoUpdate,
            onConflictDoNothing: mockOnConflictDoNothing,
        });
        mocks.insert.mockReturnValue({
            values: mockValues,
        });

        // Setup mock chain for select
        // Some methods (updateBaselines, setTimeBaselines) await select().from() directly (returns array)
        // Others (getAnomalyHistory) chain .where().orderBy().limit()
        const mockLimit = vi.fn().mockResolvedValue([]);
        const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
        const mockWhere = vi.fn().mockReturnValue({
            orderBy: mockOrderBy,
            limit: mockLimit,
        });
        // mockFrom must behave as both a thenable (resolving to []) and have chainable methods
        const mockFromResult = Object.assign(Promise.resolve([]), {
            where: mockWhere,
            orderBy: mockOrderBy,
            limit: mockLimit,
        });
        const mockFrom = vi.fn().mockReturnValue(mockFromResult);
        mocks.select.mockReturnValue({
            from: mockFrom,
        });

        store = new HistoryStore();
    });

    afterEach(() => {
        store.stop();
    });

    // ============================================
    // Initialization
    // ============================================
    describe('Initialization', () => {
        it('should create store instance', () => {
            expect(store).toBeDefined();
        });

        it('should start without error', () => {
            store.start();
            expect(store).toBeDefined();
        });

        it('should stop without error', () => {
            store.start();
            store.stop();
            expect(store).toBeDefined();
        });
    });

    // ============================================
    // Baseline Operations
    // ============================================
    describe('Baseline Operations', () => {
        it('should update baselines via database', async () => {
            const baselines: SpanBaseline[] = [
                {
                    service: 'kx-wallet',
                    operation: 'transfer',
                    spanKey: 'kx-wallet:transfer',
                    mean: 100,
                    stdDev: 20,
                    variance: 400,
                    p50: 95,
                    p95: 140,
                    p99: 180,
                    min: 50,
                    max: 200,
                    sampleCount: 1000,
                    lastUpdated: new Date()
                }
            ];

            await store.updateBaselines(baselines);
            expect(mocks.insert).toHaveBeenCalled();
        });

        it('should get baselines from database', async () => {
            const baselines = await store.getBaselines();
            expect(Array.isArray(baselines)).toBe(true);
            expect(mocks.select).toHaveBeenCalled();
        });
    });

    // ============================================
    // Anomaly Operations
    // ============================================
    describe('Anomaly Operations', () => {
        const createAnomaly = (id: string, service: string, severity: 1 | 2 | 3 | 4 | 5 = 3): Anomaly => ({
            id,
            traceId: `trace-${id}`,
            spanId: `span-${id}`,
            service,
            operation: 'test-op',
            duration: 500,
            expectedMean: 100,
            expectedStdDev: 30,
            deviation: 13.3,
            severity,
            severityName: 'Moderate',
            timestamp: new Date(),
            attributes: {}
        });

        it('should add anomaly to database', async () => {
            const anomaly = createAnomaly('a1', 'kx-wallet');
            await store.addAnomaly(anomaly);
            expect(mocks.insert).toHaveBeenCalled();
        });

        it('should get anomaly history from database', async () => {
            const history = await store.getAnomalyHistory();
            expect(Array.isArray(history)).toBe(true);
            expect(mocks.select).toHaveBeenCalled();
        });

        it('should support filter options', async () => {
            await store.getAnomalyHistory({ hours: 1 });
            await store.getAnomalyHistory({ service: 'kx-wallet' });
            await store.getAnomalyHistory({ limit: 5 });
            expect(mocks.select).toHaveBeenCalledTimes(3);
        });
    });

    // ============================================
    // Analysis Operations (in-memory cache)
    // ============================================
    describe('Analysis Operations', () => {
        it('should add analysis to cache', () => {
            const analysis: AnalysisResponse = {
                traceId: 'trace-1',
                summary: 'Test analysis',
                possibleCauses: ['Database timeout'],
                recommendations: ['Check connection pool'],
                confidence: 'high',
                analyzedAt: new Date()
            };

            store.addAnalysis(analysis);
            const cached = store.getAnalysis('trace-1');
            expect(cached?.summary).toBe('Test analysis');
        });

        it('should return undefined for non-existent analysis', () => {
            const result = store.getAnalysis('nonexistent');
            expect(result).toBeUndefined();
        });
    });

    // ============================================
    // Hourly Trend
    // ============================================
    describe('Hourly Trend', () => {
        it('should return hourly trend data', async () => {
            const trend = await store.getHourlyTrend(24);
            expect(Array.isArray(trend)).toBe(true);
        });

        it('should include hour, count, and critical fields', async () => {
            const trend = await store.getHourlyTrend(1);
            expect(trend.length).toBeGreaterThan(0);
            expect(trend[0]).toHaveProperty('hour');
            expect(trend[0]).toHaveProperty('count');
            expect(trend[0]).toHaveProperty('critical');
        });
    });

    // ============================================
    // Time Baselines
    // ============================================
    describe('Time Baselines', () => {
        it('should update time baselines via database', async () => {
            const timeBaselines: TimeBaseline[] = [
                {
                    spanKey: 'kx-wallet:transfer',
                    service: 'kx-wallet',
                    operation: 'transfer',
                    dayOfWeek: 1,
                    hourOfDay: 10,
                    mean: 100,
                    stdDev: 20,
                    sampleCount: 500,
                    thresholds: {
                        sev5: 1.3,
                        sev4: 1.65,
                        sev3: 2.0,
                        sev2: 2.6,
                        sev1: 3.3
                    },
                    lastUpdated: new Date()
                }
            ];

            await store.setTimeBaselines(timeBaselines);
            expect(mocks.insert).toHaveBeenCalled();
        });

        it('should get time baselines from database', async () => {
            const baselines = await store.getTimeBaselines();
            expect(Array.isArray(baselines)).toBe(true);
            expect(mocks.select).toHaveBeenCalled();
        });
    });
});
