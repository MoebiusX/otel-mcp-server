-- Delete seed users and all related data to start fresh with UUIDs
-- Run with: psql -h localhost -p 5433 -U exchange -d crypto_exchange -f scripts/reset-seed-users.sql

-- Delete in order to respect foreign key constraints
DELETE FROM verification_codes WHERE user_id IN (
    SELECT id FROM users WHERE email IN ('seed.user.primary@krystaline.io', 'seed.user.secondary@krystaline.io')
);

DELETE FROM sessions WHERE user_id IN (
    SELECT id FROM users WHERE email IN ('seed.user.primary@krystaline.io', 'seed.user.secondary@krystaline.io')
);

DELETE FROM transactions WHERE user_id IN (
    SELECT id FROM users WHERE email IN ('seed.user.primary@krystaline.io', 'seed.user.secondary@krystaline.io')
);

DELETE FROM orders WHERE user_id IN (
    SELECT id FROM users WHERE email IN ('seed.user.primary@krystaline.io', 'seed.user.secondary@krystaline.io')
);

DELETE FROM wallets WHERE user_id IN (
    SELECT id FROM users WHERE email IN ('seed.user.primary@krystaline.io', 'seed.user.secondary@krystaline.io')
);

DELETE FROM users WHERE email IN ('seed.user.primary@krystaline.io', 'seed.user.secondary@krystaline.io');

\echo 'Seed users deleted successfully. Now run: npx tsx scripts/seed-demo-users.ts'
