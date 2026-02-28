/**
 * Auth Service Unit Tests
 * 
 * Tests for authentication service functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../server/db', () => ({
  default: {
    query: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../../server/auth/email-service', () => ({
  default: {
    sendVerificationCode: vi.fn(),
    sendWelcome: vi.fn(),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed_password'),
    compare: vi.fn(),
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mock_jwt_token'),
    verify: vi.fn(),
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

import { authService, registerSchema, loginSchema, verifySchema } from '../../server/auth/auth-service';
import db from '../../server/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import emailService from '../../server/auth/email-service';

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Schema Validation', () => {
    describe('registerSchema', () => {
      it('should accept valid registration data', () => {
        const data = {
          email: 'test@example.com',
          password: 'Password123',
        };

        const result = registerSchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('should accept registration with phone', () => {
        const data = {
          email: 'test@example.com',
          password: 'Password123',
          phone: '+1234567890',
        };

        const result = registerSchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('should reject invalid email', () => {
        const data = {
          email: 'not-an-email',
          password: 'Password123',
        };

        const result = registerSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it('should reject password under 8 characters', () => {
        const data = {
          email: 'test@example.com',
          password: 'Pass1',
        };

        const result = registerSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it('should reject password without uppercase', () => {
        const data = {
          email: 'test@example.com',
          password: 'password123',
        };

        const result = registerSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it('should reject password without number', () => {
        const data = {
          email: 'test@example.com',
          password: 'PasswordABC',
        };

        const result = registerSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });

    describe('loginSchema', () => {
      it('should accept valid login data', () => {
        const data = {
          email: 'test@example.com',
          password: 'anypassword',
        };

        const result = loginSchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('should reject invalid email', () => {
        const data = {
          email: 'invalid',
          password: 'anypassword',
        };

        const result = loginSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });

    describe('verifySchema', () => {
      it('should accept valid verification data', () => {
        const data = {
          email: 'test@example.com',
          code: '123456',
        };

        const result = verifySchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('should reject code not exactly 6 digits', () => {
        const data = {
          email: 'test@example.com',
          code: '12345',
        };

        const result = verifySchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('register', () => {
    it('should register new user successfully', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] }) // Check existing
        .mockResolvedValueOnce({
          rows: [{
            id: 'user-123',
            email: 'test@example.com',
            phone: null,
            status: 'pending',
            kyc_level: 0,
            created_at: new Date(),
          }]
        }) // Create user
        .mockResolvedValueOnce({ rows: [] }); // Insert verification code

      vi.mocked(emailService.sendVerificationCode).mockResolvedValue(undefined);

      const result = await authService.register({
        email: 'test@example.com',
        password: 'Password123',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.message).toContain('Verification code sent');
      expect(emailService.sendVerificationCode).toHaveBeenCalledWith('test@example.com', expect.any(String));
    });

    it('should throw error if email already exists', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{ id: 'existing-user' }]
      });

      await expect(
        authService.register({
          email: 'existing@example.com',
          password: 'Password123',
        })
      ).rejects.toThrow('Email already registered');
    });

    it('should hash password before storing', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'user-123',
            email: 'test@example.com',
            status: 'pending',
          }]
        })
        .mockResolvedValueOnce({ rows: [] });

      vi.mocked(emailService.sendVerificationCode).mockResolvedValue(undefined);

      await authService.register({
        email: 'test@example.com',
        password: 'Password123',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('Password123', 12);
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with valid code', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{
            id: 'user-123',
            email: 'test@example.com',
            status: 'pending',
          }]
        }) // Find user
        .mockResolvedValueOnce({
          rows: [{ id: 'code-123', code: '123456' }]
        }); // Find code

      vi.mocked(db.transaction).mockImplementation(async (callback: any) => {
        const client = { query: vi.fn() };
        return callback(client);
      });

      vi.mocked(emailService.sendWelcome).mockResolvedValue(undefined);

      // Mock wallet service import
      vi.doMock('../../server/wallet/wallet-service', () => ({
        walletService: {
          createDefaultWallets: vi.fn().mockResolvedValue(undefined),
        },
      }));

      // Need to mock generateTokens behavior - session insert returns id
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ id: 'session-123' }] }); // Session insert

      const result = await authService.verifyEmail({
        email: 'test@example.com',
        code: '123456',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens).toBeDefined();
    });

    it('should throw error if user not found', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        authService.verifyEmail({
          email: 'nonexistent@example.com',
          code: '123456',
        })
      ).rejects.toThrow('User not found');
    });

    it('should throw error if code is invalid', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'user-123', email: 'test@example.com' }]
        })
        .mockResolvedValueOnce({ rows: [] }); // No matching code

      await expect(
        authService.verifyEmail({
          email: 'test@example.com',
          code: '000000',
        })
      ).rejects.toThrow('Invalid or expired code');
    });
  });

  describe('login', () => {
    it('should login verified user with correct password', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{
            id: 'user-123',
            email: 'test@example.com',
            password_hash: 'hashed_password',
            status: 'verified',
          }]
        })
        .mockResolvedValueOnce({ rows: [] }) // Update last login
        .mockResolvedValueOnce({ rows: [{ id: 'session-123' }] }); // Insert session returns id

      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const result = await authService.login({
        email: 'test@example.com',
        password: 'Password123',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens).toBeDefined();
    });

    it('should throw error for non-existent user', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        authService.login({
          email: 'nonexistent@example.com',
          password: 'Password123',
        })
      ).rejects.toThrow('Invalid email or password');
    });

    it('should throw error for unverified user', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{
          id: 'user-123',
          email: 'test@example.com',
          status: 'pending',
        }]
      });

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'Password123',
        })
      ).rejects.toThrow('Please verify your email first');
    });

    it('should throw error for suspended user', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{
          id: 'user-123',
          email: 'test@example.com',
          status: 'suspended',
        }]
      });

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'Password123',
        })
      ).rejects.toThrow('Account suspended');
    });

    it('should throw error for incorrect password', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({
        rows: [{
          id: 'user-123',
          email: 'test@example.com',
          password_hash: 'hashed_password',
          status: 'verified',
        }]
      });

      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'WrongPassword',
        })
      ).rejects.toThrow('Invalid email or password');
    });
  });

  describe('verifyToken', () => {
    it('should return userId for valid token', () => {
      vi.mocked(jwt.verify).mockReturnValue({ userId: 'user-123' } as any);

      const result = authService.verifyToken('valid_token');

      expect(result).toEqual({ userId: 'user-123' });
    });

    it('should return null for invalid token', () => {
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const result = authService.verifyToken('invalid_token');

      expect(result).toBeNull();
    });

    it('should return null for expired token', () => {
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      const result = authService.verifyToken('expired_token');

      expect(result).toBeNull();
    });
  });

  describe('refreshToken', () => {
    it('should call generateTokens for valid refresh token', async () => {
      vi.mocked(jwt.verify).mockReturnValue({
        userId: 'user-123',
        type: 'refresh'
      } as any);

      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ refresh_token_hash: 'hashed_refresh' }]
        })
        .mockResolvedValueOnce({ rows: [{ id: 'session-123' }] }); // Insert new session returns id

      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      vi.mocked(bcrypt.hash).mockResolvedValue('new_hashed_token' as never);

      const result = await authService.refreshToken('valid_refresh_token');

      // The result should have token properties (mocked jwt.sign returns 'mock_jwt_token')
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresIn');
    });

    it('should throw error for non-refresh token', async () => {
      vi.mocked(jwt.verify).mockReturnValue({
        userId: 'user-123',
        type: 'access'
      } as any);

      await expect(
        authService.refreshToken('access_token')
      ).rejects.toThrow('Invalid token type');
    });

    it('should throw error for expired session', async () => {
      vi.mocked(jwt.verify).mockReturnValue({
        userId: 'user-123',
        type: 'refresh'
      } as any);

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] }); // No sessions
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        authService.refreshToken('old_refresh_token')
      ).rejects.toThrow('Session expired or invalid');
    });
  });

  describe('logout', () => {
    it('should delete user sessions', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await authService.logout('user-123');

      expect(db.query).toHaveBeenCalledWith(
        'DELETE FROM sessions WHERE user_id = $1',
        ['user-123']
      );
    });
  });

  describe('getUserById', () => {
    it('should return user if found', async () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        phone: null,
        status: 'verified',
        kyc_level: 1,
        created_at: new Date(),
      };

      vi.mocked(db.query).mockResolvedValueOnce({ rows: [user] });

      const result = await authService.getUserById('user-123');

      expect(result).toEqual(user);
    });

    it('should return null if user not found', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      const result = await authService.getUserById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('resendVerificationCode', () => {
    it('should resend code for pending user', async () => {
      vi.mocked(db.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'user-123', email: 'test@example.com', status: 'pending' }]
        })
        .mockResolvedValueOnce({ rows: [] }); // Insert new code

      vi.mocked(emailService.sendVerificationCode).mockResolvedValue(undefined);

      await authService.resendVerificationCode('test@example.com');

      expect(emailService.sendVerificationCode).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String)
      );
    });

    it('should throw error if user not found or already verified', async () => {
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

      await expect(
        authService.resendVerificationCode('verified@example.com')
      ).rejects.toThrow('User not found or already verified');
    });
  });
});
