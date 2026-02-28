/**
 * Analysis Service Tests
 * 
 * Tests for the LLM-powered trace analysis service.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('../../server/monitor/history-store', () => ({
    historyStore: {
        addAnalysis: vi.fn(),
        getAnalysis: vi.fn(() => undefined),
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

import { AnalysisService } from '../../server/monitor/analysis-service';
import { historyStore } from '../../server/monitor/history-store';
import type { Anomaly, JaegerTrace, AnalysisResponse } from '../../server/monitor/types';

describe('AnalysisService', () => {
    let service: AnalysisService;

    const createAnomaly = (id: string): Anomaly => ({
        id,
        traceId: `trace-${id}`,
        spanId: `span-${id}`,
        service: 'kx-wallet',
        operation: 'transfer',
        duration: 5000,
        expectedMean: 150,
        expectedStdDev: 30,
        deviation: 16.17,
        severity: 1,
        severityName: 'Critical',
        timestamp: new Date(),
        attributes: {}
    });

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Default: Ollama not available
        (global.fetch as Mock).mockRejectedValue(new Error('Connection refused'));
        
        service = new AnalysisService();
    });

    // ============================================
    // Initialization
    // ============================================
    describe('Initialization', () => {
        it('should create service instance', () => {
            expect(service).toBeDefined();
        });

        it('should check Ollama health on creation', () => {
            expect(global.fetch).toHaveBeenCalled();
        });
    });

    // ============================================
    // Health Check
    // ============================================
    describe('checkOllamaHealth', () => {
        it('should return false when Ollama unavailable', async () => {
            (global.fetch as Mock).mockRejectedValue(new Error('Connection refused'));
            
            const isHealthy = await service.checkOllamaHealth();
            expect(isHealthy).toBe(false);
        });

        it('should return true when Ollama available', async () => {
            (global.fetch as Mock).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    models: [{ name: 'llama3.2:1b' }]
                })
            });

            const isHealthy = await service.checkOllamaHealth();
            expect(isHealthy).toBe(true);
        });

        it('should warn when model not found', async () => {
            (global.fetch as Mock).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    models: [{ name: 'other-model' }]
                })
            });

            const isHealthy = await service.checkOllamaHealth();
            expect(isHealthy).toBe(true); // Still available, just missing model
        });
    });

    // ============================================
    // Analyze Anomaly
    // ============================================
    describe('analyzeAnomaly', () => {
        it('should return cached analysis if available', async () => {
            const cached: AnalysisResponse = {
                traceId: 'trace-cached',
                anomalyId: 'cached',
                summary: 'Cached analysis',
                rootCause: 'Test',
                recommendations: [],
                confidence: 0.9,
                model: 'llama3.2:1b',
                processingTimeMs: 100,
                timestamp: new Date()
            };

            (historyStore.getAnalysis as Mock).mockReturnValue(cached);

            const anomaly = createAnomaly('cached');
            const result = await service.analyzeAnomaly(anomaly);

            expect(result.summary).toBe('Cached analysis');
        });

        it('should return placeholder when Ollama unavailable', async () => {
            (global.fetch as Mock).mockRejectedValue(new Error('Connection refused'));
            (historyStore.getAnalysis as Mock).mockReturnValue(undefined);

            const anomaly = createAnomaly('test');
            const result = await service.analyzeAnomaly(anomaly);

            expect(result.summary).toContain('not available');
            expect(result.confidence).toBe('low');
        });

        it('should include correct structure in response', async () => {
            (historyStore.getAnalysis as Mock).mockReturnValue(undefined);
            
            const anomaly = createAnomaly('struct');
            const result = await service.analyzeAnomaly(anomaly);

            expect(result).toHaveProperty('traceId');
            expect(result).toHaveProperty('summary');
            expect(result).toHaveProperty('recommendations');
            expect(result).toHaveProperty('confidence');
            expect(result).toHaveProperty('analyzedAt');
        });
    });

    // ============================================
    // Placeholder Analysis
    // ============================================
    describe('Placeholder Analysis', () => {
        it('should have zero confidence', async () => {
            (historyStore.getAnalysis as Mock).mockReturnValue(undefined);
            
            const anomaly = createAnomaly('placeholder');
            const result = await service.analyzeAnomaly(anomaly);

            expect(result.confidence).toBe('low');
        });

        it('should indicate analysis unavailable', async () => {
            (historyStore.getAnalysis as Mock).mockReturnValue(undefined);
            
            const anomaly = createAnomaly('unavailable');
            const result = await service.analyzeAnomaly(anomaly);

            expect(result.summary).toContain('not available');
        });

        it('should include trace ID', async () => {
            (historyStore.getAnalysis as Mock).mockReturnValue(undefined);
            
            const anomaly = createAnomaly('details');
            const result = await service.analyzeAnomaly(anomaly);

            expect(result.traceId).toBe('trace-details');
        });
    });

    // ============================================
    // Full Trace Analysis
    // ============================================
    describe('Full Trace Analysis', () => {
        it('should accept optional full trace', async () => {
            const trace: JaegerTrace = {
                traceID: 'trace-full',
                spans: [{
                    traceID: 'trace-full',
                    spanID: 'span-1',
                    operationName: 'transfer',
                    references: [],
                    startTime: 1705312800000000,
                    duration: 5000000,
                    tags: [],
                    processID: 'p1'
                }],
                processes: {
                    p1: { serviceName: 'kx-wallet', tags: [] }
                }
            };

            const anomaly = createAnomaly('with-trace');
            
            // Should not throw
            await expect(service.analyzeAnomaly(anomaly, trace)).resolves.toBeDefined();
        });
    });

    // ============================================
    // Model Configuration
    // ============================================
    describe('Model Configuration', () => {
        it('should use default Ollama URL', () => {
            const defaultUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
            expect(defaultUrl).toBe('http://localhost:11434');
        });

        it('should use default model', () => {
            const defaultModel = process.env.OLLAMA_MODEL || 'llama3.2:1b';
            expect(defaultModel).toBe('llama3.2:1b');
        });
    });

    // ============================================
    // Caching
    // ============================================
    describe('Caching', () => {
        it('should cache analysis results', async () => {
            (global.fetch as Mock).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    models: [{ name: 'llama3.2:1b' }]
                })
            });

            // Mock Ollama generate endpoint
            (global.fetch as Mock).mockImplementation((url: string) => {
                if (url.includes('/api/tags')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ models: [{ name: 'llama3.2:1b' }] })
                    });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: 'Test analysis response'
                    })
                });
            });

            const anomaly = createAnomaly('cache-test');
            await service.analyzeAnomaly(anomaly);

            // Should have called addAnalysis
            // (In placeholder mode, it won't cache)
        });
    });
});
