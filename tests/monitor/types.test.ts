/**
 * Monitor Types Tests
 * 
 * Tests for type definitions and constants in the monitor module.
 */

import { describe, it, expect } from 'vitest';
import { SEVERITY_CONFIG } from '../../server/monitor/types';
import type {
    JaegerTrace,
    JaegerSpan,
    JaegerProcess,
    SpanBaseline,
    SeverityLevel,
    AdaptiveThresholds,
    TimeBaseline,
    Anomaly,
} from '../../server/monitor/types';

describe('Monitor Types', () => {
    // ============================================
    // SEVERITY_CONFIG
    // ============================================
    describe('SEVERITY_CONFIG', () => {
        it('should define all severity levels 1-5', () => {
            expect(SEVERITY_CONFIG[1]).toBeDefined();
            expect(SEVERITY_CONFIG[2]).toBeDefined();
            expect(SEVERITY_CONFIG[3]).toBeDefined();
            expect(SEVERITY_CONFIG[4]).toBeDefined();
            expect(SEVERITY_CONFIG[5]).toBeDefined();
        });

        it('should have Critical as SEV 1', () => {
            expect(SEVERITY_CONFIG[1].name).toBe('Critical');
            expect(SEVERITY_CONFIG[1].percentile).toBe(99.9);
        });

        it('should have Major as SEV 2', () => {
            expect(SEVERITY_CONFIG[2].name).toBe('Major');
            expect(SEVERITY_CONFIG[2].percentile).toBe(99);
        });

        it('should have Moderate as SEV 3', () => {
            expect(SEVERITY_CONFIG[3].name).toBe('Moderate');
            expect(SEVERITY_CONFIG[3].percentile).toBe(95);
        });

        it('should have Minor as SEV 4', () => {
            expect(SEVERITY_CONFIG[4].name).toBe('Minor');
            expect(SEVERITY_CONFIG[4].percentile).toBe(90);
        });

        it('should have Low as SEV 5', () => {
            expect(SEVERITY_CONFIG[5].name).toBe('Low');
            expect(SEVERITY_CONFIG[5].percentile).toBe(80);
        });

        it('should have colors for all severity levels', () => {
            for (let i = 1; i <= 5; i++) {
                const sev = i as SeverityLevel;
                expect(SEVERITY_CONFIG[sev].color).toMatch(/^#[a-f0-9]{6}$/);
            }
        });

        it('should have descending percentiles for increasing severity numbers', () => {
            // SEV 1 is most critical (highest percentile to trigger)
            expect(SEVERITY_CONFIG[1].percentile).toBeGreaterThan(SEVERITY_CONFIG[2].percentile);
            expect(SEVERITY_CONFIG[2].percentile).toBeGreaterThan(SEVERITY_CONFIG[3].percentile);
            expect(SEVERITY_CONFIG[3].percentile).toBeGreaterThan(SEVERITY_CONFIG[4].percentile);
            expect(SEVERITY_CONFIG[4].percentile).toBeGreaterThan(SEVERITY_CONFIG[5].percentile);
        });
    });

    // ============================================
    // Type Shape Tests (compile-time + runtime validation)
    // ============================================
    describe('Type Shapes', () => {
        it('should create valid JaegerSpan structure', () => {
            const span: JaegerSpan = {
                traceID: 'trace-123',
                spanID: 'span-456',
                operationName: 'HTTP GET /api/users',
                references: [
                    { refType: 'CHILD_OF', traceID: 'trace-123', spanID: 'span-parent' }
                ],
                startTime: 1704067200000000, // microseconds
                duration: 150000, // 150ms in microseconds
                tags: [
                    { key: 'http.method', type: 'string', value: 'GET' },
                    { key: 'http.status_code', type: 'int64', value: 200 }
                ],
                processID: 'p1'
            };

            expect(span.traceID).toBe('trace-123');
            expect(span.duration).toBe(150000);
            expect(span.tags).toHaveLength(2);
        });

        it('should create valid JaegerProcess structure', () => {
            const process: JaegerProcess = {
                serviceName: 'kx-wallet',
                tags: [
                    { key: 'hostname', type: 'string', value: 'pod-123' }
                ]
            };

            expect(process.serviceName).toBe('kx-wallet');
        });

        it('should create valid JaegerTrace structure', () => {
            const trace: JaegerTrace = {
                traceID: 'trace-abc',
                spans: [
                    {
                        traceID: 'trace-abc',
                        spanID: 'span-1',
                        operationName: 'root',
                        references: [],
                        startTime: 1704067200000000,
                        duration: 100000,
                        tags: [],
                        processID: 'p1'
                    }
                ],
                processes: {
                    p1: {
                        serviceName: 'api-gateway',
                        tags: []
                    }
                }
            };

            expect(trace.traceID).toBe('trace-abc');
            expect(trace.spans).toHaveLength(1);
            expect(trace.processes['p1'].serviceName).toBe('api-gateway');
        });

        it('should create valid SpanBaseline structure', () => {
            const baseline: SpanBaseline = {
                service: 'kx-wallet',
                operation: 'createTransfer',
                spanKey: 'kx-wallet:createTransfer',
                mean: 150.5,
                stdDev: 25.3,
                variance: 640.09,
                p50: 140,
                p95: 200,
                p99: 250,
                min: 80,
                max: 400,
                sampleCount: 1000,
                lastUpdated: new Date()
            };

            expect(baseline.spanKey).toBe('kx-wallet:createTransfer');
            expect(baseline.mean).toBe(150.5);
            expect(baseline.sampleCount).toBe(1000);
        });

        it('should create valid AdaptiveThresholds structure', () => {
            const thresholds: AdaptiveThresholds = {
                sev5: 1.3,
                sev4: 1.65,
                sev3: 2.0,
                sev2: 2.6,
                sev1: 3.3
            };

            expect(thresholds.sev1).toBeGreaterThan(thresholds.sev2);
            expect(thresholds.sev2).toBeGreaterThan(thresholds.sev3);
        });

        it('should create valid TimeBaseline structure', () => {
            const timeBaseline: TimeBaseline = {
                spanKey: 'kx-wallet:transfer',
                service: 'kx-wallet',
                operation: 'transfer',
                dayOfWeek: 1, // Monday
                hourOfDay: 14, // 2 PM
                mean: 120,
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
            };

            expect(timeBaseline.dayOfWeek).toBeGreaterThanOrEqual(0);
            expect(timeBaseline.dayOfWeek).toBeLessThanOrEqual(6);
            expect(timeBaseline.hourOfDay).toBeGreaterThanOrEqual(0);
            expect(timeBaseline.hourOfDay).toBeLessThanOrEqual(23);
        });

        it('should create valid Anomaly structure', () => {
            const anomaly: Anomaly = {
                id: 'anomaly-123',
                traceId: 'trace-456',
                spanId: 'span-789',
                service: 'kx-exchange',
                operation: 'executeOrder',
                duration: 5000, // 5 seconds
                expectedMean: 150,
                expectedStdDev: 30,
                deviation: 16.17, // (5000 - 150) / 30
                severity: 1,
                severityName: 'Critical',
                timestamp: new Date(),
                attributes: {
                    'http.method': 'POST',
                    'http.status_code': 500,
                    'error': true
                },
                dayOfWeek: 3,
                hourOfDay: 10
            };

            expect(anomaly.severity).toBe(1);
            expect(anomaly.deviation).toBeGreaterThan(3); // Should trigger SEV 1
            expect(anomaly.attributes['error']).toBe(true);
        });
    });

    // ============================================
    // Severity Level Type
    // ============================================
    describe('SeverityLevel', () => {
        it('should only allow values 1-5', () => {
            const validLevels: SeverityLevel[] = [1, 2, 3, 4, 5];
            
            validLevels.forEach(level => {
                expect(level).toBeGreaterThanOrEqual(1);
                expect(level).toBeLessThanOrEqual(5);
            });
        });
    });
});
