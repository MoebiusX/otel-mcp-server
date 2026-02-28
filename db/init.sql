-- Crypto Exchange Database Schema
-- PostgreSQL 15

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================================
-- Users & Authentication
-- ==================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'kyc_pending', 'kyc_verified', 'suspended')),
    kyc_level INTEGER DEFAULT 0 CHECK (kyc_level >= 0 AND kyc_level <= 3),
    -- Two-Factor Authentication
    two_factor_secret VARCHAR(64),
    two_factor_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    two_factor_backup_codes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- Verification codes (email/SMS)
CREATE TABLE verification_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(6) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('email', 'phone', 'password_reset')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions (for JWT refresh tokens)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(45),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================================
-- Wallets & Balances
-- ==================================

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset VARCHAR(10) NOT NULL,  -- BTC, ETH, USDT, USD, EUR
    balance DECIMAL(24, 8) DEFAULT 0 CHECK (balance >= 0),
    available DECIMAL(24, 8) DEFAULT 0 CHECK (available >= 0),
    locked DECIMAL(24, 8) DEFAULT 0 CHECK (locked >= 0),
    address VARCHAR(64),  -- Krystaline Exchange wallet address (kx1...)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, asset)
);

-- Transactions (deposits, withdrawals, trades)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'trade_buy', 'trade_sell', 'fee', 'bonus')),
    amount DECIMAL(24, 8) NOT NULL,
    fee DECIMAL(24, 8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    reference_id VARCHAR(255),  -- order ID, external tx hash, etc.
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================================
-- Trading
-- ==================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(50) UNIQUE,  -- Application-level ID (ORD-xxx-x)
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pair VARCHAR(20) NOT NULL,  -- BTC/USDT, ETH/USD
    side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    type VARCHAR(10) NOT NULL CHECK (type IN ('market', 'limit')),
    price DECIMAL(24, 8),  -- NULL for market orders
    quantity DECIMAL(24, 8) NOT NULL,
    filled DECIMAL(24, 8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('pending', 'accepted', 'open', 'partial', 'filled', 'cancelled')),
    trace_id VARCHAR(64),  -- OpenTelemetry trace ID for observability
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trade history (matched orders)
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_order_id UUID REFERENCES orders(id),
    seller_order_id UUID REFERENCES orders(id),
    pair VARCHAR(20) NOT NULL,
    price DECIMAL(24, 8) NOT NULL,
    quantity DECIMAL(24, 8) NOT NULL,
    buyer_fee DECIMAL(24, 8) DEFAULT 0,
    seller_fee DECIMAL(24, 8) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================================
-- KYC (Know Your Customer)
-- ==================================

CREATE TABLE kyc_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level INTEGER NOT NULL CHECK (level >= 1 AND level <= 3),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    data JSONB,  -- name, dob, address, nationality
    documents JSONB,  -- document URLs
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewer_notes TEXT
);

-- ==================================
-- Monitoring & Observability
-- ==================================

-- Span Baselines - Overall statistics per span type
CREATE TABLE span_baselines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    span_key VARCHAR(255) UNIQUE NOT NULL,
    service VARCHAR(100) NOT NULL,
    operation VARCHAR(255) NOT NULL,
    mean DECIMAL(18, 4) NOT NULL,
    std_dev DECIMAL(18, 4) NOT NULL,
    variance DECIMAL(24, 8) NOT NULL,
    p50 DECIMAL(18, 4),
    p95 DECIMAL(18, 4),
    p99 DECIMAL(18, 4),
    min DECIMAL(18, 4),
    max DECIMAL(18, 4),
    sample_count INTEGER DEFAULT 0 NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Time Baselines - Time-bucketed statistics (168 buckets per span: 24h x 7 days)
CREATE TABLE time_baselines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    span_key VARCHAR(255) NOT NULL,
    service VARCHAR(100) NOT NULL,
    operation VARCHAR(255) NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
    mean DECIMAL(18, 4) NOT NULL,
    std_dev DECIMAL(18, 4) NOT NULL,
    sample_count INTEGER DEFAULT 0 NOT NULL,
    thresholds JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(span_key, day_of_week, hour_of_day)
);

-- Anomalies - Historical anomaly records
CREATE TABLE anomalies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trace_id VARCHAR(64) NOT NULL,
    span_id VARCHAR(64) NOT NULL,
    service VARCHAR(100) NOT NULL,
    operation VARCHAR(255) NOT NULL,
    duration DECIMAL(18, 4) NOT NULL,
    expected_mean DECIMAL(18, 4) NOT NULL,
    expected_std_dev DECIMAL(18, 4) NOT NULL,
    deviation DECIMAL(10, 4) NOT NULL,
    severity INTEGER NOT NULL CHECK (severity >= 1 AND severity <= 5),
    severity_name VARCHAR(20) NOT NULL,
    attributes JSONB,
    day_of_week INTEGER,
    hour_of_day INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================================
-- Indexes
-- ==================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_verification_codes_user ON verification_codes(user_id, type);
CREATE INDEX idx_wallets_user ON wallets(user_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_pair_status ON orders(pair, status);
CREATE INDEX idx_trades_pair ON trades(pair);
CREATE INDEX idx_span_baselines_service ON span_baselines(service);
CREATE INDEX idx_time_baselines_span ON time_baselines(span_key);
CREATE INDEX idx_anomalies_service ON anomalies(service);
CREATE INDEX idx_anomalies_severity ON anomalies(severity);
CREATE INDEX idx_anomalies_created ON anomalies(created_at);
CREATE INDEX idx_anomalies_trace ON anomalies(trace_id);

-- ==================================
-- Functions
-- ==================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================================
-- Initial Data (Supported Assets)
-- ==================================

-- We'll create wallets dynamically when users register
-- Supported trading pairs will be handled in application code
