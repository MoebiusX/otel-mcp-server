/**
 * Drizzle ORM Database Schema
 * 
 * This is the single source of truth for the database schema.
 * TypeScript types and Zod validators are generated from this.
 */

import { pgTable, uuid, varchar, text, timestamp, integer, decimal, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

// ============================================
// USERS & AUTHENTICATION
// ============================================

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    phone: varchar('phone', { length: 20 }).unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).default('pending').notNull()
        .$type<'pending' | 'verified' | 'kyc_pending' | 'kyc_verified' | 'suspended'>(),
    kycLevel: integer('kyc_level').default(0).notNull(),
    // Two-Factor Authentication
    twoFactorSecret: varchar('two_factor_secret', { length: 64 }),
    twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
    twoFactorBackupCodes: jsonb('two_factor_backup_codes').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (table) => [
    index('idx_users_email').on(table.email),
    index('idx_users_status').on(table.status),
]);

export const verificationCodes = pgTable('verification_codes', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 6 }).notNull(),
    type: varchar('type', { length: 10 }).notNull()
        .$type<'email' | 'phone' | 'password_reset'>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    used: boolean('used').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_verification_codes_user').on(table.userId, table.type),
]);

export const sessions = pgTable('sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// WALLETS & BALANCES
// ============================================

export const wallets = pgTable('wallets', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    asset: varchar('asset', { length: 10 }).notNull(),
    balance: decimal('balance', { precision: 24, scale: 8 }).default('0').notNull(),
    available: decimal('available', { precision: 24, scale: 8 }).default('0').notNull(),
    locked: decimal('locked', { precision: 24, scale: 8 }).default('0').notNull(),
    address: varchar('address', { length: 64 }),  // Krystaline wallet address (kx1...)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_wallets_user').on(table.userId),
    uniqueIndex('wallets_user_asset_unique').on(table.userId, table.asset),
    index('idx_wallets_address').on(table.address),
]);

export const transactions = pgTable('transactions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull()
        .$type<'deposit' | 'withdrawal' | 'trade_buy' | 'trade_sell' | 'fee' | 'bonus'>(),
    amount: decimal('amount', { precision: 24, scale: 8 }).notNull(),
    fee: decimal('fee', { precision: 24, scale: 8 }).default('0').notNull(),
    status: varchar('status', { length: 20 }).default('completed').notNull()
        .$type<'pending' | 'completed' | 'failed' | 'cancelled'>(),
    referenceId: varchar('reference_id', { length: 255 }),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_transactions_user').on(table.userId),
    index('idx_transactions_wallet').on(table.walletId),
]);

// ============================================
// TRADING
// ============================================

export const orders = pgTable('orders', {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: varchar('order_id', { length: 50 }).unique(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    pair: varchar('pair', { length: 20 }).notNull(),
    side: varchar('side', { length: 4 }).notNull().$type<'buy' | 'sell'>(),
    type: varchar('type', { length: 10 }).notNull().$type<'market' | 'limit'>(),
    price: decimal('price', { precision: 24, scale: 8 }),
    quantity: decimal('quantity', { precision: 24, scale: 8 }).notNull(),
    filled: decimal('filled', { precision: 24, scale: 8 }).default('0').notNull(),
    status: varchar('status', { length: 20 }).default('open').notNull()
        .$type<'open' | 'partial' | 'filled' | 'cancelled'>(),
    traceId: varchar('trace_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_orders_user').on(table.userId),
    index('idx_orders_pair_status').on(table.pair, table.status),
]);

export const trades = pgTable('trades', {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerOrderId: uuid('buyer_order_id').references(() => orders.id),
    sellerOrderId: uuid('seller_order_id').references(() => orders.id),
    pair: varchar('pair', { length: 20 }).notNull(),
    price: decimal('price', { precision: 24, scale: 8 }).notNull(),
    quantity: decimal('quantity', { precision: 24, scale: 8 }).notNull(),
    buyerFee: decimal('buyer_fee', { precision: 24, scale: 8 }).default('0').notNull(),
    sellerFee: decimal('seller_fee', { precision: 24, scale: 8 }).default('0').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_trades_pair').on(table.pair),
]);

// ============================================
// KYC
// ============================================

export const kycSubmissions = pgTable('kyc_submissions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    status: varchar('status', { length: 20 }).default('pending').notNull()
        .$type<'pending' | 'approved' | 'rejected'>(),
    data: jsonb('data'),
    documents: jsonb('documents'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewerNotes: text('reviewer_notes'),
});

// ============================================
// MONITORING & OBSERVABILITY
// ============================================

/**
 * Span Baselines - Overall statistics per span type
 */
export const spanBaselines = pgTable('span_baselines', {
    id: uuid('id').primaryKey().defaultRandom(),
    spanKey: varchar('span_key', { length: 255 }).unique().notNull(),
    service: varchar('service', { length: 100 }).notNull(),
    operation: varchar('operation', { length: 255 }).notNull(),
    mean: decimal('mean', { precision: 18, scale: 4 }).notNull(),
    stdDev: decimal('std_dev', { precision: 18, scale: 4 }).notNull(),
    variance: decimal('variance', { precision: 24, scale: 8 }).notNull(),
    p50: decimal('p50', { precision: 18, scale: 4 }),
    p95: decimal('p95', { precision: 18, scale: 4 }),
    p99: decimal('p99', { precision: 18, scale: 4 }),
    min: decimal('min', { precision: 18, scale: 4 }),
    max: decimal('max', { precision: 18, scale: 4 }),
    sampleCount: integer('sample_count').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_span_baselines_service').on(table.service),
]);

/**
 * Time Baselines - Time-bucketed statistics (168 buckets per span: 24h x 7 days)
 */
export const timeBaselines = pgTable('time_baselines', {
    id: uuid('id').primaryKey().defaultRandom(),
    spanKey: varchar('span_key', { length: 255 }).notNull(),
    service: varchar('service', { length: 100 }).notNull(),
    operation: varchar('operation', { length: 255 }).notNull(),
    dayOfWeek: integer('day_of_week').notNull(),  // 0-6 (Sunday-Saturday)
    hourOfDay: integer('hour_of_day').notNull(),  // 0-23
    mean: decimal('mean', { precision: 18, scale: 4 }).notNull(),
    stdDev: decimal('std_dev', { precision: 18, scale: 4 }).notNull(),
    sampleCount: integer('sample_count').default(0).notNull(),
    thresholds: jsonb('thresholds'),  // AdaptiveThresholds
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('time_baselines_key_day_hour').on(table.spanKey, table.dayOfWeek, table.hourOfDay),
    index('idx_time_baselines_span').on(table.spanKey),
]);

/**
 * Anomalies - Historical anomaly records
 */
export const anomalies = pgTable('anomalies', {
    id: uuid('id').primaryKey().defaultRandom(),
    traceId: varchar('trace_id', { length: 64 }).notNull(),
    spanId: varchar('span_id', { length: 64 }).notNull(),
    service: varchar('service', { length: 100 }).notNull(),
    operation: varchar('operation', { length: 255 }).notNull(),
    duration: decimal('duration', { precision: 18, scale: 4 }).notNull(),
    expectedMean: decimal('expected_mean', { precision: 18, scale: 4 }).notNull(),
    expectedStdDev: decimal('expected_std_dev', { precision: 18, scale: 4 }).notNull(),
    deviation: decimal('deviation', { precision: 10, scale: 4 }).notNull(),
    severity: integer('severity').notNull(),  // 1-5
    severityName: varchar('severity_name', { length: 20 }).notNull(),
    attributes: jsonb('attributes'),
    dayOfWeek: integer('day_of_week'),
    hourOfDay: integer('hour_of_day'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_anomalies_service').on(table.service),
    index('idx_anomalies_severity').on(table.severity),
    index('idx_anomalies_created').on(table.createdAt),
    index('idx_anomalies_trace').on(table.traceId),
]);

/**
 * Recalculation State - Watermarks for incremental baseline recalculation
 */
export const recalculationState = pgTable('recalculation_state', {
    id: uuid('id').primaryKey().defaultRandom(),
    service: varchar('service', { length: 100 }).notNull().unique(),
    lastProcessedAt: timestamp('last_processed_at', { withTimezone: true }).notNull(),
    lastTraceTime: decimal('last_trace_time', { precision: 20, scale: 0 }),  // Jaeger microseconds
    processingStatus: varchar('processing_status', { length: 50 }).default('idle').notNull()
        .$type<'idle' | 'running' | 'error'>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// SECURITY & AUDIT
// ============================================

/**
 * Security Events - Audit trail for security-relevant activities
 */
export const securityEvents = pgTable('security_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 50 }).notNull()
        .$type<'login_success' | 'login_failed' | '2fa_failed' | 'rate_limit_exceeded' |
            'auth_rate_limit_exceeded' | 'sensitive_rate_limit_exceeded' |
            'invalid_token' | 'token_expired' | 'anomaly_detected' |
            'session_created' | 'session_revoked'>(),
    severity: varchar('severity', { length: 20 }).notNull()
        .$type<'info' | 'low' | 'medium' | 'high' | 'critical'>(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    ipAddress: varchar('ip_address', { length: 45 }),  // IPv6 support
    userAgent: text('user_agent'),
    resource: varchar('resource', { length: 255 }),  // e.g., '/api/auth/login'
    details: jsonb('details').$type<Record<string, unknown>>(),
    traceId: varchar('trace_id', { length: 64 }),  // OTEL correlation
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_security_events_type').on(table.eventType),
    index('idx_security_events_severity').on(table.severity),
    index('idx_security_events_user').on(table.userId),
    index('idx_security_events_created').on(table.createdAt),
    index('idx_security_events_ip').on(table.ipAddress),
]);

// ============================================
// RELATIONS
// ============================================

export const usersRelations = relations(users, ({ many }) => ({
    verificationCodes: many(verificationCodes),
    sessions: many(sessions),
    wallets: many(wallets),
    transactions: many(transactions),
    orders: many(orders),
    kycSubmissions: many(kycSubmissions),
}));

export const verificationCodesRelations = relations(verificationCodes, ({ one }) => ({
    user: one(users, { fields: [verificationCodes.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
    user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const walletsRelations = relations(wallets, ({ one, many }) => ({
    user: one(users, { fields: [wallets.userId], references: [users.id] }),
    transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
    user: one(users, { fields: [transactions.userId], references: [users.id] }),
    wallet: one(wallets, { fields: [transactions.walletId], references: [wallets.id] }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
    user: one(users, { fields: [orders.userId], references: [users.id] }),
}));

export const kycSubmissionsRelations = relations(kycSubmissions, ({ one }) => ({
    user: one(users, { fields: [kycSubmissions.userId], references: [users.id] }),
}));

export const securityEventsRelations = relations(securityEvents, ({ one }) => ({
    user: one(users, { fields: [securityEvents.userId], references: [users.id] }),
}));

// ============================================
// GENERATED ZOD SCHEMAS
// ============================================

// User schemas
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Verification code schemas
export const insertVerificationCodeSchema = createInsertSchema(verificationCodes);
export const selectVerificationCodeSchema = createSelectSchema(verificationCodes);
export type VerificationCode = typeof verificationCodes.$inferSelect;
export type NewVerificationCode = typeof verificationCodes.$inferInsert;

// Session schemas
export const insertSessionSchema = createInsertSchema(sessions);
export const selectSessionSchema = createSelectSchema(sessions);
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// Wallet schemas
export const insertWalletSchema = createInsertSchema(wallets);
export const selectWalletSchema = createSelectSchema(wallets);
export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;

// Transaction schemas
export const insertTransactionSchema = createInsertSchema(transactions);
export const selectTransactionSchema = createSelectSchema(transactions);
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

// Order schemas
export const insertOrderSchema = createInsertSchema(orders);
export const selectOrderSchema = createSelectSchema(orders);
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

// Trade schemas
export const insertTradeSchema = createInsertSchema(trades);
export const selectTradeSchema = createSelectSchema(trades);
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;

// KYC schemas
export const insertKycSubmissionSchema = createInsertSchema(kycSubmissions);
export const selectKycSubmissionSchema = createSelectSchema(kycSubmissions);
export type KycSubmission = typeof kycSubmissions.$inferSelect;
export type NewKycSubmission = typeof kycSubmissions.$inferInsert;

// Span baseline schemas
export const insertSpanBaselineSchema = createInsertSchema(spanBaselines);
export const selectSpanBaselineSchema = createSelectSchema(spanBaselines);
export type SpanBaselineRecord = typeof spanBaselines.$inferSelect;
export type NewSpanBaselineRecord = typeof spanBaselines.$inferInsert;

// Time baseline schemas
export const insertTimeBaselineSchema = createInsertSchema(timeBaselines);
export const selectTimeBaselineSchema = createSelectSchema(timeBaselines);
export type TimeBaselineRecord = typeof timeBaselines.$inferSelect;
export type NewTimeBaselineRecord = typeof timeBaselines.$inferInsert;

// Anomaly schemas
export const insertAnomalySchema = createInsertSchema(anomalies);
export const selectAnomalySchema = createSelectSchema(anomalies);
export type AnomalyRecord = typeof anomalies.$inferSelect;
export type NewAnomalyRecord = typeof anomalies.$inferInsert;

// Security event schemas
export const insertSecurityEventSchema = createInsertSchema(securityEvents);
export const selectSecurityEventSchema = createSelectSchema(securityEvents);
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;

// Security event type constants for type-safe usage
export const SecurityEventTypes = {
    LOGIN_SUCCESS: 'login_success',
    LOGIN_FAILED: 'login_failed',
    TWO_FA_FAILED: '2fa_failed',
    RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
    AUTH_RATE_LIMIT_EXCEEDED: 'auth_rate_limit_exceeded',
    SENSITIVE_RATE_LIMIT_EXCEEDED: 'sensitive_rate_limit_exceeded',
    INVALID_TOKEN: 'invalid_token',
    TOKEN_EXPIRED: 'token_expired',
    ANOMALY_DETECTED: 'anomaly_detected',
    SESSION_CREATED: 'session_created',
    SESSION_REVOKED: 'session_revoked',
} as const;

export const SecuritySeverity = {
    INFO: 'info',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
} as const;

// ============================================
// ADDITIONAL FORM SCHEMAS
// ============================================

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(8, 'Password must be at least 8 characters'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Password must be at least 8 characters'),
}).refine(data => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});

export const forgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
    token: z.string().min(32),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Password must be at least 8 characters'),
}).refine(data => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});
