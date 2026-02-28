/**
 * Test Setup - Global configuration for Vitest
 */
import { beforeAll, afterAll, vi } from 'vitest';

// Mock environment variables for tests
// NOTE: These are TEST-ONLY values, never used in production
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.DB_PASSWORD = 'test-only-password-not-for-production';
  process.env.JWT_SECRET = 'test-only-jwt-secret-minimum-16-chars';
  process.env.RABBITMQ_URL = 'amqp://test:test@localhost:5672';
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Keep console.error for debugging test failures
}
