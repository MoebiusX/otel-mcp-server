# Krystaline Exchange Architecture & Repository Map

## System Overview

This repository demonstrates OpenTelemetry context propagation using a cryptocurrency exchange system with Kong API Gateway, RabbitMQ messaging, and blockchain-style wallet addresses (`kx1...`).

## Architecture Diagram

```mermaid
graph TB
    subgraph "Frontend Layer"
        UI["React App<br/>(client/src)"]
    end

    subgraph "Gateway Layer"
        KONG["Kong API Gateway<br/>(docker-compose.external.yml)"]
    end

    subgraph "Application Layer"
        EXPRESS["Express Server<br/>(server/index.ts)"]
        ROUTES["API Routes<br/>(server/api/routes.ts)"]
        ORDERS["OrderService<br/>(server/core/order-service.ts)"]
    end

    subgraph "Order Matcher Microservice"
        MATCHER["Order Matcher<br/>(payment-processor/index.ts)"]
    end

    subgraph "Message Queues"
        ORDERS_Q["orders queue"]
        RESPONSE_Q["order_response queue"]
    end

    subgraph "Observability Layer"
        OTEL["OTEL SDK<br/>(server/otel.ts)"]
        COLLECTOR["OTEL Collector<br/>(otel-collector-config.yaml)"]
        JAEGER["Jaeger<br/>(docker-compose.external.yml)"]
    end

    UI -->|HTTP POST| KONG
    KONG -->|Proxy + Context Injection| EXPRESS
    EXPRESS --> ROUTES
    ROUTES --> ORDERS
    ORDERS -->|publish| ORDERS_Q
    ORDERS_Q -->|consume| MATCHER
    MATCHER -->|ACK response| RESPONSE_Q
    RESPONSE_Q -->|consume| EXPRESS
    OTEL -->|Traces| COLLECTOR
    COLLECTOR --> JAEGER
```

## Repository Structure

```
krystaline-exchange/
├── client/                     # Frontend React Application
│   └── src/
│       ├── App.tsx            # Main app component
│       ├── pages/             # Page components (Dashboard, Trade)
│       ├── components/        # UI components (shadcn/ui)
│       ├── hooks/             # React hooks
│       └── lib/               # Utilities (queryClient, utils, otel)
│
├── server/                     # Backend Express Application
│   ├── index.ts               # App entrypoint, middleware setup
│   ├── otel.ts                # OpenTelemetry SDK configuration
│   ├── storage.ts             # In-memory data storage with kx1 wallets
│   ├── vite.ts                # Vite dev server integration
│   ├── api/
│   │   └── routes.ts          # REST API endpoints
│   ├── core/
│   │   └── order-service.ts   # Order matching business logic
│   ├── wallet/
│   │   └── wallet-service.ts  # Wallet management with kx1 addresses
│   └── services/
│       ├── kong-client.ts     # Kong Gateway client
│       └── rabbitmq-client.ts # RabbitMQ producer/consumer
│
├── shared/
│   └── schema.ts              # Zod schemas (Order, Wallet, Transfer)
│
├── scripts/
│   ├── start-dev.js           # Development startup script
│   ├── e2e-test.js            # Automated E2E tests
│   ├── enable-kong-otel.js    # Kong OTEL plugin config
│   └── enable-kong-cors.js    # Kong CORS plugin config
│
├── .github/
│   └── workflows/
│       └── e2e-tests.yml      # GitHub Actions CI pipeline
│
├── docker-compose.yml          # Docker services (Kong, RabbitMQ, Jaeger, etc.)
└── package.json                # Node dependencies and scripts
```

## Key Objects & Their Responsibilities

### Domain Objects (shared/schema.ts)

| Object | Purpose |
|--------|---------|
| `Payment` | Payment transaction record with amount, currency, recipient |
| `Trace` | Distributed trace metadata (traceId, rootSpanId, status) |
| `Span` | Individual span within a trace (operationName, serviceName, duration) |
| `User` | User authentication data (not currently used) |

### Server Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `Express App` | `server/index.ts` | HTTP server, middleware, lifecycle |
| `OTEL SDK` | `server/otel.ts` | Trace collection, span processing, batch export |
| `API Routes` | `server/api/routes.ts` | REST endpoints: POST /payments, GET /traces |
| `PaymentService` | `server/core/payment-service.ts` | Payment validation, storage, queue publishing |
| `KongClient` | `server/services/kong-client.ts` | Kong service/route configuration |
| `RabbitMQClient` | `server/services/rabbitmq-client.ts` | Message publishing with W3C trace context |
| `MemoryStorage` | `server/storage.ts` | In-memory data store for payments, traces |

### Infrastructure Components

| Component | Config File | Purpose |
|-----------|-------------|---------|
| Kong Gateway | `docker-compose.external.yml` | API gateway, context injection |
| RabbitMQ | `docker-compose.external.yml` | Message queue |
| OTEL Collector | `otel-collector-config.yaml` | Trace aggregation, routing |
| Jaeger | `docker-compose.yml` | Trace visualization |
| Prometheus | `prometheus.yml` | Metrics collection |

## Data Flow

### Payment Request Flow
```
1. UI submits payment form
2. Request goes to Kong Gateway (port 8000)
3. Kong injects/preserves trace context (traceparent header)
4. Kong proxies to Express server (port 5000)
5. Express processes with OTEL auto-instrumentation
6. PaymentService creates payment record
7. RabbitMQClient publishes message with trace context
8. Consumer receives and processes message
9. All spans exported to OTEL Collector → Jaeger
```

### Trace Context Propagation
```
Mode 1 (Empty Headers): UI → Kong (creates traceparent) → API → RabbitMQ
Mode 2 (Client Headers): UI (creates traceparent) → Kong (preserves) → API → RabbitMQ
```

## NPM Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start all services (Docker + Express + Vite) |
| `npm run dev:server` | Start Express server only |
| `npm run test:e2e` | Run automated E2E tests |
| `npm run build` | Build for production |

## Key Configurations

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript config |
| `vite.config.ts` | Vite bundler config |
| `tailwind.config.ts` | Tailwind CSS config |
| `docker-compose.external.yml` | Docker services |
