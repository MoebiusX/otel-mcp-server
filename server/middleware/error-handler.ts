/**
 * Global Error Handler Middleware
 * 
 * Catches all errors, logs them appropriately, and formats consistent error responses.
 * Should be registered as the last middleware in the Express app.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ValidationError, InternalServerError, isOperationalError } from '../lib/errors';
import { createLogger, logError } from '../lib/logger';

const logger = createLogger('error-handler');

// ============================================
// ERROR HANDLER MIDDLEWARE
// ============================================

/**
 * Global error handler middleware
 * Processes all errors thrown in the application
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if response already sent
  if (res.headersSent) {
    return next(err);
  }

  // Extract request context for logging
  const requestContext = {
    method: req.method,
    path: req.path,
    query: req.query,
    correlationId: req.headers['x-correlation-id'],
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  };

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationError = new ValidationError(
      'Request validation failed',
      formatZodErrors(err)
    );
    return sendErrorResponse(res, validationError, requestContext);
  }

  // Handle known application errors
  if (err instanceof AppError) {
    logAppError(err, requestContext);
    return sendErrorResponse(res, err, requestContext);
  }

  // Handle unknown errors (programming errors)
  logUnknownError(err, requestContext);
  const unknownError = new InternalServerError(
    process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred'
      : err.message
  );
  sendErrorResponse(res, unknownError, requestContext);
}

// ============================================
// ERROR LOGGING
// ============================================

/**
 * Log application errors based on severity
 */
function logAppError(error: AppError, context: object): void {
  const logData = {
    code: error.code,
    statusCode: error.statusCode,
    isOperational: error.isOperational,
    details: error.details,
    ...context,
  };

  // Operational errors are expected (log as warning)
  if (error.isOperational) {
    // 4xx errors are client errors (less severe)
    if (error.statusCode >= 400 && error.statusCode < 500) {
      logger.warn(logData, error.message);
    } else {
      // 5xx operational errors (like service unavailable)
      logger.error(logData, error.message);
    }
  } else {
    // Programming errors are critical
    logError(logger, error, logData);
  }
}

/**
 * Log unknown/unhandled errors (potential bugs)
 */
function logUnknownError(error: Error, context: object): void {
  logger.error({
    err: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  }, `Unhandled error: ${error.message}`);
}

// ============================================
// RESPONSE FORMATTING
// ============================================

/**
 * Send formatted error response
 */
function sendErrorResponse(
  res: Response,
  error: AppError,
  context: object
): void {
  // In production, hide internal error details
  const shouldHideDetails = 
    process.env.NODE_ENV === 'production' && 
    !error.isOperational;

  const errorResponse = shouldHideDetails 
    ? error.toSafeJSON() 
    : error.toJSON();

  // Add request correlation ID if present
  if (context && 'correlationId' in context && context.correlationId) {
    errorResponse.error = {
      ...errorResponse.error,
      correlationId: context.correlationId as string,
    };
  }

  res.status(error.statusCode).json(errorResponse);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format Zod validation errors into a readable structure
 */
function formatZodErrors(error: ZodError): object {
  return {
    validationErrors: error.errors.map((err) => ({
      path: err.path.join('.'),
      message: err.message,
      code: err.code,
    })),
  };
}

// ============================================
// UNHANDLED REJECTION HANDLERS
// ============================================

/**
 * Handle unhandled promise rejections
 */
export function handleUnhandledRejection(): void {
  process.on('unhandledRejection', (reason: Error | any, promise: Promise<any>) => {
    logger.fatal({
      err: reason instanceof Error ? {
        message: reason.message,
        stack: reason.stack,
        name: reason.name,
      } : { reason },
      promise: promise.toString(),
    }, 'Unhandled Promise Rejection');

    // In production, gracefully shutdown
    if (process.env.NODE_ENV === 'production') {
      logger.info('Initiating graceful shutdown due to unhandled rejection...');
      process.exit(1);
    }
  });
}

/**
 * Handle uncaught exceptions
 */
export function handleUncaughtException(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({
      err: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    }, 'Uncaught Exception');

    // Always exit on uncaught exceptions (unsafe to continue)
    logger.info('Exiting due to uncaught exception...');
    process.exit(1);
  });
}

// ============================================
// NOT FOUND HANDLER
// ============================================

/**
 * 404 Not Found handler for undefined routes
 * Register this before the error handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 'ROUTE_NOT_FOUND',
      statusCode: 404,
      path: req.path,
      method: req.method,
    },
  });
}
