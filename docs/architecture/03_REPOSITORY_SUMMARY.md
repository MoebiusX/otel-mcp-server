# Krystaline Exchange Repository Summary

## Purpose

This is an **OpenTelemetry Context Propagation Proof of Concept (PoC)** demonstrating enterprise-grade distributed tracing in a microservices payment processing system.

The key demonstration is **Kong Gateway as a context injection point** for upstream systems that lack native tracing capability.

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────────┐
│   Frontend  │ ──▶ │ Kong Gateway │ ──▶ │ Payment API │ ──▶ │  RabbitMQ  │
│  (React)    │     │  (Port 8000) │     │ (Port 5000) │     │  (AMQP)    │
└─────────────┘     └──────────────┘     └─────────────┘     └────────────┘
       │                   │                    │                   │
       ▼                   ▼                    ▼                   ▼
  Generates or       Injects trace        Processes with      Async message
  sends headers        context           OTEL instrumentation   processing
```

---

## Tracing Infrastructure

### OTEL Collector Architecture

**Tempo serves as the OpenTelemetry Collector** in this setup:

```
┌─────────────────┐                    ┌─────────────────────────────────┐
│   Kong Gateway  │ ── OTLP HTTP ────▶ │                                 │
│  (Docker)       │    (4318)          │     Grafana Tempo               │
└─────────────────┘                    │     (OTEL Collector)            │
                                       │                                 │
┌─────────────────┐                    │   - OTLP gRPC: 4317             │
│   Payment API   │ ── OTLP HTTP ────▶ │   - OTLP HTTP: 4318             │
│  (Node.js)      │    (4318)          │   - Query API: 3200             │
└─────────────────┘                    │                                 │
                                       └─────────────────────────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────────┐
                                       │     Grafana Dashboard           │
                                       │     (Port 3000)                 │
                                       │     - Tempo datasource          │
                                       │     - Trace visualization       │
                                       └─────────────────────────────────┘
```

### Jaeger UI (Standalone)

> **Note**: In the current configuration, Jaeger runs as a standalone container with its own in-memory storage. It is **NOT connected to Tempo**. This means:
> - Jaeger UI (port 16686) shows traces sent **directly to Jaeger**
> - Currently, no services send spans to Jaeger directly
> - To use Jaeger as the primary trace backend, services would need to export to Jaeger's OTLP port (14317/14318)

### Configuration Files

| File | Purpose |
|------|---------|
| `server/otel.ts` | Node.js OTEL SDK - exports to `localhost:4318` (Tempo) |
| `tempo-config.yaml` | Tempo configuration with OTLP receivers on 4317/4318 |
| `grafana-datasources.yml` | Grafana datasource pointing to Tempo |
| `scripts/enable-kong-otel.js` | Configures Kong OTEL plugin → `host.docker.internal:4318` |

---

## Key Components

### Frontend (`client/`)
| File | Purpose |
|------|---------|
| `pages/Home.tsx` | Main payment form and trace visualization UI |
| `lib/queryClient.ts` | API client with **conditional routing** (Kong vs Direct) |
| `components/ui/*` | shadcn/ui component library |

### Backend (`server/`)
| File | Purpose |
|------|---------|
| `index.ts` | Express server entry point |
| `otel.ts` | **OpenTelemetry SDK** with dual exporters (local + Tempo) |
| `api/routes.ts` | Payment and trace API endpoints |
| `services/rabbitmq-client.ts` | RabbitMQ connection and messaging |
| `services/kong-client.ts` | Kong Gateway health check and service config |
| `core/payment-service.ts` | Payment processing business logic |

### Infrastructure (`docker-compose.external.yml`)
| Service | Port | Purpose |
|---------|------|---------|
| `kong-gateway` | 8000/8001 | API Gateway with OTEL plugin |
| `rabbitmq` | 5672/15672 | Message broker |
| `tempo` | **4317/4318**/3200 | **OTEL Collector** + Trace storage |
| `jaeger` | 16686 | Trace UI (standalone, not connected) |
| `grafana` | 3000 | Dashboards with Tempo datasource |

---

## Two Context Propagation Modes

### Mode 1: Empty Headers (Kong Injection)
1. Frontend sends request **without** trace headers
2. Kong Gateway detects missing context
3. Kong **generates new trace ID** and injects headers
4. Backend receives propagated context
5. Full trace visible in **Grafana/Tempo**

### Mode 2: Client Headers (Trace Continuation)
1. Frontend generates trace headers (`traceparent`, `x-trace-id`)
2. Request goes **directly to backend** (bypasses Kong)
3. Backend uses provided trace context
4. Trace visible in app's **local trace viewer**

---

## Data Flow

```
Payment Request
     │
     ├─► [Kong OTEL Plugin] ──► Tempo (4318)   ◄─── Kong spans
     │
     ├─► [Express Server] ──────► Tempo (4318)   ◄─── Backend spans
     │          │
     │          └─► [RabbitMQ] ──► Tempo         ◄─── Queue spans
     │
     └─► [In-Memory Collector] ──► /api/traces   ◄─── App Trace Viewer (local only)
```

---

## Viewing Traces

| Tool | URL | What You See |
|------|-----|--------------|
| **App Trace Viewer** | http://localhost:5000 | Local spans only (Node.js memory) |
| **Grafana/Tempo** | http://localhost:3000/explore | **Full distributed trace including Kong** |
| **Jaeger UI** | http://localhost:16686 | Empty (standalone, not fed by Tempo) |

> **To see Kong Gateway spans**: Use **Grafana → Explore → Tempo** and search by Trace ID.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Starts Docker services + application |
| `scripts/start-dev.js` | Unified startup orchestrator |
| `scripts/enable-kong-otel.js` | Configures Kong OTEL plugin to send to Tempo |
| `scripts/enable-kong-cors.js` | Configures Kong CORS plugin |

---

## Potential Improvements

1. **Connect Jaeger to Tempo**: Use Tempo's Jaeger-Query frontend or configure Jaeger to read from Tempo
2. **Add dedicated OTEL Collector**: Deploy `opentelemetry-collector` container for more flexible routing
3. **Unified trace backend**: Have all services export to a single collector that fans out to multiple backends
