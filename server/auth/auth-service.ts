/**
 * Authentication Service
 * 
 * Handles user registration, verification, login, and session management.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import db from '../db';
import emailService from './email-service';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { ValidationError, NotFoundError, AuthenticationError } from '../lib/errors';
// walletService is imported dynamically to avoid circular dependency

const logger = createLogger('auth');
const JWT_SECRET = config.server.jwtSecret;
const JWT_EXPIRES_IN = '1h';
const REFRESH_EXPIRES_IN = '7d';

// Server startup timestamp - tokens issued before this time are invalid
let serverStartTime = Math.floor(Date.now() / 1000);

// Validation schemas
export const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least 1 uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least 1 number'),
    phone: z.string().optional(),
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

export const verifySchema = z.object({
    email: z.string().email(),
    code: z.string().length(6, 'Code must be 6 digits'),
});

// Types
export interface User {
    id: string;
    email: string;
    phone: string | null;
    status: string;
    kyc_level: number;
    created_at: Date;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    sessionId: string;
}

export interface SessionInfo {
    userAgent?: string;
    ipAddress?: string;
}

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export const authService = {
    /**
     * Register a new user
     */
    async register(data: z.infer<typeof registerSchema>): Promise<{ user: User; message: string }> {
        // Check if email already exists
        const existing = await db.query(
            'SELECT id FROM users WHERE email = $1',
            [data.email.toLowerCase()]
        );

        if (existing.rows.length > 0) {
            throw new Error('Email already registered');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(data.password, 12);

        // Create user
        const result = await db.query(
            `INSERT INTO users (email, phone, password_hash, status)
             VALUES ($1, $2, $3, 'pending')
             RETURNING id, email, phone, status, kyc_level, created_at`,
            [data.email.toLowerCase(), data.phone || null, passwordHash]
        );

        const user = result.rows[0];

        // Generate and send verification code
        const code = generateCode();
        await db.query(
            `INSERT INTO verification_codes (user_id, code, type, expires_at)
             VALUES ($1, $2, 'email', NOW() + INTERVAL '10 minutes')`,
            [user.id, code]
        );

        await emailService.sendVerificationCode(user.email, code);

        logger.info({
            userId: user.id,
            email: user.email
        }, 'New user registered');
        return { user, message: 'Verification code sent to your email' };
    },

    /**
     * Verify email with code
     */
    async verifyEmail(data: z.infer<typeof verifySchema>, sessionInfo?: SessionInfo): Promise<{ user: User; tokens: AuthTokens }> {
        // Find user
        const userResult = await db.query(
            'SELECT * FROM users WHERE email = $1',
            [data.email.toLowerCase()]
        );

        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }

        const user = userResult.rows[0];

        // Check code
        const codeResult = await db.query(
            `SELECT * FROM verification_codes 
             WHERE user_id = $1 AND code = $2 AND type = 'email' 
             AND used = FALSE AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [user.id, data.code]
        );

        // E2E Test bypass: accept code 000000 for test emails in development
        const isTestEmail = data.email.endsWith('@test.com') || data.email.endsWith('@test.krystaline.io');
        const isE2ETestBypass =
            process.env.NODE_ENV !== 'production' &&
            isTestEmail &&
            data.code === '000000';

        if (codeResult.rows.length === 0 && !isE2ETestBypass) {
            throw new Error('Invalid or expired code');
        }

        // Mark code as used and update user status
        await db.transaction(async (client) => {
            // Only update verification code if not using E2E bypass
            if (codeResult.rows.length > 0) {
                await client.query(
                    'UPDATE verification_codes SET used = TRUE WHERE id = $1',
                    [codeResult.rows[0].id]
                );
            }

            await client.query(
                `UPDATE users SET status = 'verified' WHERE id = $1`,
                [user.id]
            );
        });

        // Create initial wallets with test funds (dynamic import to avoid circular dep)
        const { walletService } = await import('../wallet/wallet-service');
        await walletService.createDefaultWallets(user.id);

        // Send welcome email
        await emailService.sendWelcome(user.email);

        // Generate tokens with session info
        const tokens = await this.generateTokens(user.id, sessionInfo);

        logger.info({
            userId: user.id,
            email: user.email
        }, 'User email verified');
        return {
            user: { ...user, status: 'verified' },
            tokens
        };
    },

    /**
     * Login with email and password
     * If 2FA is enabled, returns requires2FA flag instead of tokens
     */
    async login(data: z.infer<typeof loginSchema>, sessionInfo?: SessionInfo): Promise<{ user: User; tokens?: AuthTokens; requires2FA?: boolean; tempToken?: string }> {
        // Find user with 2FA status
        const result = await db.query(
            'SELECT *, two_factor_enabled FROM users WHERE email = $1',
            [data.email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            throw new Error('Invalid email or password');
        }

        const user = result.rows[0];

        // Check if verified
        if (user.status === 'pending') {
            throw new Error('Please verify your email first');
        }

        if (user.status === 'suspended') {
            throw new Error('Account suspended');
        }

        // Check password
        const valid = await bcrypt.compare(data.password, user.password_hash);
        if (!valid) {
            throw new Error('Invalid email or password');
        }

        // If 2FA is enabled, don't issue tokens yet - require TOTP verification
        if (user.two_factor_enabled) {
            // Generate a temporary token that allows only 2FA verification
            const tempToken = jwt.sign(
                { userId: user.id, purpose: '2fa-pending', exp: Math.floor(Date.now() / 1000) + 300 }, // 5 min expiry
                JWT_SECRET
            );

            logger.info({
                userId: user.id,
                email: user.email
            }, 'User login requires 2FA verification');

            return {
                user: { id: user.id, email: user.email, phone: user.phone, status: user.status, kyc_level: user.kyc_level, created_at: user.created_at },
                requires2FA: true,
                tempToken
            };
        }

        // Update last login
        await db.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1',
            [user.id]
        );

        // Generate tokens with session info
        const tokens = await this.generateTokens(user.id, sessionInfo);

        logger.info({
            userId: user.id,
            email: user.email
        }, 'User logged in');
        return { user, tokens };
    },

    /**
     * Generate JWT tokens
     */
    async generateTokens(userId: string, sessionInfo?: SessionInfo): Promise<AuthTokens> {
        const accessToken = jwt.sign(
            { userId },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        const refreshToken = jwt.sign(
            { userId, type: 'refresh' },
            JWT_SECRET,
            { expiresIn: REFRESH_EXPIRES_IN }
        );

        // Store refresh token hash in sessions with user agent and IP
        const tokenHash = await bcrypt.hash(refreshToken, 10);
        const sessionResult = await db.query(
            `INSERT INTO sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')
             RETURNING id`,
            [userId, tokenHash, sessionInfo?.userAgent || null, sessionInfo?.ipAddress || null]
        );

        return {
            accessToken,
            refreshToken,
            expiresIn: 3600, // 1 hour in seconds
            sessionId: sessionResult.rows[0].id,
        };
    },

    /**
     * Verify access token
     * Tokens issued before server startup are rejected
     */
    verifyToken(token: string): { userId: string } | null {
        try {
            const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; iat?: number };

            // Reject tokens issued before server started
            if (decoded.iat && decoded.iat < serverStartTime) {
                logger.debug({ iat: decoded.iat, serverStart: serverStartTime }, 'Token rejected - issued before server restart');
                return null;
            }

            return { userId: decoded.userId };
        } catch {
            return null;
        }
    },

    /**
     * Refresh access token
     */
    async refreshToken(refreshToken: string): Promise<AuthTokens> {
        const decoded = jwt.verify(refreshToken, JWT_SECRET) as { userId: string; type: string };

        if (decoded.type !== 'refresh') {
            throw new Error('Invalid token type');
        }

        // Check if session exists
        const sessions = await db.query(
            `SELECT * FROM sessions 
             WHERE user_id = $1 AND expires_at > NOW()`,
            [decoded.userId]
        );

        // Verify against stored hashes
        let validSession = false;
        for (const session of sessions.rows) {
            if (await bcrypt.compare(refreshToken, session.refresh_token_hash)) {
                validSession = true;
                break;
            }
        }

        if (!validSession) {
            throw new Error('Session expired or invalid');
        }

        return this.generateTokens(decoded.userId);
    },

    /**
     * Logout (invalidate session)
     */
    async logout(userId: string): Promise<void> {
        await db.query(
            'DELETE FROM sessions WHERE user_id = $1',
            [userId]
        );
        logger.info({ userId }, 'User logged out');
    },

    /**
     * Clear all sessions (called on server restart)
     */
    async clearAllSessions(): Promise<number> {
        const result = await db.query('DELETE FROM sessions RETURNING id');
        const count = result.rowCount || 0;
        if (count > 0) {
            logger.info({ sessionCount: count }, 'All sessions invalidated on server startup');
        }
        return count;
    },

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        logger.debug({ userId }, 'Looking up user by ID');
        const result = await db.query(
            'SELECT id, email, phone, status, kyc_level, created_at FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            logger.warn({ userId }, 'User not found by ID');
        }

        return result.rows[0] || null;
    },

    /**
     * Resend verification code
     */
    async resendVerificationCode(email: string): Promise<void> {
        const userResult = await db.query(
            `SELECT * FROM users WHERE email = $1 AND status = 'pending'`,
            [email.toLowerCase()]
        );

        if (userResult.rows.length === 0) {
            throw new Error('User not found or already verified');
        }

        const user = userResult.rows[0];
        const code = generateCode();

        await db.query(
            `INSERT INTO verification_codes (user_id, code, type, expires_at)
             VALUES ($1, $2, 'email', NOW() + INTERVAL '10 minutes')`,
            [user.id, code]
        );

        await emailService.sendVerificationCode(email, code);
        logger.info({ email }, 'Verification code resent');
    }
};

export default authService;
