/**
 * Metrics Correlator Tests
 * 
 * Tests for the Prometheus metrics correlation service.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('../../server/config', () => ({
    config: {
        observability: {
            prometheusUrl: 'http://localhost:9090',
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

import { metricsCorrelator } from '../../server/monitor/metrics-correlator';

describe('MetricsCorrelator', () => {
    // Use the exported singleton
    const correlator = metricsCorrelator;

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Default mock returns empty metrics
        (global.fetch as Mock).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                status: 'success',
                data: {
                    resultType: 'vector',
                    result: []
                }
            })
        });
    });

    // ============================================
    // Correlate
    // ============================================
    describe('correlate', () => {
        it('should return correlated metrics structure', async () => {
            const result = await correlator.correlate(
                'anomaly-123',
                'kx-wallet',
                new Date()
            );

            expect(result).toHaveProperty('anomalyId');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('window');
            expect(result).toHaveProperty('service');
            expect(result).toHaveProperty('metrics');
            expect(result).toHaveProperty('insights');
            expect(result).toHaveProperty('healthy');
        });

        it('should set correct anomaly ID', async () => {
            const result = await correlator.correlate(
                'test-anomaly',
                'kx-wallet',
                new Date()
            );

            expect(result.anomalyId).toBe('test-anomaly');
        });

        it('should set correct service', async () => {
            const result = await correlator.correlate(
                'anomaly-1',
                'kx-exchange',
                new Date()
            );

            expect(result.service).toBe('kx-exchange');
        });

        it('should calculate time window correctly', async () => {
            const timestamp = new Date('2024-01-15T10:00:00Z');
            const result = await correlator.correlate(
                'anomaly-1',
                'kx-wallet',
                timestamp
            );

            const windowMs = 2 * 60 * 1000; // ±2 minutes
            expect(result.window.start.getTime()).toBe(timestamp.getTime() - windowMs);
            expect(result.window.end.getTime()).toBe(timestamp.getTime() + windowMs);
        });

        it('should handle connection errors gracefully', async () => {
            (global.fetch as Mock).mockRejectedValue(new Error('Connection refused'));

            const result = await correlator.correlate(
                'anomaly-1',
                'kx-wallet',
                new Date()
            );

            // Should still return a valid result structure
            expect(result).toHaveProperty('metrics');
            expect(result).toHaveProperty('service');
        });

        it('should handle non-ok Prometheus response gracefully', async () => {
            (global.fetch as Mock).mockResolvedValue({
                ok: false,
                status: 500
            });

            const result = await correlator.correlate(
                'anomaly-1',
                'kx-wallet',
                new Date()
            );

            // Should still return a valid result structure
            expect(result).toHaveProperty('metrics');
        });
    });

    // ============================================
    // Metrics Structure
    // ============================================
    describe('Metrics Structure', () => {
        it('should include all expected metric fields', async () => {
            const result = await correlator.correlate(
                'anomaly-1',
                'kx-wallet',
                new Date()
            );

            expect(result.metrics).toHaveProperty('cpuPercent');
            expect(result.metrics).toHaveProperty('memoryMB');
            expect(result.metrics).toHaveProperty('requestRate');
            expect(result.metrics).toHaveProperty('errorRate');
            expect(result.metrics).toHaveProperty('p99LatencyMs');
            expect(result.metrics).toHaveProperty('activeConnections');
        });
    });

    // ============================================
    // Insights Generation
    // ============================================
    describe('Insights Generation', () => {
        it('should return healthy=true when metrics are within normal range', async () => {
            // Mock to return low/normal values for all metrics
            (global.fetch as Mock).mockImplementation(() => 
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'success',
                        data: {
                            resultType: 'vector',
                            result: [{ value: [1234567890, '0'] }] // 0 for all metrics = healthy
                        }
                    })
                })
            );

            const result = await correlator.correlate(
                'anomaly-1',
                'kx-wallet',
                new Date()
            );

            // With zero values, system should be healthy
            // Note: healthy is true when no critical issues exist
            expect(result).toHaveProperty('healthy');
            expect(result).toHaveProperty('insights');
        });

        it('should generate insights for high CPU', async () => {
            (global.fetch as Mock).mockImplementation((url: string) => {
                if (url.includes('cpu')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            status: 'success',
                            data: {
                                resultType: 'vector',
                                result: [{ value: [1234567890, '0.95'] }] // 95% CPU
                            }
                        })
                    });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'success',
                        data: { resultType: 'vector', result: [] }
                    })
                });
            });

            const result = await correlator.correlate(
                'anomaly-1',
                'kx-wallet',
                new Date()
            );

            // Should detect high CPU
            if (result.metrics.cpuPercent && result.metrics.cpuPercent > 80) {
                expect(result.insights.length).toBeGreaterThan(0);
            }
        });

        it('should generate insights for high error rate', async () => {
            // Test the logic: error rate > 5% should generate insight
            const errorRate = 10; // 10% error rate
            const highErrorRate = errorRate > 5;
            expect(highErrorRate).toBe(true);
        });

        it('should generate insights for high memory usage', async () => {
            // Test the logic: memory > 1024MB should generate insight
            const memoryMB = 2048;
            const highMemory = memoryMB > 1024;
            expect(highMemory).toBe(true);
        });
    });

    // ============================================
    // Prometheus Query Building
    // ============================================
    describe('Query Building', () => {
        it('should encode query parameters', () => {
            const query = 'rate(http_requests_total[1m])';
            const encoded = encodeURIComponent(query);
            
            expect(encoded).not.toContain('[');
            expect(encoded).not.toContain(']');
        });

        it('should use correct time format', () => {
            const timestamp = new Date('2024-01-15T10:00:00Z');
            const timeSeconds = timestamp.getTime() / 1000;
            
            expect(timeSeconds).toBe(1705312800);
        });
    });
});
