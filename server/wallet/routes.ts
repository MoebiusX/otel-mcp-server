/**
 * Wallet Routes
 * 
 * API endpoints for wallet balances and transactions.
 */

import { Router } from 'express';
import { walletService } from './wallet-service';
import { authenticate } from '../auth/routes';
import { getErrorMessage } from '../lib/errors';

const router = Router();

/**
 * GET /api/wallet/balances
 * Get all wallet balances for current user
 */
router.get('/balances', authenticate, async (req, res) => {
    try {
        const wallets = await walletService.getWallets(req.user!.id);

        res.json({
            success: true,
            wallets: wallets.map(w => ({
                asset: w.asset,
                balance: w.balance,
                available: w.available,
                locked: w.locked,
            }))
        });
    } catch (error: unknown) {
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

/**
 * GET /api/wallet/summary
 * Get balance summary
 */
router.get('/summary', authenticate, async (req, res) => {
    try {
        const summary = await walletService.getBalanceSummary(req.user!.id);
        res.json({ success: true, balances: summary });
    } catch (error: unknown) {
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

/**
 * GET /api/wallet/:asset
 * Get specific wallet balance
 */
router.get('/:asset', authenticate, async (req, res) => {
    try {
        const wallet = await walletService.getWallet(req.user!.id, req.params.asset);

        if (!wallet) {
            return res.status(404).json({ error: 'Wallet not found' });
        }

        res.json({
            success: true,
            wallet: {
                asset: wallet.asset,
                balance: wallet.balance,
                available: wallet.available,
                locked: wallet.locked,
            }
        });
    } catch (error: unknown) {
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

/**
 * GET /api/wallet/transactions/history
 * Get transaction history
 */
router.get('/transactions/history', authenticate, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const transactions = await walletService.getTransactions(req.user!.id, limit);

        res.json({
            success: true,
            transactions: transactions.map(t => ({
                id: t.id,
                type: t.type,
                asset: (t as any).asset,
                amount: t.amount,
                fee: t.fee,
                status: t.status,
                description: t.description,
                created_at: t.created_at,
            }))
        });
    } catch (error: unknown) {
        res.status(500).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/wallet/deposit
 * Simulate a deposit (for demo purposes)
 */
router.post('/deposit', authenticate, async (req, res) => {
    try {
        const { asset, amount } = req.body;

        if (!asset || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid asset and amount required' });
        }

        const transaction = await walletService.credit(
            req.user!.id,
            asset,
            amount,
            'deposit',
            'Manual deposit (simulated)'
        );

        res.json({
            success: true,
            message: `Deposited ${amount} ${asset}`,
            transaction: {
                id: transaction.id,
                type: transaction.type,
                amount: transaction.amount,
                created_at: transaction.created_at,
            }
        });
    } catch (error: unknown) {
        res.status(400).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/wallet/withdraw
 * Simulate a withdrawal (for demo purposes)
 */
router.post('/withdraw', authenticate, async (req, res) => {
    try {
        const { asset, amount } = req.body;

        if (!asset || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid asset and amount required' });
        }

        const transaction = await walletService.debit(
            req.user!.id,
            asset,
            amount,
            'withdrawal',
            'Manual withdrawal (simulated)'
        );

        res.json({
            success: true,
            message: `Withdrew ${amount} ${asset}`,
            transaction: {
                id: transaction.id,
                type: transaction.type,
                amount: transaction.amount,
                created_at: transaction.created_at,
            }
        });
    } catch (error: unknown) {
        res.status(400).json({ error: getErrorMessage(error) });
    }
});

/**
 * POST /api/wallet/transfer
 * Transfer funds to another user (P2P)
 */
router.post('/transfer', authenticate, async (req, res) => {
    try {
        const { toUserId, asset, amount } = req.body;

        if (!toUserId || !asset || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid toUserId, asset, and amount required' });
        }

        if (toUserId === req.user!.id) {
            return res.status(400).json({ error: 'Cannot transfer to yourself' });
        }

        const result = await walletService.transfer(
            req.user!.id,
            toUserId,
            asset,
            amount
        );

        res.json({
            success: true,
            message: `Transferred ${amount} ${asset}`,
            transferId: result.transferId,
            fromBalance: result.fromBalance,
            toBalance: result.toBalance,
        });
    } catch (error: unknown) {
        res.status(400).json({ error: getErrorMessage(error) });
    }
});

export default router;
