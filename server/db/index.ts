/**
 * Database Connection
 * 
 * PostgreSQL connection pool for the crypto exchange.
 */

import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { DatabaseError } from '../lib/errors';

const logger = createLogger('database');

// Create connection pool with config
const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
});

// Test connection on startup
pool.on('connect', (client: PoolClient) => {
    logger.info({
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
    }, 'Connected to PostgreSQL');
});

pool.on('error', (err: Error) => {
    logger.error({
        err: {
            message: err.message,
            name: err.name,
        },
    }, 'Unexpected database error');
});

export const db = {
    query: async (text: string, params?: any[]) => {
        try {
            const start = Date.now();
            const result = await pool.query(text, params);
            const duration = Date.now() - start;
            
            logger.debug({
                query: text.substring(0, 100),
                duration,
                rows: result.rowCount,
            }, 'Query executed');
            
            return result;
        } catch (error) {
            logger.error({
                query: text.substring(0, 100),
                err: error,
            }, 'Query failed');
            throw new DatabaseError('Query execution failed', { query: text, error });
        }
    },

    getClient: async () => {
        try {
            return await pool.connect();
        } catch (error) {
            logger.error({ err: error }, 'Failed to get database client');
            throw new DatabaseError('Failed to acquire database connection');
        }
    },

    // Transaction helper
    async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
            logger.debug('Transaction started');
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            logger.debug('Transaction committed');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            logger.warn({ err: error }, 'Transaction rolled back');
            throw new DatabaseError('Transaction failed', { error });
        } finally {
            client.release();
        }
    },

    // Health check
    async checkHealth(): Promise<boolean> {
        try {
            await pool.query('SELECT 1');
            logger.debug('Database health check passed');
            return true;
        } catch (error) {
            logger.error({ err: error }, 'Database health check failed');
            return false;
        }
    },

    // Close all connections (for graceful shutdown)
    async end(): Promise<void> {
        try {
            await pool.end();
            logger.info('Database pool closed');
        } catch (error) {
            logger.error({ err: error }, 'Error closing database pool');
            throw error;
        }
    }
};

export default db;
