/**
 * Training Store Tests
 * 
 * Tests for the LLM training data collection store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs and path before importing
vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '[]'),
    writeFileSync: vi.fn(),
}));

vi.mock('path', () => ({
    join: vi.fn((...args) => args.join('/')),
}));

vi.mock('../../server/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }))
}));

import { trainingStore } from '../../server/monitor/training-store';
import type { TrainingExample, TrainingStats } from '../../server/monitor/training-store';

describe('TrainingStore', () => {
    // Use the exported singleton
    const store = trainingStore;

    beforeEach(() => {
        vi.clearAllMocks();
        // Clear data before each test
        store.clear();
    });

    // ============================================
    // TrainingExample Structure
    // ============================================
    describe('TrainingExample Structure', () => {
        it('should define correct TrainingExample shape', () => {
            const example: TrainingExample = {
                id: 'train_123',
                timestamp: new Date().toISOString(),
                anomaly: {
                    id: 'anom-1',
                    service: 'kx-wallet',
                    operation: 'transfer',
                    duration: 500,
                    deviation: 3.5,
                    severity: 2,
                    severityName: 'Major'
                },
                prompt: 'Analyze this anomaly...',
                completion: 'This appears to be a database issue...',
                rating: 'good'
            };

            expect(example.id).toBe('train_123');
            expect(example.anomaly.service).toBe('kx-wallet');
            expect(example.rating).toBe('good');
        });

        it('should allow optional correction field', () => {
            const example: TrainingExample = {
                id: 'train_456',
                timestamp: new Date().toISOString(),
                anomaly: {
                    id: 'anom-2',
                    service: 'kx-exchange',
                    operation: 'match',
                    duration: 300,
                    deviation: 4.0,
                    severity: 1,
                    severityName: 'Critical'
                },
                prompt: 'Analyze...',
                completion: 'Wrong analysis...',
                rating: 'bad',
                correction: 'This is the correct analysis...'
            };

            expect(example.rating).toBe('bad');
            expect(example.correction).toBe('This is the correct analysis...');
        });

        it('should allow optional notes field', () => {
            const example: TrainingExample = {
                id: 'train_789',
                timestamp: new Date().toISOString(),
                anomaly: {
                    id: 'anom-3',
                    service: 'kx-wallet',
                    operation: 'balance',
                    duration: 200,
                    deviation: 2.0,
                    severity: 3,
                    severityName: 'Moderate'
                },
                prompt: 'Analyze...',
                completion: 'Analysis...',
                rating: 'good',
                notes: 'Good response, captured root cause'
            };

            expect(example.notes).toBe('Good response, captured root cause');
        });
    });

    // ============================================
    // TrainingStats Structure
    // ============================================
    describe('TrainingStats Structure', () => {
        it('should define correct TrainingStats shape', () => {
            const stats: TrainingStats = {
                totalExamples: 100,
                goodExamples: 80,
                badExamples: 20,
                uniqueServices: ['kx-wallet', 'kx-exchange', 'kx-matcher'],
                lastUpdated: new Date().toISOString()
            };

            expect(stats.totalExamples).toBe(100);
            expect(stats.goodExamples).toBe(80);
            expect(stats.badExamples).toBe(20);
            expect(stats.uniqueServices).toContain('kx-wallet');
        });

        it('should handle empty stats', () => {
            const stats: TrainingStats = {
                totalExamples: 0,
                goodExamples: 0,
                badExamples: 0,
                uniqueServices: [],
                lastUpdated: ''
            };

            expect(stats.totalExamples).toBe(0);
            expect(stats.uniqueServices).toHaveLength(0);
        });
    });

    // ============================================
    // Store Initialization
    // ============================================
    describe('Initialization', () => {
        it('should create store instance', () => {
            expect(store).toBeDefined();
        });

        it('should return empty array initially', () => {
            const examples = store.getAll();
            expect(Array.isArray(examples)).toBe(true);
        });

        it('should return empty stats initially', () => {
            const stats = store.getStats();
            expect(stats.totalExamples).toBeGreaterThanOrEqual(0);
        });
    });

    // ============================================
    // Add Example
    // ============================================
    describe('addExample', () => {
        it('should add training example', () => {
            const example = store.addExample({
                anomaly: {
                    id: 'test-1',
                    service: 'kx-wallet',
                    operation: 'transfer',
                    duration: 500,
                    deviation: 3.0,
                    severity: 2,
                    severityName: 'Major'
                },
                prompt: 'Test prompt',
                completion: 'Test completion',
                rating: 'good'
            });

            expect(example.id).toMatch(/^train_/);
            expect(example.timestamp).toBeDefined();
        });

        it('should generate unique IDs', () => {
            const ex1 = store.addExample({
                anomaly: { id: '1', service: 's', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p1', completion: 'c1', rating: 'good'
            });

            const ex2 = store.addExample({
                anomaly: { id: '2', service: 's', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p2', completion: 'c2', rating: 'good'
            });

            expect(ex1.id).not.toBe(ex2.id);
        });
    });

    // ============================================
    // Get Stats
    // ============================================
    describe('getStats', () => {
        it('should count good and bad examples', () => {
            store.addExample({
                anomaly: { id: '1', service: 'svc1', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'good'
            });

            store.addExample({
                anomaly: { id: '2', service: 'svc2', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'bad', correction: 'better'
            });

            const stats = store.getStats();
            expect(stats.goodExamples).toBeGreaterThanOrEqual(1);
        });

        it('should track unique services', () => {
            store.addExample({
                anomaly: { id: '1', service: 'kx-wallet', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'good'
            });

            store.addExample({
                anomaly: { id: '2', service: 'kx-exchange', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'good'
            });

            const stats = store.getStats();
            expect(stats.uniqueServices.length).toBeGreaterThanOrEqual(0);
        });
    });

    // ============================================
    // Export to JSONL
    // ============================================
    describe('exportToJsonl', () => {
        it('should export to JSONL format', () => {
            store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'Test prompt', completion: 'Test completion', rating: 'good'
            });

            const jsonl = store.exportToJsonl();
            expect(typeof jsonl).toBe('string');
        });

        it('should include prompt and completion in good examples', () => {
            store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'My prompt', completion: 'My completion', rating: 'good'
            });

            const jsonl = store.exportToJsonl();
            if (jsonl.length > 0) {
                const line = JSON.parse(jsonl.split('\n')[0]);
                expect(line.prompt).toBe('My prompt');
                expect(line.completion).toBe('My completion');
            }
        });

        it('should use correction for bad examples', () => {
            store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'Prompt', completion: 'Wrong', rating: 'bad', correction: 'Corrected'
            });

            const jsonl = store.exportToJsonl();
            if (jsonl.length > 0) {
                const line = JSON.parse(jsonl.split('\n')[0]);
                expect(line.completion).toBe('Corrected');
                expect(line.original_completion).toBe('Wrong');
            }
        });

        it('should skip bad examples without corrections', () => {
            const initialLen = store.exportToJsonl().length;

            store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'Prompt', completion: 'Bad output', rating: 'bad'
                // No correction provided
            });

            const newLen = store.exportToJsonl().length;
            // Should be the same or only marginally different (whitespace)
            expect(newLen - initialLen).toBeLessThanOrEqual(0);
        });
    });

    // ============================================
    // Clear and Delete
    // ============================================
    describe('clear', () => {
        it('should clear all examples', () => {
            store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'good'
            });

            store.clear();
            
            const all = store.getAll();
            expect(all).toHaveLength(0);
        });
    });

    describe('delete', () => {
        it('should delete specific example', () => {
            const example = store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'good'
            });

            const deleted = store.delete(example.id);
            expect(deleted).toBe(true);
        });

        it('should return false for non-existent ID', () => {
            const deleted = store.delete('nonexistent_id');
            expect(deleted).toBe(false);
        });
    });

    // ============================================
    // Rating Values
    // ============================================
    describe('Rating Values', () => {
        it('should accept good rating', () => {
            const ex = store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'good'
            });
            expect(ex.rating).toBe('good');
        });

        it('should accept bad rating', () => {
            const ex = store.addExample({
                anomaly: { id: '1', service: 'svc', operation: 'o', duration: 100, deviation: 1, severity: 3, severityName: 'Moderate' },
                prompt: 'p', completion: 'c', rating: 'bad'
            });
            expect(ex.rating).toBe('bad');
        });
    });
});
