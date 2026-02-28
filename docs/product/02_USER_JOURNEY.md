# KrystalineX - User Journey Design

**Last Updated:** 2026-02-03  
**Status:** Implemented

---

## Executive Summary

This document defines the user journey for KrystalineX, highlighting our core value proposition: **Proof of Observability™**. All major flows have been implemented and are investor-demo ready.

---

## Current State (All Implemented)

### Backend Services ✅
| Component | Status | Notes |
|-----------|--------|-------|
| User Registration | ✅ Complete | Email + password, verification codes |
| Login/JWT Auth | ✅ Complete | Access + refresh tokens |
| 2FA/TOTP | ✅ Complete | With backup codes |
| Wallet System | ✅ Complete | Multi-asset balances, welcome bonus |
| Convert/Swap | ✅ Complete | Real Binance prices, instant swap |
| Trade Service | ✅ Complete | Market orders, order history |
| Real Price Feed | ✅ Complete | Binance WebSocket, real-time BTC/ETH |
| Transparency API | ✅ Complete | Public trades with verified traces |
| Monitoring | ✅ Complete | Anomaly detection, WebSocket streaming |
| OpenTelemetry | ✅ Complete | Full 17-span distributed tracing |

### Frontend Pages ✅
| Route | Component | Status |
|-------|-----------|--------|
| `/` | Landing Page | ✅ Proof of Observability™ story |
| `/register` | Registration | ✅ Clean signup flow |
| `/verify-email/:token` | Email Verification | ✅ 6-digit code entry |
| `/login` | Login | ✅ Professional login |
| `/portfolio` | My Wallet | ✅ Real prices, asset cards |
| `/trade` | Trading Dashboard | ✅ Buy/Sell with trace links |
| `/convert` | Asset Conversion | ✅ Real Binance rates |
| `/transparency` | Transparency Dashboard | ✅ Live trade feed, metrics |
| `/monitor` | Advanced Monitoring | ✅ Anomaly detection, LLM analysis |

---

## User Journey Flow

### Phase 1: Discovery (Public)

```
Landing Page (/) → "Proof of Observability™" → Sign Up CTA
```

**What Users See:**
- System health status (operational/degraded)
- Live trade feed with Jaeger trace links
- Real P50/P95/P99 latency metrics
- "Traces Collected" counter
- "Start Trading" call-to-action

**Key Message:** "Unlike traditional exchanges where your trade disappears into a black box, Krystaline shows you exactly how every transaction flows through our system."

---

### Phase 2: Onboarding

```
Register → Verify Email → Login → Dashboard
```

| Step | Implementation |
|------|----------------|
| Register | Email + password with validation |
| Email Verification | MailDev (dev) / real SMTP (prod), 6-digit code |
| Login | JWT access + refresh tokens |
| First Visit | Redirect to portfolio with starting balance |

---

### Phase 3: Core Exchange Experience

#### Portfolio (`/portfolio`)
- Total portfolio value (real Binance prices)
- Asset cards: BTC, ETH, USDT, USD
- Quick actions: Trade, Convert
- 24h price change indicators

#### Trading (`/trade`)
- Current BTC/USD price (live WebSocket)
- Buy/Sell toggle
- Quantity input with USD equivalent
- Order confirmation with **trace ID link**
- "View in Jaeger" for full transparency

#### Convert (`/convert`)
- From/To asset selector
- Real conversion rates
- Instant swap execution
- Balance updates in real-time

---

### Phase 4: Transparency (Our Differentiator)

#### Transparency Dashboard (`/transparency`)

| Section | What It Shows |
|---------|---------------|
| **System Status** | Operational/Degraded badge |
| **Live Trade Feed** | Last 20 trades with "View Trace" links |
| **Performance Metrics** | Real P50/P95/P99 from baselines |
| **Service Health** | PostgreSQL, RabbitMQ, Kong status |

**This is our killer feature:** No other exchange shows you HOW your trade was processed.

#### Monitor (`/monitor`) - Power Users

| Feature | Description |
|---------|-------------|
| Active Anomalies | Real-time SEV1-5 alerts |
| Span Baselines | Per-operation performance thresholds |
| LLM Analysis | Click "Analyze" for AI root cause |
| History | Trend analysis and patterns |

---

## Navigation Structure

### Authenticated Users
```
[Logo] KrystalineX    Portfolio  Trade  Convert     [User ▾]
                                                    Settings
                                                    Transparency
                                                    Monitor (power users)
                                                    Sign Out
```

### Unauthenticated Users
```
[Logo] KrystalineX    Transparency                  [Login] [Register]
```

---

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/verify` - Verify email code
- `POST /api/auth/login` - Get JWT tokens
- `POST /api/auth/refresh` - Refresh access token

### Trading
- `GET /api/trade/price-status` - Binance connection status
- `POST /api/trade/convert` - Convert between assets
- `POST /api/orders` - Place order (via Kong)
- `GET /api/orders` - Order history

### Wallet
- `GET /api/wallet/balances` - User balances

### Transparency (Public)
- `GET /api/public/status` - System health
- `GET /api/public/trades` - Live trade feed

### Monitoring
- `GET /api/monitor/health` - Detailed health check
- `POST /api/monitor/analyze` - LLM analysis
- `POST /api/monitor/recalculate` - Update baselines

---

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Registration → First Trade | < 3 minutes | ✅ Achieved |
| Users who view transparency | > 50% of traders | Available |
| Trade confirmation with trace | 100% | ✅ Implemented |
| Price accuracy | Real Binance data | ✅ Verified |

---

## Demo Script Reference

For step-by-step investor demonstration, see:
- [DEMO-WALKTHROUGH.md](DEMO-WALKTHROUGH.md) - Full demo script
- [ROADMAP.md](ROADMAP.md) - Feature timeline

---

*Document reflects implemented state as of 2026-02-03*
