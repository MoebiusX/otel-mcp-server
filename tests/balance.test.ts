/**
 * Balance Calculation Tests
 * Tests for integer-based balance calculations to avoid floating point errors
 */
import { describe, it, expect } from 'vitest';

// Balance utility functions (these should match what's in storage)
const DECIMALS = {
  BTC: 8,
  USD: 2,
  ETH: 18,
};

function toSmallestUnit(amount: number, asset: keyof typeof DECIMALS): bigint {
  const decimals = DECIMALS[asset];
  const multiplier = BigInt(10 ** decimals);
  // Use string conversion to avoid floating point issues
  const amountStr = amount.toFixed(decimals);
  const [whole, frac = ''] = amountStr.split('.');
  const fracPadded = frac.padEnd(decimals, '0');
  return BigInt(whole + fracPadded);
}

function fromSmallestUnit(amount: bigint, asset: keyof typeof DECIMALS): number {
  const decimals = DECIMALS[asset];
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  const fracStr = remainder.toString().padStart(decimals, '0');
  return parseFloat(`${whole}.${fracStr}`);
}

describe('Balance Unit Conversions', () => {
  describe('toSmallestUnit', () => {
    it('should convert 1 BTC to 100000000 satoshis', () => {
      const satoshis = toSmallestUnit(1, 'BTC');
      expect(satoshis).toBe(100000000n);
    });

    it('should convert 0.5 BTC to 50000000 satoshis', () => {
      const satoshis = toSmallestUnit(0.5, 'BTC');
      expect(satoshis).toBe(50000000n);
    });

    it('should convert 1.5 BTC to 150000000 satoshis', () => {
      const satoshis = toSmallestUnit(1.5, 'BTC');
      expect(satoshis).toBe(150000000n);
    });

    it('should convert 0.00000001 BTC to 1 satoshi', () => {
      const satoshis = toSmallestUnit(0.00000001, 'BTC');
      expect(satoshis).toBe(1n);
    });

    it('should convert $1.00 to 100 cents', () => {
      const cents = toSmallestUnit(1, 'USD');
      expect(cents).toBe(100n);
    });

    it('should convert $50000.00 to 5000000 cents', () => {
      const cents = toSmallestUnit(50000, 'USD');
      expect(cents).toBe(5000000n);
    });

    it('should convert $0.01 to 1 cent', () => {
      const cents = toSmallestUnit(0.01, 'USD');
      expect(cents).toBe(1n);
    });

    it('should handle zero correctly', () => {
      expect(toSmallestUnit(0, 'BTC')).toBe(0n);
      expect(toSmallestUnit(0, 'USD')).toBe(0n);
    });
  });

  describe('fromSmallestUnit', () => {
    it('should convert 100000000 satoshis to 1 BTC', () => {
      const btc = fromSmallestUnit(100000000n, 'BTC');
      expect(btc).toBe(1);
    });

    it('should convert 50000000 satoshis to 0.5 BTC', () => {
      const btc = fromSmallestUnit(50000000n, 'BTC');
      expect(btc).toBe(0.5);
    });

    it('should convert 1 satoshi to 0.00000001 BTC', () => {
      const btc = fromSmallestUnit(1n, 'BTC');
      expect(btc).toBe(0.00000001);
    });

    it('should convert 100 cents to $1.00', () => {
      const usd = fromSmallestUnit(100n, 'USD');
      expect(usd).toBe(1);
    });

    it('should convert 5000000 cents to $50000.00', () => {
      const usd = fromSmallestUnit(5000000n, 'USD');
      expect(usd).toBe(50000);
    });
  });

  describe('round-trip conversions', () => {
    it('should preserve BTC amounts through round-trip', () => {
      const amounts = [0.1, 0.01, 0.001, 0.00000001, 1.5, 100.12345678];
      amounts.forEach((amount) => {
        const satoshis = toSmallestUnit(amount, 'BTC');
        const result = fromSmallestUnit(satoshis, 'BTC');
        expect(result).toBeCloseTo(amount, 8);
      });
    });

    it('should preserve USD amounts through round-trip', () => {
      const amounts = [0.01, 1, 10.5, 100.99, 50000, 999999.99];
      amounts.forEach((amount) => {
        const cents = toSmallestUnit(amount, 'USD');
        const result = fromSmallestUnit(cents, 'USD');
        expect(result).toBeCloseTo(amount, 2);
      });
    });
  });
});

describe('Balance Arithmetic', () => {
  describe('addition', () => {
    it('should add balances correctly without floating point errors', () => {
      // Classic floating point issue: 0.1 + 0.2 !== 0.3
      const balance1 = toSmallestUnit(0.1, 'BTC');
      const balance2 = toSmallestUnit(0.2, 'BTC');
      const sum = balance1 + balance2;
      expect(sum).toBe(toSmallestUnit(0.3, 'BTC'));
    });

    it('should add small USD amounts correctly', () => {
      const balance1 = toSmallestUnit(0.01, 'USD');
      const balance2 = toSmallestUnit(0.02, 'USD');
      const sum = balance1 + balance2;
      expect(sum).toBe(3n);
    });

    it('should add large amounts correctly', () => {
      const balance1 = toSmallestUnit(10000, 'BTC');
      const balance2 = toSmallestUnit(20000, 'BTC');
      const sum = balance1 + balance2;
      expect(fromSmallestUnit(sum, 'BTC')).toBe(30000);
    });
  });

  describe('subtraction', () => {
    it('should subtract balances correctly', () => {
      const balance = toSmallestUnit(1.5, 'BTC');
      const withdrawal = toSmallestUnit(0.5, 'BTC');
      const remaining = balance - withdrawal;
      expect(fromSmallestUnit(remaining, 'BTC')).toBe(1);
    });

    it('should handle near-zero remainders', () => {
      const balance = toSmallestUnit(0.00000002, 'BTC');
      const withdrawal = toSmallestUnit(0.00000001, 'BTC');
      const remaining = balance - withdrawal;
      expect(remaining).toBe(1n);
    });
  });

  describe('comparison', () => {
    it('should compare balances correctly', () => {
      const balance = toSmallestUnit(1.5, 'BTC');
      const required = toSmallestUnit(1, 'BTC');
      expect(balance >= required).toBe(true);
    });

    it('should detect insufficient balance', () => {
      const balance = toSmallestUnit(0.5, 'BTC');
      const required = toSmallestUnit(1, 'BTC');
      expect(balance >= required).toBe(false);
    });

    it('should handle equal balances', () => {
      const balance1 = toSmallestUnit(0.1, 'BTC');
      const balance2 = toSmallestUnit(0.1, 'BTC');
      expect(balance1 === balance2).toBe(true);
    });
  });
});

describe('Trade Value Calculations', () => {
  it('should calculate BTC trade value in USD', () => {
    const btcAmount = toSmallestUnit(0.5, 'BTC');
    const pricePerBTC = toSmallestUnit(50000, 'USD');
    
    // Value = (btcAmount * pricePerBTC) / 10^8 (to normalize BTC decimals)
    const value = (btcAmount * pricePerBTC) / 100000000n;
    const usdValue = fromSmallestUnit(value, 'USD');
    expect(usdValue).toBe(25000);
  });

  it('should calculate small trade value correctly', () => {
    const btcAmount = toSmallestUnit(0.001, 'BTC'); // 100000 satoshis
    const pricePerBTC = toSmallestUnit(50000, 'USD'); // 5000000 cents
    
    const value = (btcAmount * pricePerBTC) / 100000000n;
    const usdValue = fromSmallestUnit(value, 'USD');
    expect(usdValue).toBe(50);
  });

  it('should avoid floating point precision loss', () => {
    // This test ensures we don't have issues like:
    // 0.1 + 0.2 = 0.30000000000000004 in JavaScript
    
    const amounts = [0.1, 0.2, 0.3];
    const satoshis = amounts.map(a => toSmallestUnit(a, 'BTC'));
    const total = satoshis.reduce((a, b) => a + b, 0n);
    
    expect(total).toBe(60000000n); // 0.6 BTC exactly
    expect(fromSmallestUnit(total, 'BTC')).toBe(0.6);
  });
});
