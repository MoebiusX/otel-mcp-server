/**
 * Drizzle ORM Database Client
 * 
 * This module provides the Drizzle ORM database client instance.
 * Uses the 'postgres' driver for PostgreSQL connection.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Database connection configuration
const connectionString = process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || 'exchange'}:${process.env.DB_PASSWORD || 'exchange123'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5433'}/${process.env.DB_NAME || 'crypto_exchange'}`;

// Create postgres client (for running queries)
const client = postgres(connectionString);

// Create drizzle instance with schema
export const drizzleDb = drizzle(client, { schema });

// Export schema for use in queries
export { schema };

// Type for the database instance
export type DrizzleDb = typeof drizzleDb;
