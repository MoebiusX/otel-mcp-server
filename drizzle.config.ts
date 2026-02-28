import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './server/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5433'),
        user: process.env.DB_USER || 'exchange',
        password: process.env.DB_PASSWORD || 'exchange123',
        database: process.env.DB_NAME || 'crypto_exchange',
        ssl: false,
    },
    verbose: true,
    strict: true,
});
