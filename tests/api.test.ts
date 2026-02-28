/**
 * API Route Tests
 * Tests for REST API endpoints validation and response formats
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// API response schemas for testing
const healthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  services: z.record(z.object({
    status: z.string(),
    latency: z.number().optional(),
  })).optional(),
});

const walletResponseSchema = z.object({
  wallets: z.array(z.object({
    id: z.string(),
    asset: z.string(),
    balance: z.number(),
    address: z.string().optional(),
  })),
});

const orderResponseSchema = z.object({
  orderId: z.string(),
  status: z.enum(['PENDING', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'REJECTED']),
  fillPrice: z.number().optional(),
  filledQuantity: z.number().optional(),
  timestamp: z.string(),
});

const transferResponseSchema = z.object({
  id: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  amount: z.number(),
  asset: z.string(),
  status: z.enum(['pending', 'completed', 'failed']),
  timestamp: z.string(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  code: z.string().optional(),
});

describe('API Response Schema Validation', () => {
  describe('Health Response', () => {
    it('should validate healthy response', () => {
      const response = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: { status: 'ok', latency: 5 },
          rabbitmq: { status: 'ok', latency: 12 },
        },
      };
      expect(() => healthResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate degraded response', () => {
      const response = {
        status: 'degraded',
        timestamp: new Date().toISOString(),
      };
      expect(() => healthResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate unhealthy response', () => {
      const response = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      };
      expect(() => healthResponseSchema.parse(response)).not.toThrow();
    });
  });

  describe('Wallet Response', () => {
    it('should validate wallet list with addresses', () => {
      const response = {
        wallets: [
          {
            id: 'wal_abc123',
            asset: 'BTC',
            balance: 1.5,
            address: 'kx1abc123def456ghi789jkl012mno',
          },
          {
            id: 'wal_def456',
            asset: 'USD',
            balance: 50000,
            address: 'kx1abc123def456ghi789jkl012mno',
          },
        ],
      };
      expect(() => walletResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate wallet list without addresses (legacy)', () => {
      const response = {
        wallets: [
          { id: 'wal_abc123', asset: 'BTC', balance: 1.5 },
        ],
      };
      expect(() => walletResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate empty wallet list', () => {
      const response = { wallets: [] };
      expect(() => walletResponseSchema.parse(response)).not.toThrow();
    });
  });

  describe('Order Response', () => {
    it('should validate filled order response', () => {
      const response = {
        orderId: 'ord_abc123',
        status: 'FILLED',
        fillPrice: 50123.45,
        filledQuantity: 0.5,
        timestamp: new Date().toISOString(),
      };
      expect(() => orderResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate pending order response', () => {
      const response = {
        orderId: 'ord_abc123',
        status: 'PENDING',
        timestamp: new Date().toISOString(),
      };
      expect(() => orderResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate rejected order response', () => {
      const response = {
        orderId: 'ord_abc123',
        status: 'REJECTED',
        timestamp: new Date().toISOString(),
      };
      expect(() => orderResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate partially filled order response', () => {
      const response = {
        orderId: 'ord_abc123',
        status: 'PARTIALLY_FILLED',
        fillPrice: 50000,
        filledQuantity: 0.25,
        timestamp: new Date().toISOString(),
      };
      expect(() => orderResponseSchema.parse(response)).not.toThrow();
    });
  });

  describe('Transfer Response', () => {
    it('should validate completed transfer response', () => {
      const response = {
        id: 'txn_abc123',
        fromAddress: 'kx1sender000000000000000000000',
        toAddress: 'kx1receiver00000000000000000000',
        amount: 0.5,
        asset: 'BTC',
        status: 'completed',
        timestamp: new Date().toISOString(),
      };
      expect(() => transferResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate pending transfer response', () => {
      const response = {
        id: 'txn_abc123',
        fromAddress: 'kx1sender000000000000000000000',
        toAddress: 'kx1receiver00000000000000000000',
        amount: 1000,
        asset: 'USD',
        status: 'pending',
        timestamp: new Date().toISOString(),
      };
      expect(() => transferResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate failed transfer response', () => {
      const response = {
        id: 'txn_abc123',
        fromAddress: 'kx1sender000000000000000000000',
        toAddress: 'kx1receiver00000000000000000000',
        amount: 100,
        asset: 'BTC',
        status: 'failed',
        timestamp: new Date().toISOString(),
      };
      expect(() => transferResponseSchema.parse(response)).not.toThrow();
    });
  });

  describe('Error Response', () => {
    it('should validate basic error response', () => {
      const response = {
        error: 'Insufficient balance',
      };
      expect(() => errorResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate error response with message', () => {
      const response = {
        error: 'Invalid request',
        message: 'The quantity must be greater than zero',
      };
      expect(() => errorResponseSchema.parse(response)).not.toThrow();
    });

    it('should validate error response with code', () => {
      const response = {
        error: 'Unauthorized',
        message: 'Invalid or expired token',
        code: 'AUTH_EXPIRED',
      };
      expect(() => errorResponseSchema.parse(response)).not.toThrow();
    });
  });
});

describe('Request Validation', () => {
  describe('Order Request', () => {
    const orderRequestSchema = z.object({
      pair: z.string().regex(/^[A-Z]+\/[A-Z]+$/),
      side: z.enum(['BUY', 'SELL']),
      type: z.enum(['MARKET', 'LIMIT']),
      quantity: z.number().positive(),
      price: z.number().positive().optional(),
    });

    it('should validate market order request', () => {
      const request = {
        pair: 'BTC/USD',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.5,
      };
      expect(() => orderRequestSchema.parse(request)).not.toThrow();
    });

    it('should validate limit order request with price', () => {
      const request = {
        pair: 'BTC/USD',
        side: 'SELL',
        type: 'LIMIT',
        quantity: 1.0,
        price: 55000,
      };
      expect(() => orderRequestSchema.parse(request)).not.toThrow();
    });

    it('should reject invalid trading pair format', () => {
      const request = {
        pair: 'btcusd', // lowercase, no slash
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.5,
      };
      expect(() => orderRequestSchema.parse(request)).toThrow();
    });
  });

  describe('Transfer Request', () => {
    const transferRequestSchema = z.object({
      toAddress: z.string().regex(/^kx1[a-z0-9]{20,40}$/),
      amount: z.number().positive(),
      asset: z.string().min(1),
      memo: z.string().max(256).optional(),
    });

    it('should validate transfer request with kx1 address', () => {
      const request = {
        toAddress: 'kx1receiver00000000000000000000',
        amount: 0.1,
        asset: 'BTC',
      };
      expect(() => transferRequestSchema.parse(request)).not.toThrow();
    });

    it('should validate transfer request with memo', () => {
      const request = {
        toAddress: 'kx1receiver00000000000000000000',
        amount: 100,
        asset: 'USD',
        memo: 'Payment for invoice #123',
      };
      expect(() => transferRequestSchema.parse(request)).not.toThrow();
    });

    it('should reject invalid address format', () => {
      const request = {
        toAddress: 'invalid-address',
        amount: 0.1,
        asset: 'BTC',
      };
      expect(() => transferRequestSchema.parse(request)).toThrow();
    });

    it('should reject memo that is too long', () => {
      const request = {
        toAddress: 'kx1receiver00000000000000000000',
        amount: 0.1,
        asset: 'BTC',
        memo: 'x'.repeat(300),
      };
      expect(() => transferRequestSchema.parse(request)).toThrow();
    });
  });
});
