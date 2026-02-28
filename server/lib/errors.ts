/**
 * Custom Error Classes
 * 
 * Standardized error handling with proper status codes and serialization.
 * All application errors should extend AppError.
 */

// ============================================
// BASE ERROR CLASS
// ============================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;
  public readonly timestamp: Date;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    details?: unknown
  ) {
    super(message);
    
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    this.timestamp = new Date();

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serialize error for API response
   */
  toJSON() {
    const base = {
      error: {
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        timestamp: this.timestamp.toISOString(),
      } as Record<string, unknown>,
    };
    if (this.details) {
      base.error.details = this.details;
    }
    return base;
  }

  /**
   * Get a safe error object (without sensitive details)
   */
  toSafeJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        timestamp: this.timestamp.toISOString(),
      },
    };
  }
}

// ============================================
// CLIENT ERROR CLASSES (4xx)
// ============================================

/**
 * 400 Bad Request - Invalid input/validation errors
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', true, details);
  }
}

/**
 * 401 Unauthorized - Authentication required
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED', true);
  }
}

/**
 * 401 Authentication Error - Alias for UnauthorizedError
 */
export class AuthenticationError extends UnauthorizedError {
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * 403 Forbidden - Insufficient permissions
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN', true);
  }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, 404, 'NOT_FOUND', true);
  }
}

/**
 * 409 Conflict - Resource conflict (duplicate, concurrent modification, etc.)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', true, details);
  }
}

/**
 * 422 Unprocessable Entity - Semantic validation errors
 */
export class UnprocessableEntityError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'UNPROCESSABLE_ENTITY', true, details);
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends AppError {
  constructor(retryAfterSeconds?: number) {
    const message = retryAfterSeconds
      ? `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds`
      : 'Rate limit exceeded';
    super(message, 429, 'RATE_LIMIT_EXCEEDED', true, { retryAfterSeconds });
  }
}

// ============================================
// SERVER ERROR CLASSES (5xx)
// ============================================

/**
 * 500 Internal Server Error - Generic server error
 */
export class InternalServerError extends AppError {
  constructor(message: string = 'An unexpected error occurred', details?: unknown) {
    super(message, 500, 'INTERNAL_SERVER_ERROR', false, details);
  }
}

/**
 * 503 Service Unavailable - External service/dependency failure
 */
export class ServiceError extends AppError {
  constructor(serviceName: string, message: string, details?: unknown) {
    super(
      `${serviceName} service error: ${message}`,
      503,
      'SERVICE_UNAVAILABLE',
      true,
      details
    );
  }
}

/**
 * 503 Service Unavailable - External service not available
 */
export class ExternalServiceError extends AppError {
  constructor(serviceName: string, originalError?: Error) {
    super(
      `External service '${serviceName}' is unavailable`,
      503,
      'EXTERNAL_SERVICE_ERROR',
      true,
      originalError ? {
        message: originalError.message,
        name: originalError.name,
      } : undefined
    );
  }
}

/**
 * 500 Database Error - Database operation failure
 */
export class DatabaseError extends AppError {
  constructor(operation: string, details?: unknown) {
    super(
      `Database operation failed: ${operation}`,
      500,
      'DATABASE_ERROR',
      true,
      details
    );
  }
}

/**
 * 504 Gateway Timeout - Upstream service timeout
 */
export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      504,
      'TIMEOUT',
      true,
      { operation, timeoutMs }
    );
  }
}

// ============================================
// DOMAIN-SPECIFIC ERROR CLASSES
// ============================================

/**
 * Payment-related errors
 */
export class PaymentError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'PAYMENT_ERROR', true, details);
  }
}

/**
 * Order/Trading-related errors
 */
export class OrderError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'ORDER_ERROR', true, details);
  }
}

/**
 * Wallet/Balance-related errors
 */
export class WalletError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'WALLET_ERROR', true, details);
  }
}

/**
 * Insufficient funds error
 */
export class InsufficientFundsError extends AppError {
  constructor(asset: string, required: number, available: number) {
    super(
      `Insufficient ${asset} balance. Required: ${required}, Available: ${available}`,
      422,
      'INSUFFICIENT_FUNDS',
      true,
      { asset, required, available }
    );
  }
}

// ============================================
// ERROR UTILITIES
// ============================================

/**
 * Check if an error is operational (expected) vs programming error
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Wrap an unknown error into an AppError
 */
export function wrapError(error: unknown, defaultMessage: string = 'An error occurred'): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new InternalServerError(error.message, {
      originalError: error.name,
      stack: error.stack,
    });
  }

  return new InternalServerError(defaultMessage, { originalError: error });
}

/**
 * Create error from status code (useful for HTTP client errors)
 */
export function createErrorFromStatusCode(
  statusCode: number,
  message?: string,
  details?: unknown
): AppError {
  const defaultMessage = message || `Request failed with status ${statusCode}`;

  switch (statusCode) {
    case 400:
      return new ValidationError(defaultMessage, details);
    case 401:
      return new UnauthorizedError(defaultMessage);
    case 403:
      return new ForbiddenError(defaultMessage);
    case 404:
      return new NotFoundError(message || 'Resource');
    case 409:
      return new ConflictError(defaultMessage, details);
    case 422:
      return new UnprocessableEntityError(defaultMessage, details);
    case 429:
      return new RateLimitError();
    case 503:
      return new ServiceError('Upstream', defaultMessage, details);
    case 504:
      return new TimeoutError('Request', 30000);
    default:
      return new AppError(defaultMessage, statusCode, 'UNKNOWN_ERROR', false, details);
  }
}

/**
 * Safely extract error message from unknown error
 * Use this to replace `catch (error: unknown)` patterns
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'An unknown error occurred';
}

/**
 * Get HTTP status code from error
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Get error code from error
 */
export function getErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'UNKNOWN_ERROR';
}
