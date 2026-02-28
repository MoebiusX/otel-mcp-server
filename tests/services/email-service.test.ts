/**
 * Email Service Unit Tests
 * 
 * Tests for email sending functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock nodemailer - must be hoisted before any imports
vi.mock('nodemailer', () => {
  const mockSendMail = vi.fn();
  return {
    default: {
      createTransport: vi.fn(() => ({
        sendMail: mockSendMail,
      })),
    },
    __mockSendMail: mockSendMail,
  };
});

// Mock config
vi.mock('../../server/config', () => ({
  config: {
    smtp: {
      host: 'localhost',
      port: 1025,
      secure: false,
    },
  },
}));

// Mock logger
vi.mock('../../server/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import mocked module to access the mock
import * as nodemailerMock from 'nodemailer';
import { emailService } from '../../server/auth/email-service';

// Get the mockSendMail from the transport
const getMockSendMail = () => {
  return (nodemailerMock as any).__mockSendMail;
};

describe('Email Service', () => {
  let mockSendMail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSendMail = getMockSendMail();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('send', () => {
    it('should send email successfully', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-123' });

      const result = await emailService.send({
        to: 'test@example.com',
        subject: 'Test Subject',
        text: 'Test body',
        html: '<p>Test body</p>',
      });

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Subject',
          text: 'Test body',
          html: '<p>Test body</p>',
        })
      );
    });

    it('should return false on send failure', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP error'));

      const result = await emailService.send({
        to: 'test@example.com',
        subject: 'Test Subject',
        text: 'Test body',
      });

      expect(result).toBe(false);
    });

    it('should include from address', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-123' });

      await emailService.send({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Test',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.stringContaining('Krystaline'),
        })
      );
    });
  });

  describe('sendVerificationCode', () => {
    it('should send verification email with code', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'verify-123' });

      const result = await emailService.sendVerificationCode('user@example.com', '123456');

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Verify'),
        })
      );
    });

    it('should include code in email body', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'verify-123' });

      await emailService.sendVerificationCode('user@example.com', '654321');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('654321');
      expect(callArgs.text).toContain('654321');
    });

    it('should mention expiration in email', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'verify-123' });

      await emailService.sendVerificationCode('user@example.com', '123456');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.text).toContain('10 minutes');
    });
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'reset-123' });

      const result = await emailService.sendPasswordReset('user@example.com', '999888');

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Password Reset'),
        })
      );
    });

    it('should include reset code in body', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'reset-123' });

      await emailService.sendPasswordReset('user@example.com', '777666');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('777666');
      expect(callArgs.text).toContain('777666');
    });
  });

  describe('sendWelcome', () => {
    it('should send welcome email', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'welcome-123' });

      const result = await emailService.sendWelcome('newuser@example.com');

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'newuser@example.com',
          subject: expect.stringContaining('Welcome'),
        })
      );
    });

    it('should include test fund information', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'welcome-123' });

      await emailService.sendWelcome('newuser@example.com');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('10,000 USDT');
      expect(callArgs.html).toContain('1 BTC');
      expect(callArgs.html).toContain('10 ETH');
    });

    it('should include portfolio link', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'welcome-123' });

      await emailService.sendWelcome('newuser@example.com');

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('portfolio');
    });
  });
});
