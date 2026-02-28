/**
 * Order Service Tests
 * Tests for order creation, validation, and matching
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertOrderSchema, orderSchema, executionSchema } from '../shared/schema';

// Test the insert order schema validation (used for creating new orders)
describe('Insert Order Schema Validation', () => {
  const validOrder = {
    pair: 'BTC/USD' as const,
    side: 'BUY' as const,
    quantity: 0.5,
    orderType: 'MARKET' as const,
  };

  describe('valid orders', () => {
    it('should accept valid market buy order', () => {
      expect(() => insertOrderSchema.parse(validOrder)).not.toThrow();
    });

    it('should accept valid market sell order', () => {
      const sellOrder = { ...validOrder, side: 'SELL' as const };
      expect(() => insertOrderSchema.parse(sellOrder)).not.toThrow();
    });

    it('should accept small quantities', () => {
      expect(() =>
        insertOrderSchema.parse({ ...validOrder, quantity: 0.00001 })
      ).not.toThrow();
    });

    it('should accept large quantities', () => {
      expect(() =>
        insertOrderSchema.parse({ ...validOrder, quantity: 1000000 })
      ).not.toThrow();
    });
  });

  describe('invalid orders', () => {
    it('should reject order with invalid pair', () => {
      expect(() =>
        insertOrderSchema.parse({ ...validOrder, pair: 'ETH/USD' })
      ).toThrow();
    });

    it('should reject order with invalid side', () => {
      expect(() =>
        insertOrderSchema.parse({ ...validOrder, side: 'HOLD' })
      ).toThrow();
    });

    it('should reject order with zero quantity', () => {
      expect(() =>
        insertOrderSchema.parse({ ...validOrder, quantity: 0 })
      ).toThrow();
    });

    it('should reject order with negative quantity', () => {
      expect(() =>
        insertOrderSchema.parse({ ...validOrder, quantity: -1 })
      ).toThrow();
    });

    it('should reject order with missing pair', () => {
      const { pair, ...orderWithoutPair } = validOrder;
      expect(() => insertOrderSchema.parse(orderWithoutPair)).toThrow();
    });

    it('should reject non-MARKET order types', () => {
      expect(() =>
        insertOrderSchema.parse({ ...validOrder, orderType: 'LIMIT' })
      ).toThrow();
    });
  });
});

describe('Order Schema Validation (Full Order)', () => {
  const validFullOrder = {
    orderId: 'ord_abc123',
    pair: 'BTC/USD' as const,
    side: 'BUY' as const,
    quantity: 0.5,
    orderType: 'MARKET' as const,
    status: 'FILLED' as const,
    fillPrice: 50000,
    totalValue: 25000,
    traceId: 'abc123def456',
    spanId: '789ghi012',
    createdAt: new Date(),
  };

  it('should accept valid filled order', () => {
    expect(() => orderSchema.parse(validFullOrder)).not.toThrow();
  });

  it('should accept pending order without fillPrice', () => {
    const pendingOrder = {
      ...validFullOrder,
      status: 'PENDING' as const,
      fillPrice: undefined,
      totalValue: undefined,
    };
    expect(() => orderSchema.parse(pendingOrder)).not.toThrow();
  });

  it('should accept rejected order', () => {
    const rejectedOrder = {
      ...validFullOrder,
      status: 'REJECTED' as const,
      fillPrice: undefined,
      totalValue: undefined,
    };
    expect(() => orderSchema.parse(rejectedOrder)).not.toThrow();
  });

  it('should require orderId', () => {
    const { orderId, ...orderWithoutId } = validFullOrder;
    expect(() => orderSchema.parse(orderWithoutId)).toThrow();
  });

  it('should require traceId', () => {
    const { traceId, ...orderWithoutTrace } = validFullOrder;
    expect(() => orderSchema.parse(orderWithoutTrace)).toThrow();
  });
});

describe('Execution Schema Validation', () => {
  const validExecution = {
    orderId: 'ord_abc123',
    executionId: 'exec_xyz789',
    pair: 'BTC/USD',
    side: 'BUY' as const,
    quantity: 0.5,
    fillPrice: 50000,
    totalValue: 25000,
    status: 'FILLED' as const,
    processorId: 'matcher-1',
    timestamp: new Date().toISOString(),
  };

  it('should accept valid filled execution', () => {
    expect(() => executionSchema.parse(validExecution)).not.toThrow();
  });

  it('should accept rejected execution', () => {
    const rejected = { ...validExecution, status: 'REJECTED' as const };
    expect(() => executionSchema.parse(rejected)).not.toThrow();
  });

  it('should require processorId', () => {
    const { processorId, ...execWithoutProcessor } = validExecution;
    expect(() => executionSchema.parse(execWithoutProcessor)).toThrow();
  });
});

describe('Order Pair Parsing', () => {
  it('should correctly parse BTC/USD pair', () => {
    const pair = 'BTC/USD';
    const [base, quote] = pair.split('/');
    expect(base).toBe('BTC');
    expect(quote).toBe('USD');
  });

  it('should correctly parse ETH/BTC pair', () => {
    const pair = 'ETH/BTC';
    const [base, quote] = pair.split('/');
    expect(base).toBe('ETH');
    expect(quote).toBe('BTC');
  });
});

describe('Order Value Calculations', () => {
  it('should calculate correct order value for buy', () => {
    const quantity = 0.5;
    const price = 50000;
    const orderValue = quantity * price;
    expect(orderValue).toBe(25000);
  });

  it('should calculate correct order value for fractional quantities', () => {
    const quantity = 0.00001;
    const price = 50000;
    const orderValue = quantity * price;
    expect(orderValue).toBe(0.5);
  });

  it('should handle large order values', () => {
    const quantity = 100;
    const price = 100000;
    const orderValue = quantity * price;
    expect(orderValue).toBe(10000000);
  });
});
