/**
 * Auth Service Tests
 * Tests for authentication, token generation, and user management
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Auth schemas for testing
const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const tokenPayloadSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  iat: z.number(),
  exp: z.number(),
});

describe('Auth Request Validation', () => {
  describe('Login Request', () => {
    it('should accept valid login credentials', () => {
      const request = {
        email: 'seed.user.primary@krystaline.io',
        password: 'password123',
      };
      expect(() => loginRequestSchema.parse(request)).not.toThrow();
    });

    it('should reject invalid email format', () => {
      const request = {
        email: 'not-an-email',
        password: 'password123',
      };
      expect(() => loginRequestSchema.parse(request)).toThrow();
    });

    it('should reject short password', () => {
      const request = {
        email: 'seed.user.primary@krystaline.io',
        password: '12345',
      };
      expect(() => loginRequestSchema.parse(request)).toThrow();
    });

    it('should reject empty email', () => {
      const request = {
        email: '',
        password: 'password123',
      };
      expect(() => loginRequestSchema.parse(request)).toThrow();
    });

    it('should reject empty password', () => {
      const request = {
        email: 'seed.user.primary@krystaline.io',
        password: '',
      };
      expect(() => loginRequestSchema.parse(request)).toThrow();
    });
  });

  describe('Register Request', () => {
    it('should accept valid registration', () => {
      const request = {
        email: 'newuser@example.com',
        password: 'securepassword123',
        confirmPassword: 'securepassword123',
      };
      expect(() => registerRequestSchema.parse(request)).not.toThrow();
    });

    it('should reject mismatched passwords', () => {
      const request = {
        email: 'newuser@example.com',
        password: 'securepassword123',
        confirmPassword: 'differentpassword',
      };
      expect(() => registerRequestSchema.parse(request)).toThrow();
    });

    it('should reject short password', () => {
      const request = {
        email: 'newuser@example.com',
        password: 'short',
        confirmPassword: 'short',
      };
      expect(() => registerRequestSchema.parse(request)).toThrow();
    });

    it('should reject invalid email', () => {
      const request = {
        email: 'invalid-email',
        password: 'securepassword123',
        confirmPassword: 'securepassword123',
      };
      expect(() => registerRequestSchema.parse(request)).toThrow();
    });
  });

  describe('Token Payload', () => {
    it('should validate token payload structure', () => {
      const payload = {
        userId: 'user_123',
        email: 'seed.user.primary@krystaline.io',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      expect(() => tokenPayloadSchema.parse(payload)).not.toThrow();
    });

    it('should validate token with future expiration', () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        userId: 'user_123',
        email: 'seed.user.primary@krystaline.io',
        iat: now,
        exp: now + 86400, // 24 hours
      };
      const result = tokenPayloadSchema.parse(payload);
      expect(result.exp).toBeGreaterThan(result.iat);
    });
  });
});

describe('Password Requirements', () => {
  const passwordSchema = z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number');

  it('should accept strong password', () => {
    expect(() => passwordSchema.parse('SecurePass123')).not.toThrow();
  });

  it('should reject password without uppercase', () => {
    expect(() => passwordSchema.parse('securepass123')).toThrow();
  });

  it('should reject password without lowercase', () => {
    expect(() => passwordSchema.parse('SECUREPASS123')).toThrow();
  });

  it('should reject password without number', () => {
    expect(() => passwordSchema.parse('SecurePassword')).toThrow();
  });

  it('should reject short password', () => {
    expect(() => passwordSchema.parse('Pass1')).toThrow();
  });
});

describe('Email Validation', () => {
  const emailSchema = z.string().email();

  const validEmails = [
    'user@example.com',
    'user.name@example.com',
    'user+tag@example.com',
    'user@subdomain.example.com',
    'user@example.co.uk',
  ];

  const invalidEmails = [
    'not-an-email',
    '@example.com',
    'user@',
    'user@.com',
    'user@example.',
    '',
  ];

  validEmails.forEach((email) => {
    it(`should accept valid email: ${email}`, () => {
      expect(() => emailSchema.parse(email)).not.toThrow();
    });
  });

  invalidEmails.forEach((email) => {
    it(`should reject invalid email: "${email}"`, () => {
      expect(() => emailSchema.parse(email)).toThrow();
    });
  });
});
