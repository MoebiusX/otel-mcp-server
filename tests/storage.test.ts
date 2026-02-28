/**
 * Wallet Address Generation Tests
 * Tests for kx1 address generation and storage operations
 */
import {
  generateWalletAddress,
  generateWalletId,
  SEED_WALLETS,
} from '../server/storage';

describe('generateWalletAddress', () => {
  it('should generate address with kx1 prefix', () => {
    const address = generateWalletAddress('test-seed');
    expect(address.startsWith('kx1')).toBe(true);
  });

  it('should generate address with correct length (35 chars total)', () => {
    const address = generateWalletAddress('test-seed');
    // kx1 (3 chars) + 32 chars = 35 chars
    expect(address.length).toBe(35);
  });

  it('should generate deterministic addresses from same seed', () => {
    const address1 = generateWalletAddress('same-seed');
    const address2 = generateWalletAddress('same-seed');
    expect(address1).toBe(address2);
  });

  it('should generate different addresses from different seeds', () => {
    const address1 = generateWalletAddress('seed-one');
    const address2 = generateWalletAddress('seed-two');
    expect(address1).not.toBe(address2);
  });

  it('should generate lowercase alphanumeric characters only', () => {
    const address = generateWalletAddress('test-seed');
    const body = address.slice(3); // Remove 'kx1' prefix
    expect(body).toMatch(/^[a-z0-9]+$/);
  });

  it('should handle empty string seed', () => {
    const address = generateWalletAddress('');
    expect(address.startsWith('kx1')).toBe(true);
    expect(address.length).toBe(35);
  });

  it('should handle special characters in seed', () => {
    const address = generateWalletAddress('user@example.com!#$%');
    expect(address.startsWith('kx1')).toBe(true);
    expect(address.length).toBe(35);
  });

  it('should handle unicode characters in seed', () => {
    const address = generateWalletAddress('用户名@例子.com');
    expect(address.startsWith('kx1')).toBe(true);
    expect(address.length).toBe(35);
  });

  it('should handle very long seed', () => {
    const longSeed = 'a'.repeat(10000);
    const address = generateWalletAddress(longSeed);
    expect(address.startsWith('kx1')).toBe(true);
    expect(address.length).toBe(35);
  });
});

describe('generateWalletId', () => {
  it('should generate ID with wal_ prefix', () => {
    const id = generateWalletId();
    expect(id.startsWith('wal_')).toBe(true);
  });

  it('should generate ID with correct length (wal_ + 21 chars)', () => {
    const id = generateWalletId();
    expect(id.length).toBe(25); // wal_ (4 chars) + 21 chars
  });

  it('should generate unique IDs on each call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateWalletId());
    }
    expect(ids.size).toBe(1000);
  });

  it('should generate URL-safe characters', () => {
    const id = generateWalletId();
    // nanoid default alphabet is URL-safe
    expect(id).toMatch(/^wal_[A-Za-z0-9_-]+$/);
  });
});

describe('SEED_WALLETS', () => {
  it('should have primary wallet with kx1 address', () => {
    expect(SEED_WALLETS.primary.address.startsWith('kx1')).toBe(true);
  });

  it('should have secondary wallet with kx1 address', () => {
    expect(SEED_WALLETS.secondary.address.startsWith('kx1')).toBe(true);
  });

  it('should generate different addresses for primary and secondary', () => {
    expect(SEED_WALLETS.primary.address).not.toBe(SEED_WALLETS.secondary.address);
  });

  it('should have consistent address for primary', () => {
    // Address should be deterministic based on seed identifier
    const expectedAddress = generateWalletAddress('seed_user_primary_001');
    expect(SEED_WALLETS.primary.address).toBe(expectedAddress);
  });

  it('should have consistent address for secondary', () => {
    const expectedAddress = generateWalletAddress('seed_user_primary_002');
    expect(SEED_WALLETS.secondary.address).toBe(expectedAddress);
  });

  it('should have valid wallet IDs', () => {
    expect(SEED_WALLETS.primary.walletId.startsWith('wal_')).toBe(true);
    expect(SEED_WALLETS.secondary.walletId.startsWith('wal_')).toBe(true);
  });

  it('should have different wallet IDs for primary and secondary', () => {
    expect(SEED_WALLETS.primary.walletId).not.toBe(SEED_WALLETS.secondary.walletId);
  });

  it('should have owner IDs as krystaline.io emails', () => {
    expect(SEED_WALLETS.primary.ownerId).toBe('seed.user.primary@krystaline.io');
    expect(SEED_WALLETS.secondary.ownerId).toBe('seed.user.secondary@krystaline.io');
  });
});

describe('Address Format Validation', () => {
  it('should generate addresses that match kx1 regex pattern', () => {
    const address = generateWalletAddress('test');
    const regex = /^kx1[a-z0-9]{20,40}$/;
    expect(regex.test(address)).toBe(true);
  });

  it('should generate addresses with consistent entropy', () => {
    // Generate many addresses and check uniqueness
    const addresses = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      addresses.add(generateWalletAddress(`seed-${i}`));
    }
    // All addresses should be unique
    expect(addresses.size).toBe(1000);
  });

  it('should produce different addresses for similar seeds', () => {
    const addr1 = generateWalletAddress('user1');
    const addr2 = generateWalletAddress('user2');
    const addr3 = generateWalletAddress('user11');

    expect(addr1).not.toBe(addr2);
    expect(addr1).not.toBe(addr3);
    expect(addr2).not.toBe(addr3);
  });
});
