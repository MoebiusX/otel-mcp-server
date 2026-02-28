/**
 * Health Routes Integration Tests
 * 
 * Tests for /health and /ready endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Mock dependencies before importing anything else
vi.mock('../../server/db', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('../../server/services/rabbitmq-client', () => ({
  rabbitMQClient: {
    isConnected: vi.fn().mockReturnValue(false),
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

import express from 'express';
import healthRoutes from '../../server/api/health-routes';
import db from '../../server/db';
import { rabbitMQClient } from '../../server/services/rabbitmq-client';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRoutes);
  return app;
}

describe('Health Routes Integration', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /health', () => {
    it('should return 200 with healthy status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeTypeOf('number');
      expect(response.body.version).toBeDefined();
    });

    it('should include uptime in seconds', async () => {
      const response = await request(app).get('/health');

      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return correct content-type', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('GET /ready', () => {
    it('should return 200 when database is connected', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any);
      vi.mocked(rabbitMQClient.isConnected).mockReturnValue(true);

      const response = await request(app).get('/ready');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.database.status).toBe('connected');
    });

    it('should return 503 when database is disconnected', async () => {
      vi.mocked(db.query).mockRejectedValue(new Error('Connection refused'));
      vi.mocked(rabbitMQClient.isConnected).mockReturnValue(false);

      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.checks.database.status).toBe('disconnected');
    });

    it('should include database latency when connected', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any);

      const response = await request(app).get('/ready');

      expect(response.body.checks.database.latencyMs).toBeTypeOf('number');
    });

    it('should check RabbitMQ status', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);
      vi.mocked(rabbitMQClient.isConnected).mockReturnValue(true);

      const response = await request(app).get('/ready');

      expect(response.body.checks.rabbitmq.status).toBe('connected');
    });

    it('should still be healthy if RabbitMQ is down (non-critical)', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);
      vi.mocked(rabbitMQClient.isConnected).mockReturnValue(false);

      const response = await request(app).get('/ready');

      // RabbitMQ is optional, so overall status should still be healthy
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.checks.rabbitmq.status).toBe('disconnected');
    });
  });

  describe('GET /metrics/health', () => {
    it('should return detailed health metrics', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ user_count: 10, order_count: 50, wallet_count: 30 }],
      } as any);

      const response = await request(app).get('/metrics/health');

      expect(response.status).toBe(200);
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.checks).toBeDefined();
    });

    it('should include memory usage', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [{}] } as any);

      const response = await request(app).get('/metrics/health');

      expect(response.body.checks.memory).toBeDefined();
      expect(response.body.checks.memory.heapUsed).toBeDefined();
      expect(response.body.checks.memory.heapTotal).toBeDefined();
    });

    it('should include process info', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [{}] } as any);

      const response = await request(app).get('/metrics/health');

      expect(response.body.checks.process).toBeDefined();
      expect(response.body.checks.process.uptime).toBeTypeOf('number');
      expect(response.body.checks.process.nodeVersion).toBeDefined();
      expect(response.body.checks.process.pid).toBeTypeOf('number');
    });

    it('should include database stats when connected', async () => {
      vi.mocked(db.query).mockResolvedValue({
        rows: [{ user_count: '5', order_count: '100', wallet_count: '15' }],
      } as any);

      const response = await request(app).get('/metrics/health');

      expect(response.body.checks.database.status).toBe('connected');
      expect(response.body.checks.database.stats).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(db.query).mockRejectedValue(new Error('DB Error'));

      const response = await request(app).get('/metrics/health');

      expect(response.status).toBe(200);
      expect(response.body.checks.database.status).toBe('error');
      expect(response.body.checks.database.error).toBeDefined();
    });
  });
});
