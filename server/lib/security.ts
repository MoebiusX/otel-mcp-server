/**
 * Security Utilities
 * 
 * Helper functions for security validation and secret management.
 * Used during application startup to ensure secure configuration.
 */

import { createLogger } from './logger';

const logger = createLogger('security');

/**
 * Validates that required environment variables are set.
 * Logs warnings for missing optional variables.
 */
export function validateRequiredEnvVars(
  required: string[],
  optional: string[] = []
): { valid: boolean; missing: string[] } {
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.error({ missing }, 'Missing required environment variables');
  }
  
  const missingOptional = optional.filter(key => !process.env[key]);
  if (missingOptional.length > 0) {
    logger.warn({ missing: missingOptional }, 'Missing optional environment variables');
  }
  
  return { valid: missing.length === 0, missing };
}

/**
 * Checks if a secret value appears to be a placeholder or insecure default.
 */
export function isInsecureSecret(value: string, name: string): boolean {
  const insecurePatterns = [
    'change-me',
    'changeme',
    'password',
    'secret',
    'example',
    'placeholder',
    'your-',
    'xxx',
    '123456',
    'default',
  ];
  
  const lowerValue = value.toLowerCase();
  const isInsecure = insecurePatterns.some(pattern => lowerValue.includes(pattern));
  
  if (isInsecure) {
    logger.warn({ variable: name }, 'Environment variable appears to contain an insecure placeholder value');
  }
  
  return isInsecure;
}

/**
 * Validates secret strength requirements.
 */
export function validateSecretStrength(
  value: string,
  name: string,
  minLength: number = 16
): boolean {
  if (value.length < minLength) {
    logger.warn(
      { variable: name, length: value.length, required: minLength },
      'Secret does not meet minimum length requirement'
    );
    return false;
  }
  return true;
}

/**
 * Masks a secret for safe logging (shows first 4 and last 4 chars).
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}

/**
 * Performs comprehensive startup security validation.
 * Should be called early in application initialization.
 */
export function performStartupSecurityCheck(): void {
  const env = process.env.NODE_ENV || 'development';
  
  logger.info({ environment: env }, 'Performing startup security check');
  
  // Required for all environments
  const coreRequired = ['JWT_SECRET', 'DB_PASSWORD', 'RABBITMQ_URL'];
  const { valid, missing } = validateRequiredEnvVars(coreRequired);
  
  if (!valid && env === 'production') {
    logger.fatal({ missing }, 'Cannot start in production mode with missing required secrets');
    process.exit(1);
  }
  
  // Additional production checks
  if (env === 'production') {
    const jwtSecret = process.env.JWT_SECRET || '';
    const dbPassword = process.env.DB_PASSWORD || '';
    
    if (isInsecureSecret(jwtSecret, 'JWT_SECRET') || !validateSecretStrength(jwtSecret, 'JWT_SECRET', 32)) {
      logger.fatal('JWT_SECRET is insecure or too short for production');
      process.exit(1);
    }
    
    if (isInsecureSecret(dbPassword, 'DB_PASSWORD') || !validateSecretStrength(dbPassword, 'DB_PASSWORD', 12)) {
      logger.fatal('DB_PASSWORD is insecure or too short for production');
      process.exit(1);
    }
    
    logger.info('Production security checks passed');
  } else {
    logger.info('Development mode - security checks relaxed');
  }
}
