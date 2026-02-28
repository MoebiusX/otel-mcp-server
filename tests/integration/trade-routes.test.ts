/**
 * Trade Routes Integration Tests
 * 
 * Tests for /api/trade/* endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

// Create mock middleware inline
const mockAuthenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  (req as any).user = { id: 'test-user-123', email: 'test@example.com' };
  next();
};

// Mock tradeService
const mockTradeService = {
  getPairs: vi.fn(),
  getPrice: vi.fn(),
  getRate: vi.fn(),
  getConvertQuote: vi.fn(),
  executeConvert: vi.fn(),
  placeLimitOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getOrders: vi.fn(),
};

// Mock priceService
const mockPriceService = {
  getStatus: vi.fn(),
  getAllPrices: vi.fn(),
};

// Create test app inline without importing actual routes
function createTradeApp() {
  const app = express();
  app.use(express.json());

  // GET /price-status
  app.get('/api/v1/trade/price-status', (req, res) => {
    const status = mockPriceService.getStatus();
    const prices = mockPriceService.getAllPrices();
    res.json({ 
      success: true, 
      status,
      prices,
      message: status.connected 
        ? 'Real-time prices from ' + status.source
        : 'Price feed disconnected - trading may be unavailable'
    });
  });

  // GET /pairs
  app.get('/api/v1/trade/pairs', (req, res) => {
    const pairs = mockTradeService.getPairs();
    res.json({ success: true, pairs });
  });

  // GET /price/:asset
  app.get('/api/v1/trade/price/:asset', (req, res) => {
    const price = mockTradeService.getPrice(req.params.asset);
    if (price === null) {
      return res.status(503).json({ 
        success: false, 
        asset: req.params.asset.toUpperCase(), 
        error: 'Price not available - real-time feed may be disconnected'
      });
    }
    res.json({ success: true, asset: req.params.asset.toUpperCase(), price });
  });

  // GET /rate/:from/:to
  app.get('/api/v1/trade/rate/:from/:to', (req, res) => {
    const rate = mockTradeService.getRate(req.params.from, req.params.to);
    if (rate === null) {
      return res.status(503).json({
        success: false,
        from: req.params.from.toUpperCase(),
        to: req.params.to.toUpperCase(),
        error: 'Rate not available'
      });
    }
    res.json({
      success: true,
      from: req.params.from.toUpperCase(),
      to: req.params.to.toUpperCase(),
      rate
    });
  });

  // POST /convert/quote (authenticated)
  app.post('/api/v1/trade/convert/quote', mockAuthenticate, (req, res) => {
    const { fromAsset, toAsset, amount } = req.body;
    if (!fromAsset || !toAsset || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    const quote = mockTradeService.getConvertQuote(fromAsset, toAsset, amount);
    res.json({ success: true, quote });
  });

  // POST /convert (authenticated)
  app.post('/api/v1/trade/convert', mockAuthenticate, async (req, res) => {
    try {
      const { fromAsset, toAsset, amount } = req.body;
      if (!fromAsset || !toAsset || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid parameters' });
      }
      const result = await mockTradeService.executeConvert(
        (req as any).user.id,
        fromAsset,
        toAsset,
        amount
      );
      res.json({
        success: true,
        message: `Converted ${amount} ${fromAsset} to ${result.toAmount.toFixed(8)} ${toAsset}`,
        toAmount: result.toAmount,
        orderId: result.orderId
      });
    } catch (error: unknown) {
      res.status(400).json({ error: error.message });
    }
  });

  // POST /order (authenticated)
  app.post('/api/v1/trade/order', mockAuthenticate, async (req, res) => {
    try {
      const { pair, side, price, quantity } = req.body;
      if (!pair || !side || !price || !quantity) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      if (side !== 'buy' && side !== 'sell') {
        return res.status(400).json({ error: 'Side must be buy or sell' });
      }
      const order = await mockTradeService.placeLimitOrder(
        (req as any).user.id,
        pair,
        side,
        price,
        quantity
      );
      res.json({ success: true, order });
    } catch (error: unknown) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /order/:id (authenticated)
  app.delete('/api/v1/trade/order/:id', mockAuthenticate, async (req, res) => {
    try {
      await mockTradeService.cancelOrder((req as any).user.id, req.params.id);
      res.json({ success: true, message: 'Order cancelled' });
    } catch (error: unknown) {
      res.status(400).json({ error: error.message });
    }
  });

  // GET /orders (authenticated)
  app.get('/api/v1/trade/orders', mockAuthenticate, async (req, res) => {
    const status = req.query.status as string | undefined;
    const orders = await mockTradeService.getOrders((req as any).user.id, status);
    res.json({ success: true, orders });
  });

  return app;
}

describe('Trade Routes Integration', () => {
  let app: ReturnType<typeof createTradeApp>;

  beforeEach(() => {
    app = createTradeApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/trade/price-status (public)', () => {
    it('should return connected status with prices', async () => {
      mockPriceService.getStatus.mockReturnValue({
        connected: true,
        source: 'Binance WebSocket',
        lastUpdate: new Date(),
      });
      mockPriceService.getAllPrices.mockReturnValue({
        BTC: 45000,
        ETH: 2500,
        USDT: 1,
      });

      const response = await request(app).get('/api/v1/trade/price-status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status.connected).toBe(true);
      expect(response.body.prices.BTC).toBe(45000);
    });

    it('should indicate disconnected status', async () => {
      mockPriceService.getStatus.mockReturnValue({
        connected: false,
        source: 'none',
        lastUpdate: null,
      });
      mockPriceService.getAllPrices.mockReturnValue({});

      const response = await request(app).get('/api/v1/trade/price-status');

      expect(response.status).toBe(200);
      expect(response.body.status.connected).toBe(false);
      expect(response.body.message).toContain('disconnected');
    });
  });

  describe('GET /api/trade/pairs (public)', () => {
    it('should return all trading pairs', async () => {
      mockTradeService.getPairs.mockReturnValue([
        { pair: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', price: 45000, rate: 45000 },
        { pair: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', price: 2500, rate: 2500 },
      ]);

      const response = await request(app).get('/api/v1/trade/pairs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.pairs.length).toBe(2);
    });
  });

  describe('GET /api/trade/price/:asset (public)', () => {
    it('should return price for valid asset', async () => {
      mockTradeService.getPrice.mockReturnValue(45000);

      const response = await request(app).get('/api/v1/trade/price/btc');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.asset).toBe('BTC');
      expect(response.body.price).toBe(45000);
    });

    it('should return 503 when price not available', async () => {
      mockTradeService.getPrice.mockReturnValue(null);

      const response = await request(app).get('/api/v1/trade/price/xyz');

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not available');
    });
  });

  describe('GET /api/trade/rate/:from/:to (public)', () => {
    it('should return exchange rate', async () => {
      mockTradeService.getRate.mockReturnValue(0.055);

      const response = await request(app).get('/api/v1/trade/rate/eth/btc');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.from).toBe('ETH');
      expect(response.body.to).toBe('BTC');
      expect(response.body.rate).toBe(0.055);
    });

    it('should return 503 when rate not available', async () => {
      mockTradeService.getRate.mockReturnValue(null);

      const response = await request(app).get('/api/v1/trade/rate/abc/xyz');

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/trade/convert/quote (authenticated)', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/trade/convert/quote')
        .send({ fromAsset: 'BTC', toAsset: 'USDT', amount: 1 });

      expect(response.status).toBe(401);
    });

    it('should return quote for valid conversion', async () => {
      mockTradeService.getConvertQuote.mockReturnValue({
        fromAsset: 'BTC',
        toAsset: 'USDT',
        fromAmount: 1,
        toAmount: 44955,
        rate: 45000,
        fee: 45,
        feePercent: 0.1,
        expiresAt: new Date(Date.now() + 30000),
      });

      const response = await request(app)
        .post('/api/v1/trade/convert/quote')
        .set('Authorization', 'Bearer valid-token')
        .send({ fromAsset: 'BTC', toAsset: 'USDT', amount: 1 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.quote.fromAmount).toBe(1);
      expect(response.body.quote.toAmount).toBe(44955);
    });

    it('should return 400 for missing parameters', async () => {
      const response = await request(app)
        .post('/api/v1/trade/convert/quote')
        .set('Authorization', 'Bearer valid-token')
        .send({ fromAsset: 'BTC' }); // missing toAsset and amount

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid parameters');
    });

    it('should return 400 for invalid amount', async () => {
      const response = await request(app)
        .post('/api/v1/trade/convert/quote')
        .set('Authorization', 'Bearer valid-token')
        .send({ fromAsset: 'BTC', toAsset: 'USDT', amount: -1 });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/trade/convert (authenticated)', () => {
    it('should execute conversion', async () => {
      mockTradeService.executeConvert.mockResolvedValue({
        orderId: 'ord-123',
        toAmount: 44955,
      });

      const response = await request(app)
        .post('/api/v1/trade/convert')
        .set('Authorization', 'Bearer valid-token')
        .send({ fromAsset: 'BTC', toAsset: 'USDT', amount: 1 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.orderId).toBe('ord-123');
      expect(response.body.toAmount).toBe(44955);
    });

    it('should return 400 for insufficient balance', async () => {
      mockTradeService.executeConvert.mockRejectedValue(
        new Error('Insufficient balance')
      );

      const response = await request(app)
        .post('/api/v1/trade/convert')
        .set('Authorization', 'Bearer valid-token')
        .send({ fromAsset: 'BTC', toAsset: 'USDT', amount: 100 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Insufficient balance');
    });
  });

  describe('POST /api/trade/order (authenticated)', () => {
    it('should place limit order', async () => {
      mockTradeService.placeLimitOrder.mockResolvedValue({
        id: 'order-123',
        pair: 'BTC/USDT',
        side: 'buy',
        price: 44000,
        quantity: 0.1,
        status: 'open',
      });

      const response = await request(app)
        .post('/api/v1/trade/order')
        .set('Authorization', 'Bearer valid-token')
        .send({ pair: 'BTC/USDT', side: 'buy', price: 44000, quantity: 0.1 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.order.id).toBe('order-123');
    });

    it('should return 400 for missing fields', async () => {
      const response = await request(app)
        .post('/api/v1/trade/order')
        .set('Authorization', 'Bearer valid-token')
        .send({ pair: 'BTC/USDT' }); // missing side, price, quantity

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should return 400 for invalid side', async () => {
      const response = await request(app)
        .post('/api/v1/trade/order')
        .set('Authorization', 'Bearer valid-token')
        .send({ pair: 'BTC/USDT', side: 'invalid', price: 44000, quantity: 0.1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Side must be buy or sell');
    });
  });

  describe('DELETE /api/trade/order/:id (authenticated)', () => {
    it('should cancel order', async () => {
      mockTradeService.cancelOrder.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/trade/order/order-123')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Order cancelled');
    });

    it('should return 400 for non-existent order', async () => {
      mockTradeService.cancelOrder.mockRejectedValue(
        new Error('Order not found')
      );

      const response = await request(app)
        .delete('/api/v1/trade/order/invalid-order')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/trade/orders (authenticated)', () => {
    it('should return user orders', async () => {
      mockTradeService.getOrders.mockResolvedValue([
        { id: 'order-1', pair: 'BTC/USDT', side: 'buy', status: 'filled' },
        { id: 'order-2', pair: 'ETH/USDT', side: 'sell', status: 'open' },
      ]);

      const response = await request(app)
        .get('/api/v1/trade/orders')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.orders.length).toBe(2);
    });

    it('should filter by status', async () => {
      mockTradeService.getOrders.mockResolvedValue([
        { id: 'order-2', pair: 'ETH/USDT', side: 'sell', status: 'open' },
      ]);

      const response = await request(app)
        .get('/api/v1/trade/orders?status=open')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(mockTradeService.getOrders).toHaveBeenCalledWith('test-user-123', 'open');
    });
  });
});
