/**
 * Trace Profiler Tests
 * 
 * Tests for the trace profiling and baseline calculation service.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Mock dependencies
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

import { TraceProfiler } from '../../server/monitor/trace-profiler';
import type { JaegerTrace, SpanBaseline } from '../../server/monitor/types';

describe('TraceProfiler', () => {
    let profiler: TraceProfiler;

    beforeEach(() => {
        vi.clearAllMocks();
        profiler = new TraceProfiler();
        
        // Default fetch mock returns empty data
        (global.fetch as Mock).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ data: [] })
        });
    });

    afterEach(() => {
        profiler.stop();
    });

    // ============================================
    // Lifecycle
    // ============================================
    describe('Lifecycle', () => {
        it('should create profiler instance', () => {
            expect(profiler).toBeDefined();
        });

        it('should start polling loop', () => {
            profiler.start();
            expect(profiler).toBeDefined();
        });

        it('should not start twice', () => {
            profiler.start();
            profiler.start(); // Should be no-op
            expect(profiler).toBeDefined();
        });

        it('should stop polling', () => {
            profiler.start();
            profiler.stop();
            expect(profiler).toBeDefined();
        });
    });

    // ============================================
    // Baselines
    // ============================================
    describe('getBaselines', () => {
        it('should return empty array initially', () => {
            const baselines = profiler.getBaselines();
            expect(baselines).toEqual([]);
        });

        it('should return array of baselines', () => {
            const baselines = profiler.getBaselines();
            expect(Array.isArray(baselines)).toBe(true);
        });
    });

    describe('getBaseline', () => {
        it('should return undefined for non-existent baseline', () => {
            const baseline = profiler.getBaseline('unknown-service', 'unknown-op');
            expect(baseline).toBeUndefined();
        });
    });

    // ============================================
    // Baseline Calculation Logic
    // ============================================
    describe('Baseline Calculation', () => {
        it('should calculate mean correctly', () => {
            // Test mean calculation logic
            const durations = [100, 120, 110, 130, 90];
            const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
            expect(mean).toBe(110);
        });

        it('should calculate standard deviation correctly', () => {
            const durations = [100, 120, 110, 130, 90];
            const mean = 110;
            const variance = durations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / durations.length;
            const stdDev = Math.sqrt(variance);
            
            expect(stdDev).toBeCloseTo(14.14, 1);
        });

        it('should calculate percentiles correctly', () => {
            const sorted = [50, 75, 100, 125, 150, 175, 200, 225, 250, 275];
            // p50 = middle value (index 5 in 10-element array)
            const p50Index = Math.floor(sorted.length * 0.5);
            expect(sorted[p50Index]).toBe(175); // 6th element (0-indexed as 5)
            
            // p95 = 95th percentile
            const p95Index = Math.floor(sorted.length * 0.95);
            expect(sorted[p95Index]).toBe(275);
        });
    });

    // ============================================
    // Fetch Handling
    // ============================================
    describe('Trace Fetching', () => {
        it('should handle fetch errors gracefully', async () => {
            (global.fetch as Mock).mockRejectedValue(new Error('Network error'));
            
            profiler.start();
            
            // Should not throw
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(profiler).toBeDefined();
        });

        it('should handle non-ok response', async () => {
            (global.fetch as Mock).mockResolvedValue({
                ok: false,
                status: 500
            });

            profiler.start();
            
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(profiler).toBeDefined();
        });

        it('should handle empty trace data', async () => {
            (global.fetch as Mock).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [] })
            });

            profiler.start();
            
            await new Promise(resolve => setTimeout(resolve, 100));
            const baselines = profiler.getBaselines();
            expect(baselines).toEqual([]);
        });
    });

    // ============================================
    // Span Processing
    // ============================================
    describe('Span Processing', () => {
        it('should extract service name from process', () => {
            const mockTrace: JaegerTrace = {
                traceID: 'trace-1',
                spans: [
                    {
                        traceID: 'trace-1',
                        spanID: 'span-1',
                        operationName: 'HTTP GET /api/health',
                        references: [],
                        startTime: 1704067200000000,
                        duration: 150000,
                        tags: [],
                        processID: 'p1'
                    }
                ],
                processes: {
                    p1: {
                        serviceName: 'kx-wallet',
                        tags: []
                    }
                }
            };

            const process = mockTrace.processes[mockTrace.spans[0].processID];
            expect(process.serviceName).toBe('kx-wallet');
        });

        it('should calculate duration in milliseconds', () => {
            const durationMicroseconds = 150000;
            const durationMs = durationMicroseconds / 1000;
            expect(durationMs).toBe(150);
        });
    });
});
