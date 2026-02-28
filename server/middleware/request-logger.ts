/**
 * Request Logging Middleware
 * 
 * Logs HTTP requests and responses with correlation IDs and trace context.
 * Integrates with OpenTelemetry for distributed tracing.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';
import { createLogger } from '../lib/logger';

const logger = createLogger('http');

// ============================================
// REQUEST LOGGER MIDDLEWARE
// ============================================

/**
 * Log incoming HTTP requests and outgoing responses
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Generate correlation ID if not present
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  req.headers['x-correlation-id'] = correlationId;

  // Add correlation ID to response headers
  res.setHeader('X-Correlation-ID', correlationId);

  // Capture request start time
  const startTime = Date.now();

  // Get OpenTelemetry trace context
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  // Log incoming request
  logger.info({
    event: 'request_started',
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    correlationId,
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  }, `→ ${req.method} ${req.path}`);

  // Capture the original res.json to intercept response body
  const originalJson = res.json.bind(res);
  let responseBody: any;

  res.json = function (body: any) {
    responseBody = body;
    return originalJson(body);
  };

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = getLogLevel(res.statusCode);

    // Don't log body for successful GET requests to reduce noise
    const shouldLogBody = 
      req.method !== 'GET' || 
      res.statusCode >= 400 ||
      duration > 1000; // Log slow requests

    logger[logLevel]({
      event: 'request_completed',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      correlationId,
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      contentLength: res.get('content-length'),
      ...(shouldLogBody && responseBody && { 
        response: truncateObject(responseBody, 500) 
      }),
    }, `← ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);

    // Warn on slow requests (>2s)
    if (duration > 2000) {
      logger.warn({
        event: 'slow_request',
        method: req.method,
        path: req.path,
        duration,
        correlationId,
      }, `Slow request detected: ${req.method} ${req.path} took ${duration}ms`);
    }
  });

  // Log errors
  res.on('error', (error: Error) => {
    logger.error({
      event: 'request_error',
      method: req.method,
      path: req.path,
      correlationId,
      err: {
        message: error.message,
        stack: error.stack,
      },
    }, `Request error: ${error.message}`);
  });

  next();
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Determine log level based on status code
 */
function getLogLevel(statusCode: number): 'info' | 'warn' | 'error' {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

/**
 * Truncate large objects for logging
 */
function truncateObject(obj: any, maxLength: number): any {
  const str = JSON.stringify(obj);
  if (str.length <= maxLength) {
    return obj;
  }
  return {
    _truncated: true,
    _originalLength: str.length,
    _preview: str.substring(0, maxLength) + '...',
  };
}

// ============================================
// OPTIONAL: EXCLUDE PATHS FROM LOGGING
// ============================================

/**
 * Paths to exclude from request logging (e.g., health checks)
 */
const EXCLUDED_PATHS = [
  '/health',
  '/metrics',
  '/favicon.ico',
];

/**
 * Conditional request logger that skips certain paths
 */
export function requestLoggerWithExclusions(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip logging for excluded paths
  if (EXCLUDED_PATHS.some(path => req.path === path)) {
    return next();
  }

  return requestLogger(req, res, next);
}

// ============================================
// SANITIZATION (Security)
// ============================================

/**
 * Sanitize sensitive data from logs
 */
export function sanitizeRequestData(data: any): any {
  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'apiKey',
    'authorization',
    'cookie',
  ];

  if (typeof data === 'object' && data !== null) {
    const sanitized = { ...data };
    
    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      
      // Check if key contains sensitive information
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof sanitized[key] === 'object') {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeRequestData(sanitized[key]);
      }
    }
    
    return sanitized;
  }
  
  return data;
}
