/**
 * Auth Routes Integration Tests
 * 
 * Tests for /api/auth/* endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies
vi.mock('../../server/db', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('../../server/auth/auth-service', () => ({
  authService: {
    register: vi.fn(),
    verifyEmail: vi.fn(),
    login: vi.fn(),
    verifyToken: vi.fn(),
    getUserById: vi.fn(),
    resendVerificationCode: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
  },
  registerSchema: {
    parse: vi.fn((data) => {
      if (!data.email || !data.password) throw new Error('Validation failed');
      return data;
    }),
  },
  loginSchema: {
    parse: vi.fn((data) => {
      if (!data.email || !data.password) throw new Error('Validation failed');
      return data;
    }),
  },
  verifySchema: {
    parse: vi.fn((data) => {
      if (!data.email || !data.code) throw new Error('Validation failed');
      return data;
    }),
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

import authRoutes from '../../server/auth/routes';
import { authService } from '../../server/auth/auth-service';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  return app;
}

describe('Auth Routes Integration', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      vi.mocked(authService.register).mockResolvedValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          status: 'pending',
        },
        message: 'Verification code sent',
      } as any);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'securePassword123',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('test@example.com');
    });

    it('should return 400 for missing email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ password: 'test123' });

      expect(response.status).toBe(400);
    });

    it('should return 400 for duplicate email', async () => {
      vi.mocked(authService.register).mockRejectedValue(
        new Error('Email already registered')
      );

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email already registered');
    });
  });

  describe('POST /api/auth/verify', () => {
    it('should verify email with valid code', async () => {
      vi.mocked(authService.verifyEmail).mockResolvedValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          status: 'verified',
        },
        tokens: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-123',
        },
      } as any);

      const response = await request(app)
        .post('/api/v1/auth/verify')
        .send({
          email: 'test@example.com',
          code: '123456',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.tokens).toBeDefined();
    });

    it('should return 400 for invalid code', async () => {
      vi.mocked(authService.verifyEmail).mockRejectedValue(
        new Error('Invalid verification code')
      );

      const response = await request(app)
        .post('/api/v1/auth/verify')
        .send({
          email: 'test@example.com',
          code: '000000',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid verification code');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      vi.mocked(authService.login).mockResolvedValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          status: 'verified',
          kyc_level: 1,
        },
        tokens: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-123',
        },
      } as any);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body.tokens.accessToken).toBeDefined();
    });

    it('should return 401 for invalid credentials', async () => {
      vi.mocked(authService.login).mockRejectedValue(
        new Error('Invalid email or password')
      );

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid email or password');
    });

    it('should return 401 for unverified account', async () => {
      vi.mocked(authService.login).mockRejectedValue(
        new Error('Please verify your email first')
      );

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'unverified@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/resend-code', () => {
    it('should resend verification code', async () => {
      vi.mocked(authService.resendVerificationCode).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/v1/auth/resend-code')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Verification code sent');
    });

    it('should return 400 for missing email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/resend-code')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email required');
    });

    it('should return 400 for non-existent email', async () => {
      vi.mocked(authService.resendVerificationCode).mockRejectedValue(
        new Error('User not found')
      );

      const response = await request(app)
        .post('/api/v1/auth/resend-code')
        .send({ email: 'nonexistent@example.com' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh access token', async () => {
      vi.mocked(authService.refreshToken).mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-refresh-token' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.tokens.accessToken).toBe('new-access-token');
    });

    it('should return 400 for missing refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Refresh token required');
    });

    it('should return 401 for invalid refresh token', async () => {
      vi.mocked(authService.refreshToken).mockRejectedValue(
        new Error('Invalid refresh token')
      );

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(response.status).toBe(401);
    });
  });

  describe('Protected routes (require authentication)', () => {
    describe('POST /api/auth/logout', () => {
      it('should return 401 without token', async () => {
        const response = await request(app)
          .post('/api/v1/auth/logout');

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('No token provided');
      });

      it('should return 401 with invalid token', async () => {
        vi.mocked(authService.verifyToken).mockReturnValue(null);

        const response = await request(app)
          .post('/api/v1/auth/logout')
          .set('Authorization', 'Bearer invalid-token');

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid or expired token');
      });

      it('should logout with valid token', async () => {
        vi.mocked(authService.verifyToken).mockReturnValue({ userId: 'user-123' } as any);
        vi.mocked(authService.getUserById).mockResolvedValue({
          id: 'user-123',
          email: 'test@example.com',
          status: 'verified',
        } as any);
        vi.mocked(authService.logout).mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/v1/auth/logout')
          .set('Authorization', 'Bearer valid-token');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    describe('GET /api/auth/me', () => {
      it('should return current user info', async () => {
        vi.mocked(authService.verifyToken).mockReturnValue({ userId: 'user-123' } as any);
        vi.mocked(authService.getUserById).mockResolvedValue({
          id: 'user-123',
          email: 'test@example.com',
          phone: '+1234567890',
          status: 'verified',
          kyc_level: 2,
          created_at: new Date('2024-01-01'),
        } as any);

        const response = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', 'Bearer valid-token');

        expect(response.status).toBe(200);
        expect(response.body.user.id).toBe('user-123');
        expect(response.body.user.email).toBe('test@example.com');
        expect(response.body.user.kyc_level).toBe(2);
      });

      it('should return 401 for user not found', async () => {
        vi.mocked(authService.verifyToken).mockReturnValue({ userId: 'deleted-user' } as any);
        vi.mocked(authService.getUserById).mockResolvedValue(null);

        const response = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', 'Bearer valid-token');

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('User not found');
      });
    });
  });
});
