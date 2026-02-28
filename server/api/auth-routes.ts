/**
 * Authentication & Session Management Routes
 * 
 * Endpoints for:
 * - Profile management
 * - Password change/reset
 * - Email verification resend
 * - Session management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db from '../db';
import { createLogger } from '../lib/logger';
import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from '../db/schema';
import { authenticate } from '../auth/routes';

const router = Router();
const logger = createLogger('auth-routes');

// ============================================
// PROFILE ENDPOINTS
// ============================================

/**
 * GET /api/auth/profile
 * Get current user's profile
 */
router.get('/profile', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;

        const result = await db.query(
            `SELECT id, email, phone, status, kyc_level, created_at, last_login_at
       FROM users WHERE id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        res.json({
            id: user.id,
            email: user.email,
            phone: user.phone,
            status: user.status,
            kycLevel: user.kyc_level,
            createdAt: user.created_at,
            lastLoginAt: user.last_login_at,
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to get profile');
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// ============================================
// PASSWORD MANAGEMENT
// ============================================

/**
 * POST /api/auth/change-password
 * Change password for authenticated user
 */
router.post('/change-password', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;

        const validation = changePasswordSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: validation.error.errors[0].message });
        }

        const { currentPassword, newPassword } = validation.data;

        // Get current password hash
        const userResult = await db.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
        if (!isValid) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        // Hash new password and update
        const newHash = await bcrypt.hash(newPassword, 10);
        await db.query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [newHash, userId]
        );

        logger.info({ userId }, 'Password changed successfully');
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        logger.error({ err: error }, 'Failed to change password');
        res.status(500).json({ error: 'Failed to change password' });
    }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset email
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
    try {
        const validation = forgotPasswordSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: validation.error.errors[0].message });
        }

        const { email } = validation.data;

        // Check if user exists
        const userResult = await db.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        // Always return success to prevent email enumeration
        if (userResult.rows.length === 0) {
            return res.json({ success: true, message: 'If an account exists, a reset email has been sent' });
        }

        const userId = userResult.rows[0].id;

        // Generate reset token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Store token
        await db.query(
            `INSERT INTO verification_codes (user_id, code, type, expires_at)
       VALUES ($1, $2, 'password_reset', $3)`,
            [userId, token, expiresAt]
        );

        // In production, send email here
        // For now, log the token (check MailDev in dev)
        logger.info({ email, token }, 'Password reset requested');

        res.json({ success: true, message: 'If an account exists, a reset email has been sent' });
    } catch (error) {
        logger.error({ err: error }, 'Failed to request password reset');
        res.status(500).json({ error: 'Failed to request password reset' });
    }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req: Request, res: Response) => {
    try {
        const validation = resetPasswordSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: validation.error.errors[0].message });
        }

        const { token, newPassword } = validation.data;

        // Find valid token
        const tokenResult = await db.query(
            `SELECT user_id FROM verification_codes
       WHERE code = $1 AND type = 'password_reset' 
       AND expires_at > NOW() AND used = false`,
            [token]
        );

        if (tokenResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const userId = tokenResult.rows[0].user_id;

        // Hash new password and update
        const newHash = await bcrypt.hash(newPassword, 10);
        await db.query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [newHash, userId]
        );

        // Mark token as used
        await db.query(
            'UPDATE verification_codes SET used = true WHERE code = $1',
            [token]
        );

        logger.info({ userId }, 'Password reset successfully');
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        logger.error({ err: error }, 'Failed to reset password');
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ============================================
// EMAIL VERIFICATION
// ============================================

/**
 * POST /api/auth/resend-verification
 * Resend email verification
 */
router.post('/resend-verification', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;

        // Check user status
        const userResult = await db.query(
            'SELECT email, status FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (userResult.rows[0].status !== 'pending') {
            return res.status(400).json({ error: 'Email already verified' });
        }

        // Generate verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Store code
        await db.query(
            `INSERT INTO verification_codes (user_id, code, type, expires_at)
       VALUES ($1, $2, 'email', $3)`,
            [userId, code, expiresAt]
        );

        // In production, send email here
        logger.info({ email: userResult.rows[0].email, code }, 'Verification email resent');

        res.json({ success: true, message: 'Verification email sent' });
    } catch (error) {
        logger.error({ err: error }, 'Failed to resend verification');
        res.status(500).json({ error: 'Failed to resend verification' });
    }
});

// ============================================
// SESSION MANAGEMENT
// ============================================

/**
 * GET /api/auth/sessions
 * Get all active sessions for current user
 */
router.get('/sessions', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const currentSessionId = req.headers['x-session-id'] as string;

        const result = await db.query(
            `SELECT id, user_agent, ip_address, created_at, expires_at
       FROM sessions 
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
            [userId]
        );

        const sessions = result.rows.map(row => ({
            id: row.id,
            userAgent: row.user_agent,
            ipAddress: row.ip_address,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            isCurrent: row.id === currentSessionId,
        }));

        res.json(sessions);
    } catch (error) {
        logger.error({ err: error }, 'Failed to get sessions');
        res.status(500).json({ error: 'Failed to get sessions' });
    }
});

/**
 * DELETE /api/auth/sessions/:id
 * Revoke a specific session
 */
router.delete('/sessions/:id', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const sessionId = req.params.id;

        // Ensure session belongs to user
        const result = await db.query(
            'DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id',
            [sessionId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        logger.info({ userId, sessionId }, 'Session revoked');
        res.json({ success: true, message: 'Session revoked' });
    } catch (error) {
        logger.error({ err: error }, 'Failed to revoke session');
        res.status(500).json({ error: 'Failed to revoke session' });
    }
});

/**
 * POST /api/auth/sessions/revoke-all
 * Revoke all sessions except current
 */
router.post('/sessions/revoke-all', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const currentSessionId = req.headers['x-session-id'] as string;

        const result = await db.query(
            'DELETE FROM sessions WHERE user_id = $1 AND id != $2',
            [userId, currentSessionId]
        );

        logger.info({ userId, count: result.rowCount }, 'All other sessions revoked');
        res.json({ success: true, message: `${result.rowCount} sessions revoked` });
    } catch (error) {
        logger.error({ err: error }, 'Failed to revoke sessions');
        res.status(500).json({ error: 'Failed to revoke sessions' });
    }
});

export default router;
