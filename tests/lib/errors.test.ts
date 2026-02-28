/**
 * Error Classes Unit Tests
 * 
 * Tests for custom error types and error utilities
 */

import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  TimeoutError,
  InsufficientFundsError,
  OrderError,
  WalletError,
  ExternalServiceError,
  ServiceError,
  isOperationalError,
  createErrorFromStatusCode,
} from '../../server/lib/errors';

describe('AppError', () => {
  it('should create error with correct properties', () => {
    const error = new AppError('Test error', 500, 'TEST_ERROR', true, { foo: 'bar' });

    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('TEST_ERROR');
    expect(error.isOperational).toBe(true);
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.timestamp).toBeInstanceOf(Date);
  });

  it('should have correct prototype chain', () => {
    const error = new AppError('Test', 500, 'TEST');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });

  it('should serialize to JSON correctly', () => {
    const error = new AppError('Test error', 400, 'BAD_REQUEST', true);
    const json = error.toJSON();

    expect(json.error.message).toBe('Test error');
    expect(json.error.code).toBe('BAD_REQUEST');
    expect(json.error.statusCode).toBe(400);
    expect(json.error.timestamp).toBeDefined();
  });

  it('should include details in JSON if present', () => {
    const error = new AppError('Test', 400, 'TEST', true, { field: 'email' });
    const json = error.toJSON();

    expect(json.error.details).toEqual({ field: 'email' });
  });
});

describe('ValidationError', () => {
  it('should have 400 status code', () => {
    const error = new ValidationError('Invalid input');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('should be operational', () => {
    const error = new ValidationError('Invalid input');
    expect(error.isOperational).toBe(true);
  });

  it('should accept details', () => {
    const error = new ValidationError('Invalid input', { field: 'email', reason: 'format' });
    expect(error.details).toEqual({ field: 'email', reason: 'format' });
  });
});

describe('UnauthorizedError', () => {
  it('should have 401 status code', () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('should have default message', () => {
    const error = new UnauthorizedError();
    expect(error.message).toContain('Authentication');
  });

  it('should accept custom message', () => {
    const error = new UnauthorizedError('Token expired');
    expect(error.message).toBe('Token expired');
  });
});

describe('ForbiddenError', () => {
  it('should have 403 status code', () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });
});

describe('NotFoundError', () => {
  it('should have 404 status code', () => {
    const error = new NotFoundError('User');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('should format message with resource name', () => {
    const error = new NotFoundError('Wallet');
    expect(error.message).toContain('Wallet');
    expect(error.message).toContain('not found');
  });

  it('should include identifier in message if provided', () => {
    const error = new NotFoundError('User', 'seed.user.primary@krystaline.io');
    expect(error.message).toContain('seed.user.primary@krystaline.io');
  });
});

describe('ConflictError', () => {
  it('should have 409 status code', () => {
    const error = new ConflictError('Email already exists');
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });
});

describe('UnprocessableEntityError', () => {
  it('should have 422 status code', () => {
    const error = new UnprocessableEntityError('Cannot process request');
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('UNPROCESSABLE_ENTITY');
  });
});

describe('RateLimitError', () => {
  it('should have 429 status code', () => {
    const error = new RateLimitError();
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should have message about rate limit', () => {
    const error = new RateLimitError();
    expect(error.message.toLowerCase()).toContain('rate limit');
  });
});

describe('TimeoutError', () => {
  it('should have 504 status code', () => {
    const error = new TimeoutError('Database', 5000);
    expect(error.statusCode).toBe(504);
    expect(error.code).toBe('TIMEOUT');
  });

  it('should include operation and timeout in message', () => {
    const error = new TimeoutError('API call', 10000);
    expect(error.message).toContain('API call');
    expect(error.message).toContain('10000');
  });
});

describe('InsufficientFundsError', () => {
  it('should have 422 status code', () => {
    const error = new InsufficientFundsError('BTC', 1.5, 0.5);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('should include asset, required, and available in message', () => {
    const error = new InsufficientFundsError('BTC', 1.5, 0.5);
    expect(error.message).toContain('BTC');
    expect(error.message).toContain('1.5');
    expect(error.message).toContain('0.5');
  });

  it('should include details', () => {
    const error = new InsufficientFundsError('USD', 10000, 500);
    expect(error.details).toEqual({ asset: 'USD', required: 10000, available: 500 });
  });
});

describe('OrderError', () => {
  it('should have 422 status code', () => {
    const error = new OrderError('Order rejected');
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('ORDER_ERROR');
  });
});

describe('WalletError', () => {
  it('should have 422 status code', () => {
    const error = new WalletError('Wallet locked');
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('WALLET_ERROR');
  });
});

describe('ExternalServiceError', () => {
  it('should have 503 status code', () => {
    const error = new ExternalServiceError('RabbitMQ');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
  });

  it('should include service name in message', () => {
    const error = new ExternalServiceError('Binance API');
    expect(error.message).toContain('Binance API');
  });
});

describe('ServiceError', () => {
  it('should have 503 status code', () => {
    const error = new ServiceError('Database', 'Connection refused');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('should include service name in message', () => {
    const error = new ServiceError('Redis', 'Timeout');
    expect(error.message).toContain('Redis');
  });
});

describe('isOperationalError', () => {
  it('should return true for AppError with isOperational=true', () => {
    const error = new ValidationError('Test');
    expect(isOperationalError(error)).toBe(true);
  });

  it('should return false for regular Error', () => {
    const error = new Error('Test');
    expect(isOperationalError(error)).toBe(false);
  });

  it('should return false for non-operational AppError', () => {
    const error = new AppError('Test', 500, 'INTERNAL', false);
    expect(isOperationalError(error)).toBe(false);
  });
});

describe('createErrorFromStatusCode', () => {
  it('should create ValidationError for 400', () => {
    const error = createErrorFromStatusCode(400, 'Bad request');
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('should create UnauthorizedError for 401', () => {
    const error = createErrorFromStatusCode(401, 'Unauthorized');
    expect(error).toBeInstanceOf(UnauthorizedError);
  });

  it('should create ForbiddenError for 403', () => {
    const error = createErrorFromStatusCode(403, 'Forbidden');
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  it('should create NotFoundError for 404', () => {
    const error = createErrorFromStatusCode(404, 'Not found');
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it('should create ConflictError for 409', () => {
    const error = createErrorFromStatusCode(409, 'Conflict');
    expect(error).toBeInstanceOf(ConflictError);
  });

  it('should create RateLimitError for 429', () => {
    const error = createErrorFromStatusCode(429, 'Too many requests');
    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('should create TimeoutError for 504', () => {
    const error = createErrorFromStatusCode(504, 'Timeout');
    expect(error).toBeInstanceOf(TimeoutError);
  });

  it('should create generic AppError for unknown status codes', () => {
    const error = createErrorFromStatusCode(418, "I'm a teapot");
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(418);
  });
});
