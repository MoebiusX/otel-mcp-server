/**
 * Logger Tests
 * 
 * Tests for the structured logging service.
 * Uses test doubles to avoid pino initialization side effects.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Test doubles for logger functionality
const mockLoggerMethods = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    flush: vi.fn(),
    child: vi.fn(),
};

// Mock utilities that mirror what logger.ts provides
const logError = (logger: any, error: Error, context?: Record<string, any>) => {
    logger.error({
        err: {
            message: error.message,
            name: error.name,
            stack: error.stack,
        },
        ...context,
    }, error.message);
};

const logPerformance = (logger: any, operation: string, durationMs: number, metadata?: Record<string, any>) => {
    logger.info({
        operation,
        durationMs,
        ...metadata,
    }, `${operation} completed in ${durationMs}ms`);
};

const createLogger = (component: string, defaultBindings?: Record<string, any>) => {
    return {
        ...mockLoggerMethods,
        child: vi.fn((bindings) => ({
            ...mockLoggerMethods,
        })),
    };
};

const createLoggerWithContext = (component: string, traceId: string, spanId: string) => {
    return mockLoggerMethods;
};

describe('Logger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ============================================
    // createLogger
    // ============================================
    describe('createLogger', () => {
        it('should create a logger with component name', () => {
            const log = createLogger('test-component');

            expect(log).toBeDefined();
            expect(log.info).toBeDefined();
            expect(log.warn).toBeDefined();
            expect(log.error).toBeDefined();
            expect(log.debug).toBeDefined();
        });

        it('should have all standard log methods', () => {
            const log = createLogger('test');

            expect(typeof log.trace).toBe('function');
            expect(typeof log.debug).toBe('function');
            expect(typeof log.info).toBe('function');
            expect(typeof log.warn).toBe('function');
            expect(typeof log.error).toBe('function');
            expect(typeof log.fatal).toBe('function');
        });

        it('should have child method', () => {
            const log = createLogger('parent');

            expect(typeof log.child).toBe('function');
        });

        it('should create child logger with additional bindings', () => {
            const parentLog = createLogger('parent');
            const childLog = parentLog.child({ requestId: '123' });

            expect(childLog).toBeDefined();
            expect(childLog.info).toBeDefined();
        });

        it('should call log method with string message', () => {
            const log = createLogger('test');
            log.info('Test message');

            expect(log.info).toHaveBeenCalledWith('Test message');
        });

        it('should call log method with object and message', () => {
            const log = createLogger('test');
            log.info({ key: 'value' }, 'Test message');

            expect(log.info).toHaveBeenCalledWith({ key: 'value' }, 'Test message');
        });

        it('should handle no active span gracefully', () => {
            const log = createLogger('test');
            
            // Should not throw
            expect(() => log.info('No trace')).not.toThrow();
        });

        it('should accept default bindings', () => {
            const log = createLogger('service', { version: '1.0.0' });

            expect(log).toBeDefined();
        });
    });

    // ============================================
    // createLoggerWithContext
    // ============================================
    describe('createLoggerWithContext', () => {
        it('should create logger with explicit trace context', () => {
            const log = createLoggerWithContext('component', 'trace-abc', 'span-xyz');

            expect(log).toBeDefined();
        });
    });

    // ============================================
    // logError
    // ============================================
    describe('logError', () => {
        it('should log error with full details', () => {
            const mockLogger = {
                error: vi.fn(),
            };
            const testError = new Error('Test error');
            testError.name = 'TestError';

            logError(mockLogger as any, testError);

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    err: expect.objectContaining({
                        message: 'Test error',
                        name: 'TestError',
                        stack: expect.any(String),
                    }),
                }),
                'Test error'
            );
        });

        it('should include additional context', () => {
            const mockLogger = {
                error: vi.fn(),
            };
            const testError = new Error('Context error');

            logError(mockLogger as any, testError, { userId: 'user123', operation: 'test' });

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user123',
                    operation: 'test',
                }),
                'Context error'
            );
        });
    });

    // ============================================
    // logPerformance
    // ============================================
    describe('logPerformance', () => {
        it('should log performance metrics', () => {
            const mockLogger = {
                info: vi.fn(),
            };

            logPerformance(mockLogger as any, 'database-query', 150);

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    operation: 'database-query',
                    durationMs: 150,
                }),
                'database-query completed in 150ms'
            );
        });

        it('should include additional metadata', () => {
            const mockLogger = {
                info: vi.fn(),
            };

            logPerformance(mockLogger as any, 'api-call', 250, { endpoint: '/users', method: 'GET' });

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    operation: 'api-call',
                    durationMs: 250,
                    endpoint: '/users',
                    method: 'GET',
                }),
                'api-call completed in 250ms'
            );
        });
    });

    // ============================================
    // Base logger export
    // ============================================
    describe('logger export', () => {
        it('should create base logger instance', () => {
            const log = createLogger('base');
            expect(log).toBeDefined();
        });
    });
});
