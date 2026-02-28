/**
 * Test Application Factory
 * 
 * Creates a minimal Express app for integration testing.
 * Does not start the server or connect to external services.
 */

import express, { Express } from 'express';
import { vi } from 'vitest';

// Mock external dependencies before importing routes
vi.mock('../../server/db', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('../../server/services/rabbitmq-client', () => ({
  rabbitMQClient: {
    isConnected: vi.fn().mockReturnValue(false),
    publishOrderAndWait: vi.fn(),
  },
}));

vi.mock('../../server/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../server/otel', () => ({
  traces: {
    startSpan: vi.fn(),
  },
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: vi.fn(),
    getSpan: vi.fn(() => ({
      spanContext: () => ({ traceId: 'test-trace-id-12345678', spanId: 'test-span-id' }),
    })),
    getTracer: vi.fn(() => ({
      startActiveSpan: vi.fn((name, fn) => fn({
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
        spanContext: () => ({ traceId: 'test-trace-id-12345678', spanId: 'test-span-id' }),
      })),
    })),
  },
  context: {
    active: vi.fn(),
    with: vi.fn((ctx, fn) => fn()),
  },
  SpanStatusCode: { OK: 0, ERROR: 1 },
  propagation: {
    inject: vi.fn(),
    extract: vi.fn(),
  },
}));

import healthRoutes from '../../server/api/health-routes';
import { registerRoutes } from '../../server/api/routes';
import db from '../../server/db';
import { rabbitMQClient } from '../../server/services/rabbitmq-client';

export function createTestApp(): Express {
  const app = express();
  
  // Essential middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  
  // Register routes
  app.use(healthRoutes);
  registerRoutes(app);
  
  return app;
}

// Export mocks for test manipulation
export { db, rabbitMQClient };
