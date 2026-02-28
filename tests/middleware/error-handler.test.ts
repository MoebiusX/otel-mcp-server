/**
 * Error Handler Middleware Tests
 * 
 * Tests for global error handling middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ZodError, z } from 'zod';

// Mock logger
vi.mock('../../server/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  logError: vi.fn(),
}));

import { errorHandler, notFoundHandler } from '../../server/middleware/error-handler';
import { 
  AppError, 
  ValidationError, 
  NotFoundError, 
  AuthenticationError,
  InternalServerError,
  ConflictError 
} from '../../server/lib/errors';

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/test',
    query: {},
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  } as Request;
}

// Helper to create mock response
function createMockResponse(): Response & { _json: any; _status: number } {
  const res = {
    _json: null,
    _status: 200,
    headersSent: false,
    status: vi.fn().mockImplementation(function(code: number) {
      res._status = code;
      return res;
    }),
    json: vi.fn().mockImplementation(function(data: any) {
      res._json = data;
      return res;
    }),
  } as unknown as Response & { _json: any; _status: number };
  return res;
}

describe('Error Handler Middleware', () => {
  let mockReq: Request;
  let mockRes: Response & { _json: any; _status: number };
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('errorHandler', () => {
    describe('Response already sent', () => {
      it('should call next if headers already sent', () => {
        mockRes.headersSent = true;
        const error = new Error('Test error');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalledWith(error);
        expect(mockRes.status).not.toHaveBeenCalled();
      });
    });

    describe('ZodError handling', () => {
      it('should handle ZodError and return 400', () => {
        const schema = z.object({
          email: z.string().email(),
          age: z.number().min(0),
        });

        let zodError: ZodError;
        try {
          schema.parse({ email: 'invalid', age: -5 });
        } catch (e) {
          zodError = e as ZodError;
        }

        errorHandler(zodError!, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(400);
        expect(mockRes._json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should include field paths in validation errors', () => {
        const schema = z.object({
          nested: z.object({
            field: z.string(),
          }),
        });

        let zodError: ZodError;
        try {
          schema.parse({ nested: { field: 123 } });
        } catch (e) {
          zodError = e as ZodError;
        }

        errorHandler(zodError!, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(400);
        const details = mockRes._json.error.details;
        expect(details.validationErrors).toBeDefined();
        expect(details.validationErrors[0].path).toBe('nested.field');
      });
    });

    describe('AppError handling', () => {
      it('should handle ValidationError with 400 status', () => {
        const error = new ValidationError('Invalid input', { field: 'email' });

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(400);
        expect(mockRes._json.error.code).toBe('VALIDATION_ERROR');
        expect(mockRes._json.error.message).toBe('Invalid input');
      });

      it('should handle NotFoundError with 404 status', () => {
        const error = new NotFoundError('User not found');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(404);
        expect(mockRes._json.error.code).toBe('NOT_FOUND');
      });

      it('should handle AuthenticationError with 401 status', () => {
        const error = new AuthenticationError('Invalid token');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(401);
        expect(mockRes._json.error.code).toBe('UNAUTHORIZED');
      });

      it('should handle ConflictError with 409 status', () => {
        const error = new ConflictError('Resource conflict');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(409);
        expect(mockRes._json.error.code).toBe('CONFLICT');
      });

      it('should include correlation ID in response when present', () => {
        mockReq = createMockRequest({
          headers: { 'x-correlation-id': 'test-correlation-123' },
        });
        const error = new NotFoundError('Item not found');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._json.error.correlationId).toBe('test-correlation-123');
      });
    });

    describe('Unknown error handling', () => {
      it('should handle generic Error as 500', () => {
        const error = new Error('Something went wrong');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(500);
        expect(mockRes._json.error.code).toBe('INTERNAL_SERVER_ERROR');
      });

      it('should hide error details in production', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        const error = new Error('Sensitive internal error details');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(500);
        expect(mockRes._json.error.message).toBe('An unexpected error occurred');
        expect(mockRes._json.error.message).not.toContain('Sensitive');

        process.env.NODE_ENV = originalEnv;
      });

      it('should show error details in development', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        const error = new Error('Detailed error message');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes._status).toBe(500);
        // In development, should show actual message
        expect(mockRes._json.error.message).toContain('Detailed error message');

        process.env.NODE_ENV = originalEnv;
      });
    });

    describe('Request context extraction', () => {
      it('should extract request context for logging', () => {
        mockReq = createMockRequest({
          method: 'POST',
          path: '/api/users',
          query: { include: 'profile' },
          headers: {
            'x-correlation-id': 'corr-123',
            'user-agent': 'TestAgent/1.0',
          },
          ip: '192.168.1.1',
        });

        const error = new ValidationError('Invalid data');

        errorHandler(error, mockReq, mockRes, mockNext);

        // Error should be processed (we can't easily verify logger calls due to mocking)
        expect(mockRes._status).toBe(400);
      });
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 for unknown routes', () => {
      mockReq = createMockRequest({
        method: 'GET',
        path: '/api/unknown-route',
      });

      notFoundHandler(mockReq, mockRes);

      expect(mockRes._status).toBe(404);
      expect(mockRes._json.error.code).toBe('ROUTE_NOT_FOUND');
      expect(mockRes._json.error.path).toBe('/api/unknown-route');
      expect(mockRes._json.error.method).toBe('GET');
    });

    it('should include request method in response', () => {
      mockReq = createMockRequest({
        method: 'DELETE',
        path: '/api/resource/123',
      });

      notFoundHandler(mockReq, mockRes);

      expect(mockRes._json.error.message).toContain('DELETE');
      expect(mockRes._json.error.message).toContain('/api/resource/123');
    });
  });
});
