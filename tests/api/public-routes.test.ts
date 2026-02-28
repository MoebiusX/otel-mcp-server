/**
 * Public Routes Tests
 * 
 * Tests for public transparency API endpoints.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock transparency service
vi.mock('../../server/services/transparency-service', () => ({
    transparencyService: {
        getSystemStatus: vi.fn(),
        getPublicTrades: vi.fn(),
        getTradeTrace: vi.fn(),
        getTransparencyMetrics: vi.fn(),
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

import { transparencyService } from '../../server/services/transparency-service';
import publicRoutes from '../../server/api/public-routes';

// Create test app
function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/public', publicRoutes);
    return app;
}

describe('Public Routes', () => {
    let app: express.Application;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createTestApp();
    });

    // ============================================
    // GET /api/public/status
    // ============================================
    describe('GET /api/public/status', () => {
        it('should return system status', async () => {
            const mockStatus = {
                status: 'healthy',
                uptime: 86400,
                services: {
                    api: 'up',
                    database: 'up',
                },
            };
            (transparencyService.getSystemStatus as Mock).mockResolvedValue(mockStatus);

            const res = await request(app)
                .get('/api/public/status');

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('healthy');
        });

        it('should not require authentication', async () => {
            (transparencyService.getSystemStatus as Mock).mockResolvedValue({ status: 'ok' });

            const res = await request(app)
                .get('/api/public/status');

            expect(res.status).toBe(200);
        });

        it('should handle service errors', async () => {
            (transparencyService.getSystemStatus as Mock).mockRejectedValue(new Error('Service error'));

            const res = await request(app)
                .get('/api/public/status');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('Failed');
            expect(res.body.timestamp).toBeDefined();
        });
    });

    // ============================================
    // GET /api/public/trades
    // ============================================
    describe('GET /api/public/trades', () => {
        it('should return public trades', async () => {
            const mockTrades = [
                { id: 'trade-1', pair: 'BTC/USD', price: 50000 },
                { id: 'trade-2', pair: 'ETH/USD', price: 2500 },
            ];
            (transparencyService.getPublicTrades as Mock).mockResolvedValue(mockTrades);

            const res = await request(app)
                .get('/api/public/trades');

            expect(res.status).toBe(200);
            expect(res.body.trades).toHaveLength(2);
            expect(res.body.count).toBe(2);
            expect(res.body.timestamp).toBeDefined();
        });

        it('should respect limit parameter', async () => {
            (transparencyService.getPublicTrades as Mock).mockResolvedValue([]);

            await request(app)
                .get('/api/public/trades?limit=50');

            expect(transparencyService.getPublicTrades).toHaveBeenCalledWith(50);
        });

        it('should use default limit of 20', async () => {
            (transparencyService.getPublicTrades as Mock).mockResolvedValue([]);

            await request(app)
                .get('/api/public/trades');

            expect(transparencyService.getPublicTrades).toHaveBeenCalledWith(20);
        });

        it('should clamp limit to max 100', async () => {
            (transparencyService.getPublicTrades as Mock).mockResolvedValue([]);

            await request(app)
                .get('/api/public/trades?limit=200');

            expect(transparencyService.getPublicTrades).toHaveBeenCalledWith(100);
        });

        it('should clamp limit to min 1', async () => {
            (transparencyService.getPublicTrades as Mock).mockResolvedValue([]);

            await request(app)
                .get('/api/public/trades?limit=0');

            expect(transparencyService.getPublicTrades).toHaveBeenCalledWith(1);
        });

        it('should handle service errors', async () => {
            (transparencyService.getPublicTrades as Mock).mockRejectedValue(new Error('DB error'));

            const res = await request(app)
                .get('/api/public/trades');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('Failed');
        });
    });

    // ============================================
    // GET /api/public/trace/:traceId
    // ============================================
    describe('GET /api/public/trace/:traceId', () => {
        it('should return trace details', async () => {
            const mockTrace = {
                traceId: 'trace-123',
                spans: [
                    { spanId: 'span-1', name: 'root' },
                ],
            };
            (transparencyService.getTradeTrace as Mock).mockResolvedValue(mockTrace);

            const res = await request(app)
                .get('/api/public/trace/trace-123');

            expect(res.status).toBe(200);
            expect(res.body.traceId).toBe('trace-123');
        });

        it('should return 404 for non-existent trace', async () => {
            (transparencyService.getTradeTrace as Mock).mockResolvedValue(null);

            const res = await request(app)
                .get('/api/public/trace/nonexistent');

            expect(res.status).toBe(404);
            expect(res.body.error).toContain('not found');
        });

        it('should handle service errors', async () => {
            (transparencyService.getTradeTrace as Mock).mockRejectedValue(new Error('Error'));

            const res = await request(app)
                .get('/api/public/trace/trace-123');

            expect(res.status).toBe(500);
        });
    });

    // ============================================
    // GET /api/public/metrics
    // ============================================
    describe('GET /api/public/metrics', () => {
        it('should return transparency metrics', async () => {
            const mockMetrics = {
                totalTrades: 1000,
                avgLatency: 50,
            };
            (transparencyService.getTransparencyMetrics as Mock).mockResolvedValue(mockMetrics);

            const res = await request(app)
                .get('/api/public/metrics');

            expect(res.status).toBe(200);
            expect(res.body.totalTrades).toBe(1000);
        });

        it('should handle service errors', async () => {
            (transparencyService.getTransparencyMetrics as Mock).mockRejectedValue(new Error('Error'));

            const res = await request(app)
                .get('/api/public/metrics');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('Failed');
        });
    });

    // ============================================
    // GET /api/public/health
    // ============================================
    describe('GET /api/public/health', () => {
        it('should return health status', async () => {
            const res = await request(app)
                .get('/api/public/health');

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('operational');
            expect(res.body.timestamp).toBeDefined();
            expect(res.body.message).toContain('Krystaline');
        });
    });
});
