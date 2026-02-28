# External Services Setup for Authentic OpenTelemetry

This document provides instructions for running real Kong Gateway and RabbitMQ services to generate authentic OpenTelemetry spans.

## Quick Start with Docker Compose

```bash
# Start Kong Gateway, RabbitMQ, and Jaeger
docker-compose -f docker-compose.external.yml up -d

# Wait for services to initialize (30-60 seconds)
docker-compose -f docker-compose.external.yml logs -f kong-gateway

# Verify services are running
curl http://localhost:8001/status  # Kong Admin API
curl http://localhost:15672        # RabbitMQ Management UI
curl http://localhost:16686        # Jaeger UI
```

## Service Endpoints

### Kong Gateway
- **Proxy**: http://localhost:8000
- **Admin API**: http://localhost:8001
- **Manager UI**: http://localhost:8002

### RabbitMQ
- **AMQP**: amqp://admin:admin123@localhost:5672
- **Management UI**: http://localhost:15672 (admin/admin123)

### Jaeger (Optional)
- **UI**: http://localhost:16686
- **OTLP HTTP**: http://localhost:4318
- **OTLP gRPC**: http://localhost:4317

## Environment Variables

Set these in your .env file:

```bash
# Kong Gateway Configuration
KONG_GATEWAY_URL=http://localhost:8000
KONG_ADMIN_URL=http://localhost:8001

# RabbitMQ Configuration
RABBITMQ_URL=amqp://admin:admin123@localhost:5672

# Jaeger (Optional)
JAEGER_ENDPOINT=http://localhost:4318/v1/traces
```

## Payment Flow with External Services

1. **Client Request** → **Kong Gateway** (authentic Kong spans)
2. **Kong Gateway** → **Express API** (HTTP proxy spans)
3. **Express API** → **RabbitMQ Queue** (AMQP publish spans)
4. **RabbitMQ Consumer** → **Console Output** (AMQP consume spans)

## Testing Authentic OpenTelemetry

### Via Kong Gateway
```bash
# Route payment through Kong Gateway
curl -X POST http://localhost:8000/api/payments \
  -H "Content-Type: application/json" \
  -H "x-trace-id: $(openssl rand -hex 16)" \
  -d '{"amount": 2500, "currency": "USD", "recipient": "kong@example.com", "description": "Kong Gateway Test"}'
```

### Direct to API (bypassing Kong)
```bash
# Direct API call
curl -X POST http://localhost:5000/api/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 1500, "currency": "USD", "recipient": "direct@example.com", "description": "Direct API Test"}'
```

## Monitoring

- **Kong Logs**: `docker-compose -f docker-compose.external.yml logs kong-gateway`
- **RabbitMQ Logs**: `docker-compose -f docker-compose.external.yml logs rabbitmq`
- **Jaeger Traces**: http://localhost:16686
- **Application Console**: Shows RabbitMQ message consumption

## Cleanup

```bash
# Stop and remove all services
docker-compose -f docker-compose.external.yml down -v
```

## Troubleshooting

### Kong Gateway Not Available
- Check if port 8000/8001 are free
- Verify database initialization completed: `docker-compose logs kong-migrations`

### RabbitMQ Connection Failed
- Check if port 5672 is free
- Verify credentials: admin/admin123

### No Traces in Jaeger
- Ensure JAEGER_ENDPOINT is configured
- Check if port 4318 is accessible

This setup provides authentic OpenTelemetry instrumentation from real enterprise services.