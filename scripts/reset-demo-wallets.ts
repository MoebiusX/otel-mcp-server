/**
 * Reset Demo User Wallets Script
 *
 * Updates or creates wallets for the primary and secondary seed users with demo balances.
 * Run with: npx tsx scripts/reset-demo-wallets.ts
 */

import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433'),
    database: process.env.DB_NAME || 'crypto_exchange',
    user: process.env.DB_USER || 'exchange',
    password: process.env.DB_PASSWORD,
});

const DEMO_USERS = [
    'seed.user.primary@krystaline.io',
    'seed.user.secondary@krystaline.io',
];

const INITIAL_BALANCES: Record<string, number> = {
    BTC: 1,
    ETH: 10,
    USDT: 10000,
    USD: 50000,
    EUR: 45000,
};

async function resetDemoWallets() {
    console.log('🔄 Resetting demo user wallets...\n');
    const client = await pool.connect();
    try {
        for (const email of DEMO_USERS) {
            const userRes = await client.query(
                'SELECT id FROM users WHERE email = $1',
                [email]
            );
            if (userRes.rows.length === 0) {
                console.log(`❌ User not found: ${email}`);
                continue;
            }
            const userId = userRes.rows[0].id;
            for (const [asset, balance] of Object.entries(INITIAL_BALANCES)) {
                // Upsert wallet
                await client.query(
                    `INSERT INTO wallets (user_id, asset, balance, available, locked)
                     VALUES ($1, $2, $3, $3, 0)
                     ON CONFLICT (user_id, asset)
                     DO UPDATE SET balance = EXCLUDED.balance, available = EXCLUDED.available, locked = 0`,
                    [userId, asset, balance]
                );
            }
            console.log(`✅ Wallets reset for ${email}`);
        }
    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
    console.log('\n✨ Done!');
}

resetDemoWallets();
