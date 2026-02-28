# OpenTelemetry Payment PoC - Container Deployment Guide

## Prerequisites
- Docker and Docker Compose installed
- At least 4GB RAM available for containers
- Ports 5000, 8000, 5432, 16686 available

## Quick Start

1. **Clone and build the containers:**
```bash
git clone <repository-url>
cd opentelemetry-payment-poc
docker-compose up --build
```

2. **Access the services:**
- **Payment API**: http://localhost:5000
- **Kong Gateway**: http://localhost:8000  
- **Jaeger Tracing UI**: http://localhost:16686
- **PostgreSQL**: localhost:5432

## Container Architecture

### Services

1. **payment-api** (Port 5000)
   - Main Node.js application with React frontend
   - Handles payment processing and trace collection
   - Authentic OpenTelemetry instrumentation

2. **kong-gateway** (Port 8000)
   - API Gateway with context injection
   - Creates authentic Kong spans for distributed tracing
   - Proxies requests to payment-api

3. **postgres** (Port 5432)
   - PostgreSQL database for persistent storage
   - Auto-initialized with required schemas

4. **jaeger** (Port 16686)
   - Complete tracing backend
   - OpenTelemetry collector and UI
   - Stores and visualizes distributed traces

## Usage Examples

### Submit Payment (via Kong Gateway)
```bash
curl -X POST http://localhost:8000/api/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 999.99,
    "currency": "USD", 
    "recipient": "test@example.com",
    "description": "Container deployment test"
  }'
```

### Submit Payment (direct to API)
```bash
curl -X POST http://localhost:5000/api/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 750.00,
    "currency": "USD",
    "recipient": "direct@example.com", 
    "description": "Direct API test"
  }'
```

### View Traces
- **Application UI**: http://localhost:5000 (or http://localhost:8000)
- **Jaeger UI**: http://localhost:16686

## Authentic Spans Generated

The system creates these authentic OpenTelemetry spans:

1. **Kong Gateway Spans**
   - `kong-gateway-processing` - API gateway request handling
   - Attributes: `http.method`, `kong.service`, `kong.route`

2. **HTTP Request Spans** 
   - `POST` / `DELETE` - Auto-instrumented HTTP operations
   - Full HTTP attributes from OpenTelemetry SDK

3. **JMS Message Spans**
   - `jms-message-publish` - Message broker publishing
   - `jms-message-consume` - Message queue consumption
   - Attributes: `messaging.system`, `messaging.destination`

## Development vs Production

### Development (Local)
- In-memory storage
- Single process
- Hot reloading via Vite

### Production (Containers)
- PostgreSQL persistence
- Multi-container architecture
- Production builds
- Health checks and monitoring

## Troubleshooting

### Container Issues
```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs payment-api
docker-compose logs kong-gateway

# Restart services
docker-compose restart
```

### Database Issues
```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U payment_user -d payment_poc

# Reset database
docker-compose down -v
docker-compose up --build
```

### Network Issues
```bash
# Test service connectivity
docker-compose exec payment-api curl http://kong-gateway:8000/health
docker-compose exec kong-gateway curl http://payment-api:5000/api/payments
```

## Environment Variables

### payment-api
- `NODE_ENV=production`
- `DATABASE_URL=postgresql://...`
- `OTEL_SERVICE_NAME=payment-api`
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:14268/api/traces`

### kong-gateway
- `BACKEND_URL=http://payment-api:5000`

## Monitoring and Observability

1. **Application Metrics**: Built into the dashboard at http://localhost:5000
2. **Distributed Tracing**: Jaeger UI at http://localhost:16686
3. **Health Checks**: All services include health endpoints
4. **Container Logs**: Available via `docker-compose logs`

## Production Considerations

- Use external PostgreSQL for production workloads
- Configure Jaeger with persistent storage
- Set up proper TLS certificates for Kong Gateway
- Configure resource limits and monitoring alerts
- Use container orchestration (Kubernetes) for scaling