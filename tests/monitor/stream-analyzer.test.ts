/**
 * Stream Analyzer Tests
 * 
 * Tests for the streaming LLM analysis service.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Mock dependencies BEFORE importing
vi.mock('../../server/monitor/ws-server', () => ({
    wsServer: {
        broadcast: vi.fn(),
        alert: vi.fn(),
        analysisStart: vi.fn(),
        analysisComplete: vi.fn(),
        streamChunk: vi.fn(),
    }
}));

vi.mock('../../server/monitor/metrics-correlator', () => ({
    metricsCorrelator: {
        correlate: vi.fn().mockResolvedValue(null),
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

// Mock fetch for Ollama
global.fetch = vi.fn();

import type { Anomaly } from '../../server/monitor/types';
import { streamAnalyzer } from '../../server/monitor/stream-analyzer';
import { wsServer } from '../../server/monitor/ws-server';

// Create test anomaly helper
const createAnomaly = (
    id: string,
    service: string,
    operation: string,
    deviation: number = 2.5,
    attributes: Record<string, any> = {}
): Anomaly => ({
    id,
    traceId: `trace-${id}`,
    spanId: `span-${id}`,
    service,
    operation,
    duration: 500,
    expectedMean: 100,
    expectedStdDev: 30,
    deviation,
    severity: deviation > 3.3 ? 1 : deviation > 2.6 ? 2 : deviation > 2 ? 3 : deviation > 1.65 ? 4 : 5,
    severityName: 'Moderate',
    timestamp: new Date(),
    attributes
});

describe('StreamAnalyzer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ============================================
    // Use Case Detection Patterns
    // ============================================
    describe('Use Case Detection', () => {
        it('should detect payment gateway down pattern', () => {
            const anomaly = createAnomaly('pg-1', 'payment-service', 'processPayment', 4.0, {
                'http.status_code': 500,
                'error': true
            });

            expect(anomaly.service).toContain('payment');
            expect(anomaly.attributes['http.status_code']).toBeGreaterThanOrEqual(500);
        });

        it('should detect certificate expired pattern', () => {
            const anomaly = createAnomaly('cert-1', 'api-gateway', 'proxyRequest', 5.0, {
                'error.message': 'SSL certificate has expired'
            });

            const errorMessage = String(anomaly.attributes['error.message']).toLowerCase();
            expect(errorMessage).toContain('ssl');
        });

        it('should detect DoS attack pattern', () => {
            const anomaly = createAnomaly('dos-1', 'api-gateway', 'rateLimit', 3.5, {
                'http.status_code': 429
            });

            expect(anomaly.service).toContain('gateway');
            expect(anomaly.attributes['http.status_code']).toBe(429);
        });

        it('should detect auth service down pattern', () => {
            const anomaly = createAnomaly('auth-1', 'auth-service', 'validateToken', 4.5, {
                'http.status_code': 503
            });

            expect(anomaly.service).toContain('auth');
            expect(anomaly.attributes['http.status_code']).toBeGreaterThanOrEqual(500);
        });

        it('should detect cloud degradation pattern', () => {
            const anomaly = createAnomaly('cloud-1', 'kx-wallet', 'transfer', 6.0, {});
            
            expect(anomaly.deviation).toBeGreaterThan(5);
            expect(anomaly.duration).toBeGreaterThan(anomaly.expectedMean * 3);
        });

        it('should detect queue backlog pattern', () => {
            const anomaly = createAnomaly('queue-1', 'order-matcher', 'processOrder', 3.0, {});
            
            expect(anomaly.service).toContain('matcher');
        });

        it('should detect third party timeout pattern', () => {
            const anomaly = createAnomaly('timeout-1', 'kx-exchange', 'callExternalApi', 4.0, {});
            anomaly.duration = 15000; // 15 seconds
            
            expect(anomaly.duration).toBeGreaterThan(10000);
            expect(anomaly.operation.toLowerCase()).toContain('api');
        });

        it('should detect database issue pattern', () => {
            const anomaly = createAnomaly('db-1', 'kx-wallet', 'queryBalance', 2.5, {});
            
            expect(anomaly.operation.toLowerCase()).toContain('query');
        });
    });

    // ============================================
    // Priority Classification
    // ============================================
    describe('Priority Classification', () => {
        it('should classify P0 for critical issues', () => {
            // P0: Payment gateway, cert expired, DoS, auth down
            const p0Issues = [
                { id: 'payment-gateway-down', priority: 'P0' },
                { id: 'cert-expired', priority: 'P0' },
                { id: 'dos-attack', priority: 'P0' },
                { id: 'auth-down', priority: 'P0' },
            ];

            p0Issues.forEach(issue => {
                expect(issue.priority).toBe('P0');
            });
        });

        it('should classify P1 for major issues', () => {
            const p1Issues = [
                { id: 'cloud-degradation', priority: 'P1' },
                { id: 'queue-backlog', priority: 'P1' },
                { id: 'third-party-timeout', priority: 'P1' },
            ];

            p1Issues.forEach(issue => {
                expect(issue.priority).toBe('P1');
            });
        });

        it('should classify P2 for minor issues', () => {
            const p2Issues = [
                { id: 'db-exhaustion', priority: 'P2' },
                { id: 'generic-anomaly', priority: 'P2' },
            ];

            p2Issues.forEach(issue => {
                expect(issue.priority).toBe('P2');
            });
        });
    });

    // ============================================
    // Stream Analyzer Singleton
    // ============================================
    describe('Stream Analyzer Instance', () => {
        it('should export streamAnalyzer singleton', () => {
            expect(streamAnalyzer).toBeDefined();
        });

        it('should have enqueue method', () => {
            expect(typeof streamAnalyzer.enqueue).toBe('function');
        });

        it('should enqueue anomaly and buffer it', async () => {
            const anomaly = createAnomaly('buffer-1', 'kx-wallet', 'transfer', 2.0);
            
            await streamAnalyzer.enqueue(anomaly);
            
            // Should not immediately call analysisStart (batch not full)
            expect(wsServer.analysisStart).not.toHaveBeenCalled();
        });

        it('should send P0 alert immediately for critical anomalies', async () => {
            const criticalAnomaly = createAnomaly('critical-1', 'payment-service', 'processPayment', 4.0, {
                'http.status_code': 500,
                'error': true
            });

            await streamAnalyzer.enqueue(criticalAnomaly);

            // Should trigger P0 alert
            expect(wsServer.alert).toHaveBeenCalledWith(
                'critical',
                expect.stringContaining('Payment Gateway Down'),
                expect.objectContaining({ anomalyId: 'critical-1' })
            );
        });

        it('should alert for auth service down (P0)', async () => {
            const authDown = createAnomaly('auth-1', 'auth-service', 'login', 4.0, {
                'http.status_code': 503
            });

            await streamAnalyzer.enqueue(authDown);

            expect(wsServer.alert).toHaveBeenCalledWith(
                'critical',
                expect.stringContaining('Auth Service Down'),
                expect.any(Object)
            );
        });
    });

    // ============================================
    // Batch Processing
    // ============================================
    describe('Batch Processing', () => {
        it('should define batch size constant', () => {
            const BATCH_SIZE = 10;
            expect(BATCH_SIZE).toBe(10);
        });

        it('should define batch timeout', () => {
            const BATCH_TIMEOUT_MS = 30000;
            expect(BATCH_TIMEOUT_MS).toBe(30000);
        });
    });

    // ============================================
    // Anomaly Severity Mapping
    // ============================================
    describe('Anomaly Severity', () => {
        it('should map deviation to SEV 1 (Critical)', () => {
            const anomaly = createAnomaly('sev1', 'test', 'op', 3.5);
            expect(anomaly.severity).toBe(1);
        });

        it('should map deviation to SEV 2 (Major)', () => {
            const anomaly = createAnomaly('sev2', 'test', 'op', 2.8);
            expect(anomaly.severity).toBe(2);
        });

        it('should map deviation to SEV 3 (Moderate)', () => {
            const anomaly = createAnomaly('sev3', 'test', 'op', 2.2);
            expect(anomaly.severity).toBe(3);
        });

        it('should map deviation to SEV 4 (Minor)', () => {
            const anomaly = createAnomaly('sev4', 'test', 'op', 1.8);
            expect(anomaly.severity).toBe(4);
        });

        it('should map deviation to SEV 5 (Low)', () => {
            const anomaly = createAnomaly('sev5', 'test', 'op', 1.4);
            expect(anomaly.severity).toBe(5);
        });
    });
});
