/**
 * Authentication Routes
 * 
 * API endpoints for user registration, verification, and login.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authService, registerSchema, loginSchema, verifySchema, User } from './auth-service';
import { ZodError } from 'zod';
import { createLogger } from '../lib/logger';
import { AuthenticationError, ValidationError, getErrorMessage } from '../lib/errors';
import { recordLogin } from '../metrics/prometheus';
import { recordLoginSuccess, recordLoginFailure, recordInvalidToken } from '../observability/security-events';

const logger = createLogger('auth-routes');
const router = Router();

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request {
            user?: User;
        }
    }
}

/**
 * Middleware to authenticate requests
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    logger.debug({
        path: req.path,
        hasAuth: !!authHeader
    }, 'Authentication check');

    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.slice(7);
    const decoded = authService.verifyToken(token);

    if (!decoded) {
        logger.warn({ path: req.path }, 'Invalid or expired token');
        // Record security event for invalid token
        recordInvalidToken(false, req.ip || req.socket.remoteAddress, req.path).catch(() => { });
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await authService.getUserById(decoded.userId);
    if (!user) {
        logger.warn({ userId: decoded.userId }, 'User not found for valid token');
        return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
};

/**
 * POST /api/auth/register
 * Register a new account
 */
router.post('/register', async (req, res) => {
    try {
        const data = registerSchema.parse(req.body);
        const result = await authService.register(data);

        res.status(201).json({
            success: true,
            message: result.message,
            user: {
                id: result.user.id,
                email: result.user.email,
                status: result.user.status,
            }
        });
    } catch (error: unknown) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.errors.map(e => e.message),
            });
        }
        res.status(400).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/auth/verify
 * Verify email with 6-digit code
 */
router.post('/verify', async (req, res) => {
    try {
        const data = verifySchema.parse(req.body);
        const sessionInfo = {
            userAgent: req.headers['user-agent'] || undefined,
            ipAddress: req.ip || req.socket.remoteAddress || undefined,
        };
        const result = await authService.verifyEmail(data, sessionInfo);

        res.json({
            success: true,
            message: 'Email verified successfully',
            user: {
                id: result.user.id,
                email: result.user.email,
                status: result.user.status,
            },
            tokens: result.tokens,
        });
    } catch (error: unknown) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.errors.map(e => e.message),
            });
        }
        res.status(400).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/auth/resend-code
 * Resend verification code
 */
router.post('/resend-code', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email required' });
        }

        await authService.resendVerificationCode(email);
        res.json({ success: true, message: 'Verification code sent' });
    } catch (error: unknown) {
        res.status(400).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/auth/login
 * Login with email and password
 * If 2FA is enabled, returns requires2FA instead of tokens
 */
router.post('/login', async (req, res) => {
    try {
        const data = loginSchema.parse(req.body);
        const sessionInfo = {
            userAgent: req.headers['user-agent'] || undefined,
            ipAddress: req.ip || req.socket.remoteAddress || undefined,
        };
        const result = await authService.login(data, sessionInfo);

        // Check if 2FA is required
        if (result.requires2FA) {
            return res.json({
                success: true,
                requires2FA: true,
                tempToken: result.tempToken,
                user: {
                    id: result.user.id,
                    email: result.user.email,
                },
            });
        }

        // Normal login response with tokens
        recordLogin('success');

        // Record security event for successful login
        recordLoginSuccess(
            result.user.id,
            sessionInfo.ipAddress,
            sessionInfo.userAgent
        ).catch(() => { });

        // DEBUG: Log what we're returning
        logger.info({
            userId: result.user.id,
            email: result.user.email,
            userType: typeof result.user.id
        }, 'LOGIN RESPONSE - User ID being returned');

        res.json({
            success: true,
            user: {
                id: result.user.id,
                email: result.user.email,
                status: result.user.status,
                kyc_level: result.user.kyc_level,
            },
            tokens: result.tokens,
        });
    } catch (error: unknown) {
        recordLogin('failure');

        // Record security event for failed login
        recordLoginFailure(
            req.body?.email || 'unknown',
            req.ip || req.socket.remoteAddress,
            req.headers['user-agent'],
            getErrorMessage(error)
        ).catch(() => { });
        if (error instanceof ZodError) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.errors.map(e => e.message),
            });
        }
        res.status(401).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        const tokens = await authService.refreshToken(refreshToken);
        res.json({ success: true, tokens });
    } catch (error: unknown) {
        res.status(401).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/auth/logout
 * Logout and invalidate sessions
 */
router.post('/logout', authenticate, async (req, res) => {
    try {
        await authService.logout(req.user!.id);
        res.json({ success: true, message: 'Logged out' });
    } catch (error: unknown) {
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (req, res) => {
    res.json({
        user: {
            id: req.user!.id,
            email: req.user!.email,
            phone: req.user!.phone,
            status: req.user!.status,
            kyc_level: req.user!.kyc_level,
            created_at: req.user!.created_at,
        }
    });
});

export default router;
