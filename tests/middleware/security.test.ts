/**
 * Security Middleware Tests
 * 
 * Tests for rate limiting, CORS, and security headers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Mock dependencies
vi.mock('../../server/config', () => ({
  config: {
    env: 'development',
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

import { corsMiddleware, requestTimeout } from '../../server/middleware/security';

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/test',
    headers: {},
    ip: '127.0.0.1',
    body: {},
    ...overrides,
  } as Request;
}

// Helper to create mock response
function createMockResponse(): Response & { 
  _headers: Record<string, string>; 
  _status: number;
  _sent: boolean;
} {
  const res = {
    _headers: {} as Record<string, string>,
    _status: 200,
    _sent: false,
    headersSent: false,
    header: vi.fn().mockImplementation(function(name: string, value: string) {
      res._headers[name] = value;
      return res;
    }),
    status: vi.fn().mockImplementation(function(code: number) {
      res._status = code;
      return res;
    }),
    json: vi.fn().mockImplementation(function(data: any) {
      res._sent = true;
      return res;
    }),
    sendStatus: vi.fn().mockImplementation(function(code: number) {
      res._status = code;
      res._sent = true;
      return res;
    }),
    setTimeout: vi.fn(),
  } as unknown as Response & { 
    _headers: Record<string, string>; 
    _status: number;
    _sent: boolean;
  };
  return res;
}

describe('Security Middleware', () => {
  let mockReq: Request;
  let mockRes: ReturnType<typeof createMockResponse>;
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

  describe('corsMiddleware', () => {
    it('should set CORS headers for allowed localhost origin', () => {
      mockReq = createMockRequest({
        headers: { origin: 'http://localhost:5173' },
      });

      corsMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://localhost:5173'
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should set CORS headers for allowed 127.0.0.1 origin', () => {
      mockReq = createMockRequest({
        headers: { origin: 'http://127.0.0.1:5000' },
      });

      corsMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://127.0.0.1:5000'
      );
    });

    it('should set standard CORS headers', () => {
      mockReq = createMockRequest({
        headers: { origin: 'http://localhost:5173' },
      });

      corsMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        expect.stringContaining('GET')
      );
      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        expect.stringContaining('Authorization')
      );
      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true'
      );
    });

    it('should handle OPTIONS preflight request', () => {
      mockReq = createMockRequest({
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      });

      corsMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.sendStatus).toHaveBeenCalledWith(200);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next for non-OPTIONS requests', () => {
      mockReq = createMockRequest({
        method: 'POST',
        headers: { origin: 'http://localhost:5173' },
      });

      corsMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should include traceparent in allowed headers', () => {
      mockReq = createMockRequest({
        headers: { origin: 'http://localhost:5173' },
      });

      corsMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        expect.stringContaining('traceparent')
      );
    });

    it('should set max-age header for preflight caching', () => {
      mockReq = createMockRequest({
        headers: { origin: 'http://localhost:5173' },
      });

      corsMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.header).toHaveBeenCalledWith(
        'Access-Control-Max-Age',
        '86400'
      );
    });
  });

  describe('requestTimeout', () => {
    it('should set timeout on response', () => {
      const middleware = requestTimeout(5000);

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use default timeout when not specified', () => {
      const middleware = requestTimeout();

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function));
    });

    it('should return 408 on timeout', () => {
      const middleware = requestTimeout(1000);
      
      middleware(mockReq, mockRes, mockNext);

      // Get the timeout callback and invoke it
      const timeoutCallback = (mockRes.setTimeout as any).mock.calls[0][1];
      timeoutCallback();

      expect(mockRes._status).toBe(408);
    });

    it('should not send response if headers already sent', () => {
      const middleware = requestTimeout(1000);
      mockRes.headersSent = true;
      
      middleware(mockReq, mockRes, mockNext);

      // Get the timeout callback and invoke it
      const timeoutCallback = (mockRes.setTimeout as any).mock.calls[0][1];
      timeoutCallback();

      // json should not be called since headers are sent
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });
});
