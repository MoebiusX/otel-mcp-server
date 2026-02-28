/**
 * Price Service Tests
 * Tests for price feeds, calculations, and formatting
 */
import { describe, it, expect } from 'vitest';

// Price formatting utilities
function formatPrice(price: number, decimals: number = 2): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCrypto(amount: number, symbol: string): string {
  const decimals = symbol === 'BTC' ? 8 : symbol === 'ETH' ? 6 : 2;
  return `${amount.toFixed(decimals)} ${symbol}`;
}

function calculateSlippage(
  orderPrice: number,
  fillPrice: number,
  side: 'BUY' | 'SELL'
): number {
  if (side === 'BUY') {
    return ((fillPrice - orderPrice) / orderPrice) * 100;
  } else {
    return ((orderPrice - fillPrice) / orderPrice) * 100;
  }
}

function calculateFee(amount: number, feePercent: number): number {
  return amount * (feePercent / 100);
}

describe('Price Formatting', () => {
  describe('formatPrice', () => {
    it('should format price with default 2 decimals', () => {
      expect(formatPrice(50000)).toBe('50,000.00');
    });

    it('should format price with custom decimals', () => {
      expect(formatPrice(50000.123456, 4)).toBe('50,000.1235');
    });

    it('should format small prices correctly', () => {
      expect(formatPrice(0.01)).toBe('0.01');
    });

    it('should format large prices with commas', () => {
      expect(formatPrice(1000000)).toBe('1,000,000.00');
    });

    it('should round prices correctly', () => {
      expect(formatPrice(50000.125, 2)).toBe('50,000.13');
      expect(formatPrice(50000.124, 2)).toBe('50,000.12');
    });
  });

  describe('formatCrypto', () => {
    it('should format BTC with 8 decimals', () => {
      expect(formatCrypto(1.5, 'BTC')).toBe('1.50000000 BTC');
    });

    it('should format small BTC amounts', () => {
      expect(formatCrypto(0.00000001, 'BTC')).toBe('0.00000001 BTC');
    });

    it('should format ETH with 6 decimals', () => {
      expect(formatCrypto(2.5, 'ETH')).toBe('2.500000 ETH');
    });

    it('should format USD with 2 decimals', () => {
      expect(formatCrypto(100, 'USD')).toBe('100.00 USD');
    });
  });
});

describe('Slippage Calculation', () => {
  describe('BUY orders', () => {
    it('should calculate positive slippage for higher fill price', () => {
      // Ordered at 50000, filled at 50050
      const slippage = calculateSlippage(50000, 50050, 'BUY');
      expect(slippage).toBeCloseTo(0.1, 2);
    });

    it('should calculate negative slippage for lower fill price', () => {
      // Ordered at 50000, filled at 49950
      const slippage = calculateSlippage(50000, 49950, 'BUY');
      expect(slippage).toBeCloseTo(-0.1, 2);
    });

    it('should return zero for exact fill', () => {
      const slippage = calculateSlippage(50000, 50000, 'BUY');
      expect(slippage).toBe(0);
    });
  });

  describe('SELL orders', () => {
    it('should calculate positive slippage for lower fill price', () => {
      // Ordered at 50000, filled at 49950
      const slippage = calculateSlippage(50000, 49950, 'SELL');
      expect(slippage).toBeCloseTo(0.1, 2);
    });

    it('should calculate negative slippage for higher fill price', () => {
      // Ordered at 50000, filled at 50050
      const slippage = calculateSlippage(50000, 50050, 'SELL');
      expect(slippage).toBeCloseTo(-0.1, 2);
    });
  });

  describe('edge cases', () => {
    it('should handle small price differences', () => {
      const slippage = calculateSlippage(50000, 50000.01, 'BUY');
      expect(slippage).toBeCloseTo(0.00002, 5);
    });

    it('should handle large price differences', () => {
      const slippage = calculateSlippage(50000, 55000, 'BUY');
      expect(slippage).toBe(10);
    });
  });
});

describe('Fee Calculation', () => {
  describe('trading fees', () => {
    it('should calculate 0.1% fee correctly', () => {
      const fee = calculateFee(10000, 0.1);
      expect(fee).toBe(10);
    });

    it('should calculate 0.25% fee correctly', () => {
      const fee = calculateFee(10000, 0.25);
      expect(fee).toBe(25);
    });

    it('should calculate fee for small amounts', () => {
      const fee = calculateFee(100, 0.1);
      expect(fee).toBe(0.1);
    });

    it('should return zero for zero amount', () => {
      const fee = calculateFee(0, 0.1);
      expect(fee).toBe(0);
    });

    it('should return zero for zero fee percent', () => {
      const fee = calculateFee(10000, 0);
      expect(fee).toBe(0);
    });
  });

  describe('total cost calculation', () => {
    it('should calculate total cost including fee', () => {
      const amount = 10000;
      const feePercent = 0.1;
      const fee = calculateFee(amount, feePercent);
      const total = amount + fee;
      expect(total).toBe(10010);
    });

    it('should calculate net proceeds after fee', () => {
      const amount = 10000;
      const feePercent = 0.1;
      const fee = calculateFee(amount, feePercent);
      const net = amount - fee;
      expect(net).toBe(9990);
    });
  });
});

describe('Price Simulation', () => {
  describe('price movement', () => {
    it('should simulate price within expected range', () => {
      const basePrice = 50000;
      const volatility = 0.01; // 1%
      
      for (let i = 0; i < 100; i++) {
        const movement = (Math.random() - 0.5) * 2 * volatility;
        const newPrice = basePrice * (1 + movement);
        
        expect(newPrice).toBeGreaterThan(basePrice * (1 - volatility));
        expect(newPrice).toBeLessThan(basePrice * (1 + volatility));
      }
    });
  });

  describe('spread calculation', () => {
    it('should calculate bid-ask spread', () => {
      const midPrice = 50000;
      const spreadPercent = 0.1; // 0.1%
      
      const bid = midPrice * (1 - spreadPercent / 200);
      const ask = midPrice * (1 + spreadPercent / 200);
      const spread = ask - bid;
      
      expect(bid).toBeLessThan(midPrice);
      expect(ask).toBeGreaterThan(midPrice);
      expect(spread).toBeCloseTo(midPrice * spreadPercent / 100, 2);
    });

    it('should maintain bid < mid < ask relationship', () => {
      const midPrice = 50000;
      const spreadPercent = 0.5;
      
      const bid = midPrice * (1 - spreadPercent / 200);
      const ask = midPrice * (1 + spreadPercent / 200);
      
      expect(bid).toBeLessThan(midPrice);
      expect(midPrice).toBeLessThan(ask);
    });
  });
});
