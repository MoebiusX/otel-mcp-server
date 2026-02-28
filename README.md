# Krystaline Exchange - AI-Powered Observability Platform

Institutional-grade crypto exchange platform with OTEL tracing, anomaly detection, and AI-driven diagnostics.

An **institutional-grade cryptocurrency exchange platform** that uses **Statistical Anomaly Detection + LLMs to extract maximum value from observability signals**. Combines OpenTelemetry distributed tracing, adaptive anomaly detection, and AI-powered analysis to automatically identify, diagnose, and explain performance issues.

**License:** Apache-2.0

## Quick Start

```bash
# Start all services
npm run dev

# Clean restart (kills all processes, restarts Docker + app)
scripts\restart.bat
```

**Open**: http://localhost:5173

## What This Demo Shows

### Full Distributed Trace (17 spans)
```
kx-wallet: order.submit.client             ← Browser starts trade
├── kx-wallet: HTTP POST                   ← Fetch request
│   └── api-gateway: kong                  ← Kong Gateway (routes + plugins)
│       └── api-gateway: kong.balancer
│           └── kx-exchange: POST          ← Exchange API handler
│               ├── kx-exchange: publish orders      ← RabbitMQ publish
│               │   └── kx-exchange: publish <default>
│               │       └── kx-matcher: order.match  ← Consumer processes
│               │           └── kx-matcher: order.response
│               └── kx-exchange: payment_response process  ← Response received
└── kx-wallet: order.response.received     ← Browser receives FILLED
```

### Multi-User Transfers
```
kx-wallet: transfer.submit.client          ← Browser starts transfer
├── kx-wallet: HTTP POST                   ← Fetch request
│   └── api-gateway: kong → kx-exchange: btc.transfer
└── kx-wallet: transfer.response.received
```

### Services & OTEL Names

| Service | URL | OTEL Service Name |
|---------|-----|-------------------|
| Krystaline Wallet (Browser) | http://localhost:5173 | `kx-wallet` |
| Krystaline Exchange API (Server) | http://localhost:5000 | `kx-exchange` |
| Krystaline Matcher (Processor) | RabbitMQ consumer | `kx-matcher` |
| Kong Gateway | http://localhost:8000 | `api-gateway` |
| Jaeger UI | http://localhost:16686 | - |
| RabbitMQ | http://localhost:15672 | - |
| Prometheus | http://localhost:9090 | - |

### Metrics Endpoints

| Metric Source | URL | Description |
|---------------|-----|-------------|
| Exchange API | http://localhost:5000/metrics | Application metrics (requests, orders, latency) |
| RabbitMQ | http://localhost:15692/metrics | Queue depth, message rates, connections |
| PostgreSQL (App) | http://localhost:9187/metrics | Database connections, query stats |
| PostgreSQL (Kong) | http://localhost:9188/metrics | Kong database metrics |
| Node Exporter | http://localhost:9100/metrics | OS metrics (CPU, memory, disk, network) |

## Architecture

```
Browser (kx-wallet)
    ↓ HTTP POST /api/orders (or /api/transfer)
Kong Gateway (api-gateway)
    ↓
Krystaline Exchange API (kx-exchange)
    ↓ RabbitMQ publish (with trace context)
Order Matcher (order-matcher)
    ↓ Execute trade
    ↓ RabbitMQ response (with parent context)
Exchange API (update wallet)
    ↓
Browser (order.response.received)
```

## Features

### Trading
- **Dark themed** crypto trading UI
- **BTC/USD trading** with simulated price (~$42K range)
- **BUY/SELL orders** with fill price and slippage
- **Real-time wallet** balance updates

### Authentication
- **Email-based registration** with verification codes
- **JWT authentication** with refresh tokens
- **Session management** with secure logout
- **Optional 2FA** with TOTP support

### Tracing
- **17 spans** for order flow
- **4 services** in distributed trace
- **Context propagation** through RabbitMQ
- **Client-side spans** showing response processing

### Monitoring & Anomaly Detection
- **Trace duration anomalies** - Automatic detection of slow operations
- **Amount anomaly detection** - Whale transaction monitoring (pluggable)
  - Enable: `ENABLE_AMOUNT_ANOMALY_DETECTION=true`
  - Thresholds: SEV 5 (3σ) → SEV 1 (7σ) for 6-order-of-magnitude detection
  - Passive logging with 🐋 WHALE ALERT

### AI-Powered Analysis
- **LLM trace analysis** - Automatic root cause identification for anomalies
- **Context-aware diagnostics** - Analyzes full trace context, span attributes, and timing
- **Actionable recommendations** - Suggests specific fixes, not just symptoms
- **Training data collection** - Human feedback loop for continuous improvement
- **Fine-tuning ready** - Export training examples as JSONL for model optimization

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | Login with email/password |
| `/api/auth/verify` | POST | Verify email with code |
| `/api/wallet` | GET | Get authenticated user's wallet |
| `/api/orders` | POST | Submit trade order |
| `/api/orders` | GET | Get user's order history |
| `/api/transfers` | POST | Transfer crypto to another user |
| `/api/price` | GET | Current BTC price |
| `/api/monitor/health` | GET | System health status |
| `/api/monitor/anomalies` | GET | Active trace anomalies |
| `/api/monitor/amount-anomalies` | GET | Active whale anomalies |

## Testing

### Manual Test - Trading
1. Go to http://localhost:5173
2. Register a new account or login
3. Verify your email (check MailDev at http://localhost:1080)
4. Enter BTC amount to trade
5. Click BUY or SELL
6. Check Jaeger at http://localhost:16686 → service `kx-wallet` or `kx-exchange`

### Manual Test - Transfer
1. Register a second account
2. Navigate to Transfer page
3. Enter recipient's wallet address (`kx1...`)
4. Enter amount and confirm
5. Verify balance updates for both users

## Technical Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **Backend**: Express.js, TypeScript
- **Messaging**: RabbitMQ with W3C trace context propagation
- **Gateway**: Kong Gateway with OpenTelemetry plugin
- **Tracing**: OpenTelemetry SDK (browser + Node.js)
- **Visualization**: Jaeger

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development environment |
| `scripts\restart.bat` | Clean restart (Docker + app) |
| `npm run test:e2e` | Run E2E tests |
| `npm run build` | Build for production |