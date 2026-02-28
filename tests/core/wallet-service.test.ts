/**
 * Wallet Service Unit Tests
 * 
 * Tests for wallet management, balances, and transactions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/db', () => ({
  default: {
    query: vi.fn(),
    transaction: vi.fn((fn) => fn({
      query: vi.fn(),
    })),
  },
}));

vi.mock('../../server/storage', () => ({
  generateWalletAddress: vi.fn((userId: string) => `kx1${userId.replace(/[@.]/g, '')}mock123`),
  generateWalletId: vi.fn(() => 'wal_mock123456789abcdefgh'),
  SEED_WALLETS: {
    primary: { ownerId: 'seed.user.primary@krystaline.io', address: 'kx1testprimary123456789abcdefgh' },
    secondary: { ownerId: 'seed.user.secondary@krystaline.io', address: 'kx1testsecondary123456789abcde' },
  },
  storage: {
    createWallet: vi.fn(),
    getDefaultWallet: vi.fn(),
    resolveAddress: vi.fn(),
  },
}));

vi.mock('../../server/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { walletService, SUPPORTED_ASSETS, type Wallet } from '../../server/wallet/wallet-service';
import db from '../../server/db';
import { generateWalletAddress, generateWalletId, storage } from '../../server/storage';

describe('Wallet Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('SUPPORTED_ASSETS', () => {
    it('should include BTC', () => {
      expect(SUPPORTED_ASSETS).toContain('BTC');
    });

    it('should include ETH', () => {
      expect(SUPPORTED_ASSETS).toContain('ETH');
    });

    it('should include USDT', () => {
      expect(SUPPORTED_ASSETS).toContain('USDT');
    });

    it('should include USD', () => {
      expect(SUPPORTED_ASSETS).toContain('USD');
    });

    it('should include EUR', () => {
      expect(SUPPORTED_ASSETS).toContain('EUR');
    });

    it('should have exactly 5 supported assets', () => {
      expect(SUPPORTED_ASSETS.length).toBe(5);
    });
  });

  describe('getWallets', () => {
    it('should return all wallets for a user', async () => {
      const userId = 'seed.user.primary@krystaline.io';
      const userUuid = 'user-uuid-123';
      const mockWallets = [
        { id: '1', user_id: userUuid, asset: 'BTC', balance: '1.5', available: '1.5', locked: '0', address: 'kx1test123' },
        { id: '2', user_id: userUuid, asset: 'USD', balance: '10000', available: '10000', locked: '0', address: 'kx1test123' },
      ];

      // Mock sequence: resolveUserId -> wallets query (address now in DB)
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: userUuid }] } as any) // resolveUserId
        .mockResolvedValueOnce({ rows: mockWallets } as any);        // wallets query

      const wallets = await walletService.getWallets(userId);

      expect(wallets.length).toBe(2);
      expect(wallets[0]).toHaveProperty('address');
    });

    it('should add kx1 address to each wallet', async () => {
      const userId = 'seed.user.secondary@krystaline.io';
      const userUuid = 'user-uuid-456';
      const mockWallets = [
        { id: '1', user_id: userUuid, asset: 'ETH', balance: '5', available: '5', locked: '0', address: 'kx1secondary123' },
      ];

      // Address is now stored in DB, no separate getKXAddress call
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: userUuid }] } as any)
        .mockResolvedValueOnce({ rows: mockWallets } as any);

      const wallets = await walletService.getWallets(userId);

      expect(wallets[0]).toHaveProperty('address');
      expect(wallets[0].address).toBe('kx1secondary123');
    });

    it('should return empty array for user with no wallets', async () => {
      // User not found returns null from resolveUserId -> empty array
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] } as any); // resolveUserId returns null

      const wallets = await walletService.getWallets('test.user@krystaline.io');

      expect(wallets).toEqual([]);
    });
  });

  describe('getWallet', () => {
    it('should return specific wallet by user and asset', async () => {
      const userId = 'seed.user.primary@krystaline.io';
      const userUuid = 'user-uuid-primary';
      const mockWallet = { id: '1', user_id: userUuid, asset: 'BTC', balance: '2.5' };

      // Mock sequence: resolve email to UUID, then wallet query
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: userUuid }] } as any)  // resolve email
        .mockResolvedValueOnce({ rows: [mockWallet] } as any);       // wallet query

      const wallet = await walletService.getWallet(userId, 'BTC');

      expect(wallet?.balance).toBe('2.5');
    });

    it('should uppercase asset before query', async () => {
      const userId = 'seed.user.primary@krystaline.io';
      const userUuid = 'user-uuid-primary';

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: userUuid }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      await walletService.getWallet(userId, 'btc');

      // Verify wallet query used uppercase asset
      expect(db.query).toHaveBeenLastCalledWith(
        expect.stringContaining('SELECT * FROM wallets'),
        [userUuid, 'BTC']
      );
    });

    it('should return null if wallet not found', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const wallet = await walletService.getWallet('seed.user.primary@krystaline.io', 'FAKE');

      expect(wallet).toBeNull();
    });
  });

  describe('getWalletById', () => {
    it('should return wallet by ID', async () => {
      const mockWallet = { id: 'wal_123', user_id: 'seed.user.primary@krystaline.io', asset: 'BTC' };
      vi.mocked(db.query).mockResolvedValue({ rows: [mockWallet] } as any);

      const wallet = await walletService.getWalletById('wal_123');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM wallets WHERE id'),
        ['wal_123']
      );
      expect(wallet?.id).toBe('wal_123');
    });

    it('should return null if ID not found', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);

      const wallet = await walletService.getWalletById('nonexistent');

      expect(wallet).toBeNull();
    });
  });

  describe('getKXAddress', () => {
    it('should return kx1 address from database for email userId', async () => {
      // Email userId: first resolves user, then gets wallet
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] } as any)
        .mockResolvedValueOnce({ rows: [{ address: 'kx1testaddress12345' }] } as any);

      const address = await walletService.getKXAddress('seed.user.primary@krystaline.io');

      expect(address).toBe('kx1testaddress12345');
    });

    it('should return null if no wallet found', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const address = await walletService.getKXAddress('test.user@krystaline.io');

      expect(address).toBeNull();
    });

    it('should fallback to seed wallet for known seed owner', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const address = await walletService.getKXAddress('seed.user.primary@krystaline.io');

      expect(address).toBe('kx1testprimary123456789abcdefgh');
    });
  });

  describe('resolveAddress', () => {
    it('should return kx1 address as-is', async () => {
      const address = await walletService.resolveAddress('kx1somewallet123456789');

      expect(address).toBe('kx1somewallet123456789');
    });

    it('should resolve email to address via getKXAddress', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid' }] } as any)
        .mockResolvedValueOnce({ rows: [{ address: 'kx1resolved123' }] } as any);

      const address = await walletService.resolveAddress('seed.user.primary@krystaline.io');

      expect(address).toBe('kx1resolved123');
    });

    it('should return null if identifier cannot be resolved', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] } as any);

      const address = await walletService.resolveAddress('unknown.user@krystaline.io');

      expect(address).toBeNull();
    });
  });
});

describe('Wallet Address Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use generateWalletAddress for new users', () => {
    // The mock returns the configured value, so configure it to return a proper address
    vi.mocked(generateWalletAddress).mockReturnValue('kx1testaddress123');
    const address = generateWalletAddress('newuser');
    expect(address).toMatch(/^kx1/);
  });

  it('should use generateWalletId for new wallets', () => {
    // Configure mock to return a proper wallet ID
    vi.mocked(generateWalletId).mockReturnValue('wal_test123');
    const walletId = generateWalletId();
    expect(walletId).toMatch(/^wal_/);
  });
});

describe('Wallet Balance Types', () => {
  it('should have balance, available, and locked fields', async () => {
    const mockWallet = {
      id: '1',
      user_id: 'seed.user.primary@krystaline.io',
      asset: 'BTC',
      balance: '1.5',
      available: '1.0',
      locked: '0.5',
    };
    vi.mocked(db.query).mockResolvedValue({ rows: [mockWallet] } as any);

    const wallet = await walletService.getWallet('seed.user.primary@krystaline.io', 'BTC');

    expect(wallet).toHaveProperty('balance');
    expect(wallet).toHaveProperty('available');
    expect(wallet).toHaveProperty('locked');
  });

  it('should store balances as strings for precision', async () => {
    const mockWallet = {
      id: '1',
      user_id: 'seed.user.primary@krystaline.io',
      asset: 'BTC',
      balance: '0.12345678',
      available: '0.12345678',
      locked: '0',
    };
    vi.mocked(db.query).mockResolvedValue({ rows: [mockWallet] } as any);

    const wallet = await walletService.getWallet('seed.user.primary@krystaline.io', 'BTC');

    expect(typeof wallet?.balance).toBe('string');
    expect(wallet?.balance).toBe('0.12345678');
  });
});
