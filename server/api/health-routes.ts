/**
 * Health Check Routes
 * 
 * Provides /health (liveness) and /ready (readiness) endpoints
 * for container orchestration and load balancers.
 */

import { Router, Request, Response } from 'express';
import db from '../db';
import { rabbitMQClient } from '../services/rabbitmq-client';
import { createLogger } from '../lib/logger';
import { getErrorMessage } from '../lib/errors';

const router = Router();
const logger = createLogger('health');

const startTime = Date.now();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks?: {
    database?: { status: string; latencyMs?: number };
    rabbitmq?: { status: string };
  };
}

/**
 * GET /health
 * 
 * Liveness probe - returns 200 if the server is running.
 * Use this for container health checks.
 * Does NOT check external dependencies.
 */
router.get('/health', (req: Request, res: Response) => {
  const status: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || '1.0.0',
  };

  res.status(200).json(status);
});

/**
 * GET /ready
 * 
 * Readiness probe - returns 200 if the server can handle requests.
 * Checks database connectivity and other critical dependencies.
 * Use this for load balancer health checks.
 */
router.get('/ready', async (req: Request, res: Response) => {
  const checks: HealthStatus['checks'] = {};
  let overallHealthy = true;

  // Check database connectivity
  try {
    const dbStart = Date.now();
    await db.query('SELECT 1');
    const dbLatency = Date.now() - dbStart;
    
    checks.database = {
      status: 'connected',
      latencyMs: dbLatency,
    };
    
    // Warn if database is slow
    if (dbLatency > 1000) {
      logger.warn({ latencyMs: dbLatency }, 'Database response slow');
    }
  } catch (error: unknown) {
    checks.database = {
      status: 'disconnected',
    };
    overallHealthy = false;
    logger.error({ err: error }, 'Database health check failed');
  }

  // Check RabbitMQ connectivity (non-critical for demo)
  try {
    const isConnected = rabbitMQClient.isConnected();
    checks.rabbitmq = {
      status: isConnected ? 'connected' : 'disconnected',
    };
    // RabbitMQ is optional - don't fail health check if down
  } catch (error: unknown) {
    checks.rabbitmq = {
      status: 'error',
    };
  }

  const status: HealthStatus = {
    status: overallHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || '1.0.0',
    checks,
  };

  // Return 503 if unhealthy (load balancer will stop sending traffic)
  res.status(overallHealthy ? 200 : 503).json(status);
});

/**
 * GET /metrics/health
 * 
 * Detailed health metrics for monitoring dashboards.
 * Returns more information than /ready.
 */
router.get('/metrics/health', async (req: Request, res: Response) => {
  const checks: Record<string, any> = {};

  // Database details
  try {
    const dbStart = Date.now();
    const result = await db.query(`
      SELECT 
        (SELECT count(*) FROM users) as user_count,
        (SELECT count(*) FROM orders) as order_count,
        (SELECT count(*) FROM wallets) as wallet_count
    `);
    const dbLatency = Date.now() - dbStart;
    
    checks.database = {
      status: 'connected',
      latencyMs: dbLatency,
      stats: result.rows[0],
    };
  } catch (error: unknown) {
    checks.database = {
      status: 'error',
      error: getErrorMessage(error),
    };
  }

  // Memory usage
  const memUsage = process.memoryUsage();
  checks.memory = {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
    rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
  };

  // Process info
  checks.process = {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    nodeVersion: process.version,
    pid: process.pid,
  };

  res.json({
    timestamp: new Date().toISOString(),
    checks,
  });
});

export default router;
