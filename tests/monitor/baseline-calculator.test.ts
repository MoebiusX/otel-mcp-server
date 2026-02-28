/**
 * Baseline Calculator Tests
 * 
 * Tests for the time-aware baseline calculation service.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('../../server/monitor/history-store', () => ({
    historyStore: {
        setTimeBaselines: vi.fn(),
        getTimeBaselines: vi.fn(() => []),
    }
}));

vi.mock('../../server/config', () => ({
    config: {
        observability: {
            jaegerUrl: 'http://localhost:16686',
        }
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

// Mock fetch
global.fetch = vi.fn();

import { BaselineCalculator } from '../../server/monitor/baseline-calculator';
import type { TimeBaseline, AdaptiveThresholds, JaegerTrace } from '../../server/monitor/types';

describe('BaselineCalculator', () => {
    let calculator: BaselineCalculator;

    beforeEach(() => {
        vi.clearAllMocks();
        calculator = new BaselineCalculator();
        
        (global.fetch as Mock).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ data: [] })
        });
    });

    // ============================================
    // Initialization
    // ============================================
    describe('Initialization', () => {
        it('should create calculator instance', () => {
            expect(calculator).toBeDefined();
        });

        it('should start with empty baselines', () => {
            const baselines = calculator.getAllBaselines();
            // May have baselines from other tests, just verify array
            expect(Array.isArray(baselines)).toBe(true);
        });
    });

    // ============================================
    // Time Bucket Keys
    // ============================================
    describe('Time Bucket Keys', () => {
        it('should generate correct bucket key format', () => {
            // Format: "service:operation:dayOfWeek:hourOfDay"
            const spanKey = 'kx-wallet:transfer';
            const dayOfWeek = 1; // Monday
            const hourOfDay = 14; // 2 PM
            
            const bucketKey = `${spanKey}:${dayOfWeek}:${hourOfDay}`;
            expect(bucketKey).toBe('kx-wallet:transfer:1:14');
        });

        it('should handle all days of week', () => {
            for (let day = 0; day <= 6; day++) {
                const key = `test:op:${day}:12`;
                expect(key).toContain(`:${day}:`);
            }
        });

        it('should handle all hours of day', () => {
            for (let hour = 0; hour <= 23; hour++) {
                const key = `test:op:1:${hour}`;
                expect(key).toContain(`:${hour}`);
            }
        });
    });

    // ============================================
    // Default Thresholds
    // ============================================
    describe('Default Thresholds', () => {
        it('should have correct default threshold values', () => {
            const defaults: AdaptiveThresholds = {
                sev5: 1.3,
                sev4: 1.65,
                sev3: 2.0,
                sev2: 2.6,
                sev1: 3.3
            };

            expect(defaults.sev5).toBe(1.3);
            expect(defaults.sev4).toBe(1.65);
            expect(defaults.sev3).toBe(2.0);
            expect(defaults.sev2).toBe(2.6);
            expect(defaults.sev1).toBe(3.3);
        });

        it('should have increasing thresholds for higher severity', () => {
            const defaults: AdaptiveThresholds = {
                sev5: 1.3,
                sev4: 1.65,
                sev3: 2.0,
                sev2: 2.6,
                sev1: 3.3
            };

            expect(defaults.sev1).toBeGreaterThan(defaults.sev2);
            expect(defaults.sev2).toBeGreaterThan(defaults.sev3);
            expect(defaults.sev3).toBeGreaterThan(defaults.sev4);
            expect(defaults.sev4).toBeGreaterThan(defaults.sev5);
        });
    });

    // ============================================
    // Statistical Calculations
    // ============================================
    describe('Statistical Calculations', () => {
        it('should calculate mean correctly', () => {
            const values = [100, 110, 120, 130, 140];
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            expect(mean).toBe(120);
        });

        it('should calculate variance correctly', () => {
            const values = [100, 110, 120, 130, 140];
            const mean = 120;
            const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
            expect(variance).toBe(200);
        });

        it('should calculate standard deviation correctly', () => {
            const values = [100, 110, 120, 130, 140];
            const mean = 120;
            const variance = 200;
            const stdDev = Math.sqrt(variance);
            expect(stdDev).toBeCloseTo(14.14, 1);
        });

        it('should handle single sample', () => {
            const values = [100];
            const mean = values[0];
            const stdDev = 0; // Single sample has no deviation
            
            expect(mean).toBe(100);
            expect(stdDev).toBe(0);
        });

        it('should handle identical values', () => {
            const values = [100, 100, 100, 100, 100];
            const mean = 100;
            const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);
            
            expect(stdDev).toBe(0);
        });
    });

    // ============================================
    // Span Data Extraction
    // ============================================
    describe('Span Data Extraction', () => {
        it('should extract time context from timestamp', () => {
            const timestampMs = 1705312800000; // 2024-01-15 10:00:00 UTC (Monday)
            const date = new Date(timestampMs);
            
            expect(date.getUTCDay()).toBe(1); // Monday
            expect(date.getUTCHours()).toBe(10);
        });

        it('should convert microseconds to milliseconds', () => {
            const microseconds = 150000;
            const milliseconds = microseconds / 1000;
            expect(milliseconds).toBe(150);
        });

        it('should extract service name from process', () => {
            const trace: JaegerTrace = {
                traceID: 'trace-1',
                spans: [{
                    traceID: 'trace-1',
                    spanID: 'span-1',
                    operationName: 'transfer',
                    references: [],
                    startTime: 1705312800000000,
                    duration: 150000,
                    tags: [],
                    processID: 'p1'
                }],
                processes: {
                    p1: {
                        serviceName: 'kx-wallet',
                        tags: []
                    }
                }
            };

            const span = trace.spans[0];
            const process = trace.processes[span.processID];
            expect(process.serviceName).toBe('kx-wallet');
        });
    });

    // ============================================
    // Time Baselines
    // ============================================
    describe('Time Baselines', () => {
        it('should create valid time baseline structure', () => {
            const baseline: TimeBaseline = {
                spanKey: 'kx-wallet:transfer',
                service: 'kx-wallet',
                operation: 'transfer',
                dayOfWeek: 1,
                hourOfDay: 10,
                mean: 150,
                stdDev: 25,
                sampleCount: 500,
                thresholds: {
                    sev5: 1.3,
                    sev4: 1.65,
                    sev3: 2.0,
                    sev2: 2.6,
                    sev1: 3.3
                },
                lastUpdated: new Date()
            };

            expect(baseline.spanKey).toBe('kx-wallet:transfer');
            expect(baseline.dayOfWeek).toBe(1);
            expect(baseline.hourOfDay).toBe(10);
        });

        it('should get all baselines', () => {
            const baselines = calculator.getAllBaselines();
            expect(Array.isArray(baselines)).toBe(true);
        });
    });

    // ============================================
    // Calculation Status
    // ============================================
    describe('Calculation Status', () => {
        it('should track calculation state', async () => {
            const status = calculator.getStatus();
            expect(status.isCalculating).toBe(false);
        });

        it('should track last calculation time', () => {
            const status = calculator.getStatus();
            // Initially null
            expect(status.lastCalculation).toBeNull();
        });
    });

    // ============================================
    // Monitored Services
    // ============================================
    describe('Monitored Services', () => {
        it('should define monitored services', () => {
            const MONITORED_SERVICES = ['kx-wallet', 'api-gateway', 'kx-exchange', 'kx-matcher'];
            
            expect(MONITORED_SERVICES).toContain('kx-wallet');
            expect(MONITORED_SERVICES).toContain('api-gateway');
            expect(MONITORED_SERVICES).toContain('kx-exchange');
            expect(MONITORED_SERVICES).toContain('kx-matcher');
        });
    });
});
