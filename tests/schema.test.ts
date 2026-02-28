/**
 * Schema Validation Tests
 * Tests for Krystaline wallet address format and schemas
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  walletAddressSchema,
  kxWalletSchema,
  walletBalanceSchema,
  userWalletMappingSchema,
  insertTransferSchema,
  transferSchema,
} from '../shared/schema';

describe('Wallet Address Schema', () => {
  describe('valid addresses', () => {
    it('should accept valid kx1 address with minimum length', () => {
      const address = 'kx1' + 'a'.repeat(20);
      expect(() => walletAddressSchema.parse(address)).not.toThrow();
    });

    it('should accept valid kx1 address with maximum length', () => {
      const address = 'kx1' + 'a'.repeat(40);
      expect(() => walletAddressSchema.parse(address)).not.toThrow();
    });

    it('should accept kx1 address with mixed alphanumeric characters', () => {
      const address = 'kx1qxy2kgdygjrsqtzq2n0yrf249';
      expect(() => walletAddressSchema.parse(address)).not.toThrow();
    });

    it('should accept valid 32-char address body', () => {
      const address = 'kx1abcdefghij1234567890abcdefgh';
      expect(() => walletAddressSchema.parse(address)).not.toThrow();
    });
  });

  describe('invalid addresses', () => {
    it('should reject address without kx1 prefix', () => {
      const address = 'abc1qxy2kgdygjrsqtzq2n0yrf249';
      expect(() => walletAddressSchema.parse(address)).toThrow();
    });

    it('should reject address with uppercase letters', () => {
      const address = 'kx1QXY2KGDYGJRSQTZQ2N0YRF249';
      expect(() => walletAddressSchema.parse(address)).toThrow();
    });

    it('should reject address that is too short', () => {
      const address = 'kx1abc123';
      expect(() => walletAddressSchema.parse(address)).toThrow();
    });

    it('should reject address that is too long', () => {
      const address = 'kx1' + 'a'.repeat(50);
      expect(() => walletAddressSchema.parse(address)).toThrow();
    });

    it('should reject address with special characters', () => {
      const address = 'kx1abc-def_ghi!jkl@mno#pqr';
      expect(() => walletAddressSchema.parse(address)).toThrow();
    });

    it('should reject empty string', () => {
      expect(() => walletAddressSchema.parse('')).toThrow();
    });

    it('should reject just the prefix', () => {
      expect(() => walletAddressSchema.parse('kx1')).toThrow();
    });
  });
});

describe('KX Wallet Schema', () => {
  const validWallet = {
    walletId: 'wal_abc123def456ghi789jkl',
    address: 'kx1qxy2kgdygjrsqtzq2n0yrf249abc',
    ownerId: 'user_123',
    label: 'Main Wallet',
    type: 'custodial' as const,
    createdAt: new Date(),
  };

  it('should accept valid wallet with all required fields', () => {
    expect(() => kxWalletSchema.parse(validWallet)).not.toThrow();
  });

  it('should accept non-custodial wallet type', () => {
    const nonCustodial = { ...validWallet, type: 'non-custodial' as const };
    expect(() => kxWalletSchema.parse(nonCustodial)).not.toThrow();
  });

  it('should accept all valid wallet types', () => {
    const types = ['custodial', 'non-custodial'] as const;
    types.forEach((type) => {
      expect(() => kxWalletSchema.parse({ ...validWallet, type })).not.toThrow();
    });
  });

  it('should reject invalid wallet type', () => {
    expect(() => kxWalletSchema.parse({ ...validWallet, type: 'invalid' })).toThrow();
  });

  it('should reject wallet without walletId', () => {
    const { walletId, ...walletWithoutId } = validWallet;
    expect(() => kxWalletSchema.parse(walletWithoutId)).toThrow();
  });

  it('should reject wallet with invalid address format', () => {
    expect(() =>
      kxWalletSchema.parse({ ...validWallet, address: 'invalid_address' })
    ).toThrow();
  });
});

describe('Wallet Balance Schema', () => {
  const validBalance = {
    walletId: 'wal_abc123def456ghi789jkl',
    asset: 'BTC' as const,
    balance: 150000000, // 1.5 BTC in satoshis
    decimals: 8,
    lastUpdated: new Date(),
  };

  it('should accept valid balance with all fields', () => {
    expect(() => walletBalanceSchema.parse(validBalance)).not.toThrow();
  });

  it('should accept balance with different decimals', () => {
    const usdBalance = {
      ...validBalance,
      asset: 'USD' as const,
      balance: 5000000,
      decimals: 2,
    };
    expect(() => walletBalanceSchema.parse(usdBalance)).not.toThrow();
  });

  it('should accept zero balance', () => {
    const zeroBalance = {
      ...validBalance,
      balance: 0,
    };
    expect(() => walletBalanceSchema.parse(zeroBalance)).not.toThrow();
  });

  it('should accept USD balance with 2 decimals', () => {
    const usdBalance = {
      walletId: 'wal_abc123def456ghi789jkl',
      asset: 'USD' as const,
      balance: 5000000, // $50,000.00 in cents
      decimals: 2,
      lastUpdated: new Date(),
    };
    expect(() => walletBalanceSchema.parse(usdBalance)).not.toThrow();
  });

  it('should reject non-integer balance', () => {
    expect(() =>
      walletBalanceSchema.parse({ ...validBalance, balance: 100.5 })
    ).toThrow();
  });

  it('should reject missing asset', () => {
    const { asset, ...balanceWithoutAsset } = validBalance;
    expect(() => walletBalanceSchema.parse(balanceWithoutAsset)).toThrow();
  });
});

describe('User Wallet Mapping Schema', () => {
  const validMapping = {
    userId: 'user_123',
    walletIds: ['wal_abc123def456ghi789jkl', 'wal_xyz789abc123def456ghi'],
    defaultWalletId: 'wal_abc123def456ghi789jkl',
  };

  it('should accept valid mapping', () => {
    expect(() => userWalletMappingSchema.parse(validMapping)).not.toThrow();
  });

  it('should accept mapping with single wallet', () => {
    const singleWallet = {
      userId: 'user_123',
      walletIds: ['wal_abc123def456ghi789jkl'],
      defaultWalletId: 'wal_abc123def456ghi789jkl',
    };
    expect(() => userWalletMappingSchema.parse(singleWallet)).not.toThrow();
  });

  it('should reject mapping without userId', () => {
    const { userId, ...mappingWithoutUser } = validMapping;
    expect(() => userWalletMappingSchema.parse(mappingWithoutUser)).toThrow();
  });

  it('should reject mapping without walletIds', () => {
    const { walletIds, ...mappingWithoutWallets } = validMapping;
    expect(() => userWalletMappingSchema.parse(mappingWithoutWallets)).toThrow();
  });
});

describe('Insert Transfer Schema', () => {
  const validTransfer = {
    fromAddress: 'kx1sender0address1234567890abc',
    toAddress: 'kx1receiver0address1234567890ab',
    amount: 0.5,
  };

  it('should accept valid transfer with addresses', () => {
    expect(() => insertTransferSchema.parse(validTransfer)).not.toThrow();
  });

  it('should accept transfer with legacy userId fields', () => {
    expect(() =>
      insertTransferSchema.parse({
        ...validTransfer,
        fromUserId: 'seed.user.primary@krystaline.io',
        toUserId: 'seed.user.secondary@krystaline.io'
      })
    ).not.toThrow();
  });

  it('should reject transfer with invalid fromAddress', () => {
    expect(() =>
      insertTransferSchema.parse({ ...validTransfer, fromAddress: 'invalid' })
    ).toThrow();
  });

  it('should reject transfer with invalid toAddress', () => {
    expect(() =>
      insertTransferSchema.parse({ ...validTransfer, toAddress: 'invalid' })
    ).toThrow();
  });

  it('should reject transfer with zero amount', () => {
    expect(() => insertTransferSchema.parse({ ...validTransfer, amount: 0 })).toThrow();
  });

  it('should reject transfer with negative amount', () => {
    expect(() => insertTransferSchema.parse({ ...validTransfer, amount: -1 })).toThrow();
  });
});

describe('Full Transfer Schema', () => {
  const validFullTransfer = {
    transferId: 'txn_abc123',
    fromAddress: 'kx1sender0address1234567890abc',
    toAddress: 'kx1receiver0address1234567890ab',
    amount: 0.5,
    status: 'COMPLETED' as const,
    traceId: 'trace123',
    spanId: 'span456',
    createdAt: new Date(),
  };

  it('should accept valid full transfer', () => {
    expect(() => transferSchema.parse(validFullTransfer)).not.toThrow();
  });

  it('should accept transfer with legacy userId fields', () => {
    expect(() =>
      transferSchema.parse({
        ...validFullTransfer,
        fromUserId: 'seed.user.primary@krystaline.io',
        toUserId: 'seed.user.secondary@krystaline.io'
      })
    ).not.toThrow();
  });

  it('should accept pending transfer', () => {
    expect(() =>
      transferSchema.parse({ ...validFullTransfer, status: 'PENDING' as const })
    ).not.toThrow();
  });

  it('should accept failed transfer', () => {
    expect(() =>
      transferSchema.parse({ ...validFullTransfer, status: 'FAILED' as const })
    ).not.toThrow();
  });

  it('should require transferId', () => {
    const { transferId, ...transferWithoutId } = validFullTransfer;
    expect(() => transferSchema.parse(transferWithoutId)).toThrow();
  });

  it('should require traceId', () => {
    const { traceId, ...transferWithoutTrace } = validFullTransfer;
    expect(() => transferSchema.parse(transferWithoutTrace)).toThrow();
  });
});
