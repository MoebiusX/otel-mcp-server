# KrystalineX Deployment Runbook

Audience: SRE / platform engineers.
Scope: deploy, verify, and roll back KrystalineX via Docker Compose (demo/dev) or Kubernetes (staging/prod). Includes observability smoke tests.

## 0) Prerequisites
- Secrets: DB, Kong, RabbitMQ, JWT, email, Goalert, OTEL endpoints; provide via env files or secret stores (Vault/Kubernetes Secrets).
- Images: ensure tagged images are available (or build locally for compose):
  - kong/kong-gateway:latest
  - postgres:15 (app DB) and postgres:13 (kong)
  - rabbitmq:3.12-management
  - jaegertracing/all-in-one:latest
  - otel/opentelemetry-collector-contrib:latest
  - prom/prometheus:latest, prom/alertmanager:latest
  - app images if containerized (server, payment-processor, client)
- Ports free on host (compose): 8000/8001/8002/8003/8081/9090/9093/9100/9187/9188/11434/14350/15672/15692/16686/4317/4318/4319.
- Migrations: kong-migrations job runs automatically; app DB is pre-seeded via db/init.sql (compose). For k8s, ensure migrations job is run before traffic.

## 1) Docker Compose (demo/dev)
1. Export env vars (example):
   ```bash
   export DB_PASSWORD=... DB_USER=exchange DB_NAME=crypto_exchange
   export KONG_PG_PASSWORD=... KONG_PG_USER=kong KONG_PG_DATABASE=kong
   export RABBITMQ_PASSWORD=... RABBITMQ_USER=admin
   export GOALERT_DB_PASSWORD=... GOALERT_ENCRYPTION_KEY=...
   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4319
   ```
2. Start infra stack:
   ```bash
   docker compose up -d kong-database kong-migrations kong-gateway \
     app-database rabbitmq jaeger otel-collector prometheus alertmanager \
     postgres-exporter kong-postgres-exporter node-exporter goalert-db goalert maildev
   ```
3. Start app services (host-run per repo guidance):
   ```bash
   npm install
   npm run dev:server      # backend
   npm run dev:payments    # payment-processor if applicable
   npm run dev:client      # frontend
   ```
4. Health checks:
   - API: curl http://localhost:3000/health and /ready
   - Kong: curl http://localhost:8001/status
   - RabbitMQ UI: http://localhost:15672 (prom plugin on 15692)
   - Jaeger UI: http://localhost:16686
   - Prometheus: http://localhost:9090
   - Alertmanager: http://localhost:9093
   - Goalert: http://localhost:8081/health
5. Observability smoke (manual):
   - Send a sample trade request; confirm span appears in Jaeger and metrics increment (http_requests_total, http_request_duration_seconds).
   - Check logs carry correlation/request IDs.
   - Verify OTLP collector ready: curl http://localhost:13133/ (health ext on collector image).
6. Rollback: `docker compose down` then restart previous known-good images; for app services, revert to prior tag/commit and restart processes.

## 2) Kubernetes (staging/prod)
1. Namespace and secrets:
   ```bash
   kubectl create namespace kx || true
   kubectl apply -n kx -f k8s/secrets.yaml   # or create via secret store
   ```
2. Deploy infra (example order):
   ```bash
   kubectl apply -n kx -f k8s/postgres.yaml
   kubectl apply -n kx -f k8s/rabbitmq.yaml
   kubectl apply -n kx -f k8s/kong.yaml      # includes migrations job
   kubectl apply -n kx -f k8s/otel-gateway.yaml
   kubectl apply -n kx -f k8s/otel-agent.yaml
   kubectl apply -n kx -f k8s/jaeger.yaml
   kubectl apply -n kx -f k8s/prometheus.yaml
   kubectl apply -n kx -f k8s/alertmanager.yaml
   ```
   (Adjust to your charts/kustomize if present.)
3. Deploy apps (example):
   ```bash
   kubectl apply -n kx -f k8s/server.yaml
   kubectl apply -n kx -f k8s/payment-processor.yaml
   kubectl apply -n kx -f k8s/client.yaml
   ```
4. Verify pods:
   ```bash
   kubectl get pods -n kx
   kubectl logs -n kx deploy/server --tail=50
   kubectl get svc -n kx
   ```
5. Health checks:
   - Readiness/liveness probes should hit /health and /ready.
   - Kong admin status: port-forward admin service and curl /status.
   - DB and RabbitMQ state via exporters (Prom targets up).
6. Observability smoke (cluster):
   - Port-forward Jaeger UI and Prometheus; ensure new requests show spans/metrics.
   - Confirm OTEL collector gateway is receiving from agents (check metrics pipeline up in Prom).
   - Validate Alertmanager is up and silence test alert if needed.
7. Rollback:
   - Roll deployment to previous ReplicaSet: `kubectl rollout undo deploy/server -n kx` (repeat per service).
   - If infra change caused issue, revert manifests/Helm release to prior version.

## 3) Post-deploy validation checklist
- API: /health and /ready return 200; key routes (login, trade quote, order submit) return expected responses.
- Traces: one end-to-end trace per test action visible in Jaeger; spans include service.name and env.
- Metrics: http_requests_total increments; latency histograms present; exporters up in Prom targets.
- Logs: contain request IDs and, when available, trace IDs; no PII beyond hashed IDs.
- Alerts: no firing critical alerts; test burn-rate alert can be silenced after validation.

## 4) Common issues and fixes
- Ports in use (compose): stop conflicting services or remap exposed ports.
- Env vars missing: services fail fast; check docker compose logs or pod events for missing secrets.
- OTEL exporter failures: verify OTEL_EXPORTER_OTLP_ENDPOINT reachability and collector health endpoint.
- Kong migrations fail: ensure kong-database is healthy before migrations; rerun migrations job.
- RabbitMQ perms: ensure credentials align between app and broker; check management UI for connections.

## 5) Observability smoke scripts (optional/manual)
- Simple request + trace check:
  ```bash
  curl -X GET http://localhost:3000/api/health
  # then confirm trace in Jaeger UI (or via API if available)
  ```
- Metrics probe:
  ```bash
  curl -s http://localhost:3000/metrics | grep http_requests_total | head
  ```
- Collector health:
  ```bash
  curl -f http://localhost:13133/ || exit 1
  ```

## 6) Acceptance to mark release green
- Successful health/readiness across services
- Observability smoke passes: trace + metric + log seen for a sample request
- No critical alerts after a 10-minute soak
- Rollback plan validated (previous ReplicaSet present or prior compose images available)
