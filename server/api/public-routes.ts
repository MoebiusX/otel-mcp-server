/**
 * Public Transparency API Routes
 * 
 * Public endpoints showcasing Krystaline's "Proof of Observability"
 * These endpoints are unauthenticated and designed for transparency.
 */

import { Router, Request, Response } from 'express';
import { transparencyService } from '../services/transparency-service';
import { createLogger } from '../lib/logger';
import { z } from 'zod';

const logger = createLogger('public-routes');
const router = Router();

// Request validation schemas
const tradesQuerySchema = z.object({
  limit: z.string().optional().transform(val => {
    if (!val) return 20;
    const num = parseInt(val);
    return Math.min(Math.max(num, 1), 100); // Clamp between 1-100
  }),
});

const traceParamsSchema = z.object({
  traceId: z.string().min(1, 'Trace ID is required'),
});

/**
 * GET /api/public/status
 * 
 * Overall system health and transparency metrics.
 * Used for the public dashboard homepage.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = await transparencyService.getSystemStatus();
    res.json(status);
  } catch (error: unknown) {
    logger.error({ err: error }, 'Failed to get system status');
    res.status(500).json({ 
      error: 'Failed to retrieve system status',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/public/trades
 * 
 * Recent trades feed (anonymized).
 * Shows real-time trading activity for transparency.
 */
router.get('/trades', async (req: Request, res: Response) => {
  try {
    // Validate query parameters
    const { limit } = tradesQuerySchema.parse(req.query);
    const trades = await transparencyService.getPublicTrades(limit);
    
    res.json({
      trades,
      count: trades.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      logger.warn({ err: error.errors }, 'Invalid query parameters');
      return res.status(400).json({ 
        error: 'Invalid query parameters',
        details: error.errors,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.error({ err: error }, 'Failed to get public trades');
    res.status(500).json({ 
      error: 'Failed to retrieve trades',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/public/metrics
 * 
 * Key transparency metrics for trust indicators.
 * Powers the "Proof of Observability" dashboard.
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await transparencyService.getTransparencyMetrics();
    res.json(metrics);
  } catch (error: unknown) {
    logger.error({ err: error }, 'Failed to get transparency metrics');
    res.status(500).json({ 
      error: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/public/trace/:traceId
 * 
 * Get simplified trace details for a specific trade.
 * Allows users to verify their transactions.
 */
router.get('/trace/:traceId', async (req: Request, res: Response) => {
  try {
    // Validate trace ID parameter
    const { traceId } = traceParamsSchema.parse(req.params);
    const trace = await transparencyService.getTradeTrace(traceId);
    
    if (!trace) {
      return res.status(404).json({ 
        error: 'Trace not found',
        traceId,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json(trace);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      logger.warn({ err: error.errors }, 'Invalid trace ID');
      return res.status(400).json({ 
        error: 'Invalid trace ID',
        details: error.errors,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.error({ err: error }, 'Failed to get trade trace');
    res.status(500).json({ 
      error: 'Failed to retrieve trace',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/public/health
 * 
 * Simple health check endpoint.
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'operational',
    timestamp: new Date().toISOString(),
    message: 'Krystaline Exchange API'
  });
});

export default router;
