# KrystalineX Operational Runbook

**Version:** 1.0  
**Last Updated:** February 1, 2026  
**On-Call Escalation:** GoAlert → Slack → Phone

---

## Table of Contents

1. [Quick Reference](#1-quick-reference)
2. [Service Overview](#2-service-overview)
3. [Health Checks](#3-health-checks)
4. [Common Operations](#4-common-operations)
5. [Incident Response](#5-incident-response)
6. [Troubleshooting Guide](#6-troubleshooting-guide)
7. [Scaling Procedures](#7-scaling-procedures)
8. [Backup & Recovery](#8-backup--recovery)
9. [Deployment Procedures](#9-deployment-procedures)
10. [Contact Information](#10-contact-information)
11. [Mobile Notifications (ntfy)](#11-mobile-notifications-ntfy)

---

## 1. Quick Reference

### Critical URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Application | http://localhost:5000 | Main API |
| Kong Gateway | http://localhost:8000 | API Gateway |
| Kong Admin | http://localhost:8001 | Gateway Admin |
| Jaeger UI | http://localhost:16686 | Distributed Tracing |
| Prometheus | http://localhost:9090 | Metrics |
| RabbitMQ Admin | http://localhost:15672 | Message Queue |
| GoAlert | http://localhost:8081 | Incident Management |
| MailDev | http://localhost:1080 | Email Testing |

### Critical Commands

```bash
# Check all services
docker-compose ps

# View logs (last 100 lines, follow)
docker-compose logs -f --tail=100 <service-name>

# Restart a service
docker-compose restart <service-name>

# Check Kubernetes pods
kubectl -n krystalinex get pods

# Scale deployment
kubectl -n krystalinex scale deployment <name> --replicas=<n>

# Helm status
helm status kx -n krystalinex
```

---

## 2. Service Overview

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│    Kong     │────▶│   Server    │
│  (Browser)  │     │  Gateway    │     │  (Express)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
             ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
             │  RabbitMQ   │           │ PostgreSQL  │           │   Jaeger    │
             │  (Orders)   │           │  (Data)     │           │  (Traces)   │
             └──────┬──────┘           └─────────────┘           └─────────────┘
                    │
                    ▼
             ┌─────────────┐
             │  Payment    │
             │  Processor  │
             └─────────────┘
```

### Service Dependencies

| Service | Depends On | Critical? |
|---------|------------|-----------|
| server | PostgreSQL, RabbitMQ | Yes |
| payment-processor | RabbitMQ | Yes |
| kong-gateway | kong-database | Yes |
| frontend | server | No (static) |
| jaeger | - | No (observability) |
| prometheus | - | No (monitoring) |

---

## 3. Health Checks

### Endpoint Reference

| Endpoint | Expected Response | Indicates |
|----------|-------------------|-----------|
| `GET /health` | `200 OK` | Liveness - app is running |
| `GET /ready` | `200 OK` | Readiness - can serve traffic |
| `GET /api/health/trading` | `200 OK` + JSON | Trading system operational |
| `GET /metrics` | Prometheus format | Metrics available |

### Automated Health Check Script

```bash
#!/bin/bash
# health-check.sh

ENDPOINTS=(
  "http://localhost:5000/health"
  "http://localhost:5000/ready"
  "http://localhost:8000/health"
  "http://localhost:3001/health"
)

for url in "${ENDPOINTS[@]}"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 5)
  if [ "$status" = "200" ]; then
    echo "✅ $url - OK"
  else
    echo "❌ $url - FAILED ($status)"
  fi
done
```

### Kubernetes Health Check

```bash
# Check all pod statuses
kubectl -n krystalinex get pods -o wide

# Check recent events
kubectl -n krystalinex get events --sort-by='.lastTimestamp' | tail -20

# Describe failing pod
kubectl -n krystalinex describe pod <pod-name>
```

---

## 4. Common Operations

### 4.1 Restart Services

#### Docker Compose
```bash
# Restart single service
docker-compose restart server

# Restart all services
docker-compose restart

# Full restart (stop, remove, recreate)
docker-compose down && docker-compose up -d
```

#### Kubernetes
```bash
# Rolling restart deployment
kubectl -n krystalinex rollout restart deployment kx-krystalinex-server

# Check rollout status
kubectl -n krystalinex rollout status deployment kx-krystalinex-server

# Rollback if needed
kubectl -n krystalinex rollout undo deployment kx-krystalinex-server
```

### 4.2 View Logs

#### Docker Compose
```bash
# All services
docker-compose logs -f --tail=100

# Specific service
docker-compose logs -f server

# Filter errors
docker-compose logs server 2>&1 | grep -i error
```

#### Kubernetes
```bash
# Current logs
kubectl -n krystalinex logs -f deployment/kx-krystalinex-server

# Previous container (after crash)
kubectl -n krystalinex logs <pod-name> --previous

# All pods for deployment
kubectl -n krystalinex logs -l app.kubernetes.io/name=server
```

### 4.3 Database Operations

```bash
# Connect to PostgreSQL
docker-compose exec app-database psql -U exchange -d crypto_exchange

# Or for Kubernetes
kubectl -n krystalinex exec -it kx-krystalinex-postgresql-0 -- psql -U exchange -d crypto_exchange

# Common queries
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM orders WHERE status = 'pending';
SELECT * FROM wallets WHERE balance_usd < 0;  -- Should be empty!
```

### 4.4 RabbitMQ Operations

```bash
# List queues
docker-compose exec rabbitmq rabbitmqctl list_queues

# Purge a queue (CAUTION)
docker-compose exec rabbitmq rabbitmqctl purge_queue orders

# Check connections
docker-compose exec rabbitmq rabbitmqctl list_connections
```

---

## 5. Incident Response

### Severity Levels

| Level | Definition | Response Time | Examples |
|-------|------------|---------------|----------|
| **SEV1** | Complete outage | 15 min | All services down, data loss |
| **SEV2** | Major degradation | 30 min | Trading halted, auth broken |
| **SEV3** | Minor degradation | 2 hours | Slow performance, partial features |
| **SEV4** | Low impact | Next business day | UI bugs, non-critical errors |

### Incident Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Alert     │────▶│  GoAlert    │────▶│  On-Call    │
│  Triggered  │     │  Escalation │     │  Engineer   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
        ┌──────────────────────────────────────┤
        ▼                                      ▼
┌─────────────┐                        ┌─────────────┐
│  Diagnose   │                        │  Mitigate   │
│  (Jaeger,   │                        │  (Restart,  │
│   Logs)     │                        │   Scale)    │
└──────┬──────┘                        └──────┬──────┘
       │                                      │
       └──────────────────┬───────────────────┘
                          ▼
                   ┌─────────────┐
                   │  Post-      │
                   │  Mortem     │
                   └─────────────┘
```

### Incident Checklist

- [ ] Acknowledge alert in GoAlert
- [ ] Join incident Slack channel
- [ ] Check service health endpoints
- [ ] Review Jaeger traces for errors
- [ ] Check Prometheus metrics/dashboards
- [ ] Review recent deployments
- [ ] Implement mitigation
- [ ] Communicate status updates
- [ ] Document root cause
- [ ] Schedule post-mortem

---

## 6. Troubleshooting Guide

### 6.1 Service Won't Start

**Symptoms:** Pod in CrashLoopBackOff, container exits immediately

**Diagnosis:**
```bash
# Check logs
kubectl -n krystalinex logs <pod-name> --previous

# Check events
kubectl -n krystalinex describe pod <pod-name>
```

**Common Causes:**
| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED` to DB | Database not ready | Wait or restart DB |
| `Invalid JWT_SECRET` | Missing env var | Check secrets |
| `Port already in use` | Port conflict | Check other services |

### 6.2 High Latency

**Symptoms:** Response times > 1s, user complaints

**Diagnosis:**
```bash
# Check Jaeger for slow traces
open http://localhost:16686

# Check Prometheus
# Query: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
```

**Common Causes:**
| Pattern | Cause | Solution |
|---------|-------|----------|
| DB spans slow | Missing indexes | Add indexes |
| RabbitMQ backup | Consumer lag | Scale consumers |
| External API | Third-party slow | Check circuit breaker |

### 6.3 RabbitMQ Queue Backup

**Symptoms:** Orders not processing, queue depth growing

**Diagnosis:**
```bash
# Check queue depth
curl -s -u admin:$RABBITMQ_PASSWORD \
  http://localhost:15672/api/queues/%2F/orders | jq '.messages'
```

**Resolution:**
```bash
# Scale payment processor
kubectl -n krystalinex scale deployment kx-krystalinex-payment-processor --replicas=3

# Or restart if stuck
kubectl -n krystalinex rollout restart deployment kx-krystalinex-payment-processor
```

### 6.4 Database Connection Exhausted

**Symptoms:** `too many connections` errors

**Diagnosis:**
```sql
SELECT count(*) FROM pg_stat_activity;
SELECT * FROM pg_stat_activity WHERE state = 'idle';
```

**Resolution:**
```sql
-- Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
  AND query_start < now() - interval '10 minutes';
```

### 6.5 Out of Memory

**Symptoms:** OOMKilled, container restarts

**Diagnosis:**
```bash
kubectl -n krystalinex describe pod <pod-name> | grep -A5 "Last State"
```

**Resolution:**
```bash
# Increase memory limits in values.yaml
server:
  resources:
    limits:
      memory: 1Gi  # Increase from 512Mi
```

---

## 7. Scaling Procedures

### 7.1 Horizontal Scaling

```bash
# Scale server (stateless)
kubectl -n krystalinex scale deployment kx-krystalinex-server --replicas=3

# Scale payment processor
kubectl -n krystalinex scale deployment kx-krystalinex-payment-processor --replicas=2

# Verify
kubectl -n krystalinex get pods -l app.kubernetes.io/name=server
```

### 7.2 Vertical Scaling

Edit Helm values and upgrade:
```yaml
# values.yaml
server:
  resources:
    limits:
      cpu: 1000m      # Increase from 500m
      memory: 1Gi     # Increase from 512Mi
    requests:
      cpu: 250m
      memory: 512Mi
```

```bash
helm upgrade kx ./k8s/charts/krystalinex -n krystalinex -f values-production.yaml
```

### 7.3 Database Scaling

PostgreSQL read replicas (if needed):
```yaml
# values.yaml
postgresql:
  architecture: replication
  readReplicas:
    replicaCount: 2
```

---

## 8. Backup & Recovery

### 8.1 Database Backup

#### Manual Backup
```bash
# Docker Compose
docker-compose exec app-database pg_dump -U exchange crypto_exchange > backup_$(date +%Y%m%d_%H%M%S).sql

# Kubernetes
kubectl -n krystalinex exec kx-krystalinex-postgresql-0 -- \
  pg_dump -U exchange crypto_exchange > backup_$(date +%Y%m%d_%H%M%S).sql
```

#### Scheduled Backup (CronJob)
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: krystalinex
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:15
            command:
            - /bin/sh
            - -c
            - pg_dump -h kx-krystalinex-postgresql -U exchange crypto_exchange | gzip > /backup/db_$(date +%Y%m%d).sql.gz
          restartPolicy: OnFailure
```

### 8.2 Database Recovery

```bash
# Stop application
kubectl -n krystalinex scale deployment kx-krystalinex-server --replicas=0

# Restore
kubectl -n krystalinex exec -i kx-krystalinex-postgresql-0 -- \
  psql -U exchange crypto_exchange < backup_20260201.sql

# Restart application
kubectl -n krystalinex scale deployment kx-krystalinex-server --replicas=1
```

### 8.3 Disaster Recovery

| Scenario | RTO | RPO | Procedure |
|----------|-----|-----|-----------|
| Pod failure | 1 min | 0 | Auto-restart by K8s |
| Node failure | 5 min | 0 | Pod rescheduling |
| DB corruption | 30 min | 24h | Restore from backup |
| Region failure | 4 hrs | 24h | Failover to DR region |

---

## 9. Deployment Procedures

### 9.1 Standard Deployment

```bash
# 1. Build new images
docker build -t krystalinex/server:v1.0.10 -f server/Dockerfile.prod .

# 2. Push to registry
docker push krystalinex/server:v1.0.10

# 3. Update values.yaml
server:
  image:
    tag: v1.0.10

# 4. Deploy
helm upgrade kx ./k8s/charts/krystalinex -n krystalinex

# 5. Verify
kubectl -n krystalinex rollout status deployment kx-krystalinex-server
```

### 9.2 Rollback

```bash
# Helm rollback
helm rollback kx 3 -n krystalinex  # Roll back to revision 3

# Or Kubernetes rollback
kubectl -n krystalinex rollout undo deployment kx-krystalinex-server
```

### 9.3 Canary Deployment

```bash
# Deploy canary with 10% traffic
kubectl -n krystalinex set image deployment/kx-krystalinex-server-canary \
  server=krystalinex/server:v1.0.10

# Monitor error rates in Prometheus
# If OK, promote to full deployment
```

---

## 10. Contact Information

### On-Call Rotation

| Week | Primary | Secondary |
|------|---------|-----------|
| Current | Check GoAlert | Check GoAlert |

### Escalation Path

1. **L1 - On-Call Engineer** (15 min response)
   - Via GoAlert notification
   
2. **L2 - Team Lead** (30 min response)
   - If L1 cannot resolve within 30 min
   
3. **L3 - Architecture Team** (1 hour response)
   - Database issues, infrastructure changes

### External Contacts

| Service | Contact | SLA |
|---------|---------|-----|
| Cloud Provider | support@cloud.example | 24/7 |
| Domain/DNS | support@registrar.example | Business hours |

---

## Appendix A: Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | development | Environment mode |
| `PORT` | No | 5000 | Server port |
| `JWT_SECRET` | Yes | - | JWT signing key |
| `DB_HOST` | Yes | localhost | PostgreSQL host |
| `DB_PASSWORD` | Yes | - | Database password |
| `RABBITMQ_URL` | Yes | - | RabbitMQ connection |

## Appendix B: Useful Queries

### Prometheus Queries

```promql
# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])

# P99 latency
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# Active connections
pg_stat_activity_count{state="active"}

# RabbitMQ queue depth
rabbitmq_queue_messages{queue="orders"}
```

---

## 11. Mobile Notifications (ntfy)

Free mobile push notifications via [ntfy.sh](https://ntfy.sh) integrated with GoAlert.

### Setup (5 minutes)

#### Step 1: Install ntfy App

| Platform | Link |
|----------|------|
| Android | [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy) |
| iOS | [App Store](https://apps.apple.com/app/ntfy/id1625396347) |
| Web | https://ntfy.sh |

#### Step 2: Generate Topic Name

```bash
# Generate a random topic (this is your "password" - keep it secret)
openssl rand -hex 8
# Example output: a1b2c3d4e5f6g7h8

# Your topic URL: https://ntfy.sh/krystalinex-alerts-a1b2c3d4e5f6g7h8
```

#### Step 3: Subscribe in App

1. Open ntfy app on your phone
2. Tap **+** (Add subscription)
3. Enter topic: `krystalinex-alerts-YOUR_RANDOM_STRING`
4. Tap **Subscribe**

#### Step 4: Configure GoAlert Webhook

1. Log in to GoAlert (http://localhost:8081)
2. Go to **Users** → Select your profile
3. Scroll to **Contact Methods** → **Add Contact Method**
4. Set:
   - **Type:** Webhook
   - **Name:** Mobile (ntfy)
   - **URL:** 
     ```
     https://ntfy.sh/YOUR_TOPIC?tpl=yes&title=🚨+KrystalineX+Alert&message={{.Summary}}&priority=high&tags=warning
     ```
5. Click **Submit**

#### Step 5: Add to Escalation Policy

1. Go to **Escalation Policies** → Select your policy
2. Add your user with the **Webhook** contact method
3. Set notification to **Immediately**

### Test Notification

```bash
# Quick test (replace YOUR_TOPIC)
curl -X POST "https://ntfy.sh/YOUR_TOPIC" \
  -H "Title: 🧪 Test Alert" \
  -H "Priority: high" \
  -H "Tags: test" \
  -d "If you see this, ntfy is working!"
```

### Priority Mapping

| Severity | ntfy Priority | Phone Behavior |
|----------|--------------|----------------|
| critical | `urgent` | Loud alarm, bypass DND |
| warning | `high` | Normal notification sound |
| info | `default` | Standard notification |
| resolved | `low` | Silent/grouped |

### Alertmanager Integration

Alerts automatically flow: **Prometheus** → **Alertmanager** → **GoAlert** + **ntfy**

Critical alerts are sent to both GoAlert and ntfy for redundancy. See [config/alertmanager.yml](../config/alertmanager.yml).

### Troubleshooting ntfy

| Issue | Solution |
|-------|----------|
| No notifications | Check topic name matches exactly |
| Delayed notifications | iOS may batch; check battery optimization |
| Too many alerts | Adjust Alertmanager `group_wait` / `repeat_interval` |
| Want self-hosted | Run `docker run -p 8080:80 binwiederhier/ntfy serve` |

### Database Queries

```sql
-- Active orders
SELECT COUNT(*), status FROM orders GROUP BY status;

-- Recent errors
SELECT * FROM audit_log WHERE level = 'error' ORDER BY created_at DESC LIMIT 20;

-- User activity
SELECT DATE(created_at), COUNT(*) FROM users GROUP BY DATE(created_at);
```
