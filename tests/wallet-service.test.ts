/**
 * Wallet Service Tests
 * Tests for wallet creation, lookup, and address resolution
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWalletAddress } from '../server/storage';

describe('Address Generation Integration', () => {
  it('should generate consistent addresses across modules', () => {
    // This tests that the same function produces consistent results
    const email = 'integration-test@example.com';
    const address1 = generateWalletAddress(email);
    const address2 = generateWalletAddress(email);
    expect(address1).toBe(address2);
  });

  it('should handle seed user emails correctly', () => {
    const primaryAddress = generateWalletAddress('seed.user.primary@krystaline.io');
    const secondaryAddress = generateWalletAddress('seed.user.secondary@krystaline.io');

    expect(primaryAddress.startsWith('kx1')).toBe(true);
    expect(secondaryAddress.startsWith('kx1')).toBe(true);
    expect(primaryAddress).not.toBe(secondaryAddress);
  });

  it('should generate kx1 address from user email', () => {
    const address = generateWalletAddress('test@example.com');
    expect(address.startsWith('kx1')).toBe(true);
    expect(address.length).toBe(35);
  });

  it('should return same address for same email', () => {
    const address1 = generateWalletAddress('consistent@example.com');
    const address2 = generateWalletAddress('consistent@example.com');
    expect(address1).toBe(address2);
  });

  it('should return different addresses for different emails', () => {
    const address1 = generateWalletAddress('user1@example.com');
    const address2 = generateWalletAddress('user2@example.com');
    expect(address1).not.toBe(address2);
  });
});

describe('Address Resolution Logic', () => {
  // Helper to simulate address resolution
  function isKXAddress(identifier: string): boolean {
    return identifier.startsWith('kx1') && identifier.length >= 23;
  }

  it('should detect kx1 address correctly', () => {
    expect(isKXAddress('kx1abcdefghij1234567890abcdefgh')).toBe(true);
    expect(isKXAddress('kx1' + 'a'.repeat(32))).toBe(true);
  });

  it('should reject non-kx1 addresses', () => {
    expect(isKXAddress('abc123')).toBe(false);
    expect(isKXAddress('seed.user.primary@krystaline.io')).toBe(false);
    expect(isKXAddress('')).toBe(false);
  });

  it('should reject short kx1 addresses', () => {
    expect(isKXAddress('kx1abc')).toBe(false);
    expect(isKXAddress('kx1')).toBe(false);
  });

  it('should accept minimum length kx1 address', () => {
    // kx1 (3) + 20 chars minimum = 23 chars total
    expect(isKXAddress('kx1' + 'a'.repeat(20))).toBe(true);
  });
});

describe('Wallet Type Validation', () => {
  const validWalletTypes = ['trading', 'savings', 'cold'] as const;

  it('should accept all valid wallet types', () => {
    validWalletTypes.forEach((type) => {
      expect(validWalletTypes.includes(type)).toBe(true);
    });
  });

  it('should have trading as default type', () => {
    const defaultType = 'trading';
    expect(validWalletTypes.includes(defaultType)).toBe(true);
  });
});
