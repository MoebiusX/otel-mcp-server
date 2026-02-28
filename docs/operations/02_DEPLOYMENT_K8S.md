# Kubernetes Deployment Guide

**Version:** 1.0  
**Last Updated:** February 3, 2026

---

## Prerequisites

- Kubernetes cluster (Docker Desktop, Minikube, or cloud-managed)
- Helm 3.x installed
- kubectl configured for your cluster
- Container registry access (default: `bizait-nas:5000`)

---

## Quick Start

```bash
# 1. Create namespace
kubectl create namespace krystalinex

# 2. Create secrets (see Secrets section below)
kubectl apply -f k8s/secrets.yaml -n krystalinex

# 3. Install with Helm
cd k8s/charts
helm install kx krystalinex -n krystalinex -f krystalinex/values-local.yaml

# 4. Verify deployment
kubectl get pods -n krystalinex
```

---

## Helm Chart Structure

```
k8s/charts/krystalinex/
├── Chart.yaml                    # Chart metadata (v0.1.0, appVersion 1.0.0)
├── values.yaml                   # Production values
├── values-local.yaml             # Local development values
└── templates/
    ├── _helpers.tpl              # Template helpers
    ├── configmaps.yaml           # OTEL collector config
    ├── secrets.yaml              # Secret templates
    ├── deployment-server.yaml    # Main API server
    ├── deployment-payment-processor.yaml
    ├── deployment-frontend.yaml
    ├── deployment-jaeger.yaml
    ├── deployment-otel-collector.yaml
    ├── deployment-prometheus.yaml
    ├── statefulset-postgresql.yaml
    ├── statefulset-rabbitmq.yaml
    ├── hpa.yaml                  # Horizontal Pod Autoscaler
    ├── ingress.yaml              # Ingress rules
    ├── networkpolicy.yaml        # Network policies
    └── pvc.yaml                  # Persistent volume claims
```

---

## Services Deployed

| Service | Port | Type | Description |
|---------|------|------|-------------|
| **server** | 5000 | ClusterIP | Main API server |
| **payment-processor** | 3001 | ClusterIP | RabbitMQ order consumer |
| **frontend** | 80 | ClusterIP | React SPA (nginx) |
| **postgresql** | 5432 | ClusterIP | App database |
| **rabbitmq** | 5672/15672 | ClusterIP | Message broker |
| **kong** | 8000/8001 | LoadBalancer | API Gateway |
| **jaeger** | 16686/4317/4318 | ClusterIP | Distributed tracing |
| **otel-collector** | 4318 | ClusterIP | OpenTelemetry collector |
| **prometheus** | 9090 | ClusterIP | Metrics |
| **maildev** | 1080/1025 | ClusterIP | Dev SMTP (optional) |

---

## Configuration

### Values Files

| File | Purpose |
|------|---------|
| `values.yaml` | Production defaults |
| `values-local.yaml` | Docker Desktop / Minikube dev |

### Key Configuration Options

```yaml
# values.yaml
server:
  replicaCount: 1          # Scale up for production
  image:
    repository: bizait-nas:5000/krystalinex/server
    tag: v1.0.9
  autoscaling:
    enabled: false         # Enable for production
    minReplicas: 1
    maxReplicas: 5
    targetCPUUtilizationPercentage: 70

ingress:
  enabled: true
  className: kong          # or nginx
  hosts:
    - host: krystalinex.local
      paths:
        - path: /
          service: frontend
        - path: /api
          service: server
```

---

## Secrets Management

### Development (values.yaml)

```yaml
secrets:
  create: true  # Creates secrets from values (dev only!)
```

### Production Options

1. **Sealed Secrets:**
   ```bash
   kubeseal --format yaml < secret.yaml > sealed-secret.yaml
   kubectl apply -f sealed-secret.yaml
   ```

2. **External Secrets Operator:**
   ```yaml
   secrets:
     externalSecrets:
       enabled: true
       secretStoreRef:
         name: vault-backend
         kind: ClusterSecretStore
   ```

### Required Secrets

| Secret Name | Keys |
|-------------|------|
| `krystalinex-secrets` | JWT_SECRET |
| `krystalinex-db-secrets` | postgres-password, password |
| `krystalinex-rabbitmq-secrets` | rabbitmq-password |
| `krystalinex-kong-secrets` | postgres-password, password |

---

## Common Operations

### Install / Upgrade

```bash
# Install
helm install kx ./krystalinex -n krystalinex

# Upgrade with new values
helm upgrade kx ./krystalinex -n krystalinex -f values-production.yaml

# Upgrade with specific image tag
helm upgrade kx ./krystalinex -n krystalinex --set server.image.tag=v1.0.10
```

### Scale

```bash
# Manual scaling
kubectl scale deployment kx-krystalinex-server --replicas=3 -n krystalinex

# Enable HPA (edit values.yaml and upgrade)
server:
  autoscaling:
    enabled: true
```

### View Logs

```bash
kubectl logs -f deployment/kx-krystalinex-server -n krystalinex
kubectl logs -f deployment/kx-krystalinex-payment-processor -n krystalinex
```

### Port Forwarding (Development)

```bash
# Access services locally
kubectl port-forward svc/kx-krystalinex-server 5000:5000 -n krystalinex
kubectl port-forward svc/kx-krystalinex-jaeger 16686:16686 -n krystalinex
kubectl port-forward svc/kx-krystalinex-prometheus 9090:9090 -n krystalinex
```

### Rollback

```bash
# View history
helm history kx -n krystalinex

# Rollback to previous
helm rollback kx 1 -n krystalinex
```

---

## Ingress Configuration

Default ingress routes (when `ingress.enabled: true`):

| Path | Service | Description |
|------|---------|-------------|
| `/` | frontend | React SPA |
| `/api/*` | server | API endpoints |

For local development, add to `/etc/hosts` (or Windows hosts file):
```
127.0.0.1 krystalinex.local
```

---

## Persistence

Persistent volumes are created for:

| Service | Size | Mount Path |
|---------|------|------------|
| postgresql | 10Gi | /bitnami/postgresql |
| rabbitmq | 5Gi | /bitnami/rabbitmq |
| prometheus | 10Gi | /prometheus |
| ollama (optional) | 20Gi | /root/.ollama |

---

## Network Policies

When `networkPolicy.enabled: true`, the following rules apply:

- Default deny all ingress
- Allow pod-to-pod communication within namespace
- Allow ingress controller access to frontend/server
- Allow server → postgresql, rabbitmq
- Allow payment-processor → rabbitmq
- Allow all → jaeger, otel-collector (observability)

---

## Troubleshooting

### Pods Not Starting

```bash
kubectl describe pod <pod-name> -n krystalinex
kubectl logs <pod-name> -n krystalinex --previous
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
kubectl get pods -l app.kubernetes.io/name=postgresql -n krystalinex

# Test connection
kubectl exec -it kx-krystalinex-postgresql-0 -n krystalinex -- psql -U exchange -d crypto_exchange
```

### Check All Resources

```bash
helm status kx -n krystalinex
kubectl get all -n krystalinex
```

---

## Uninstall

```bash
helm uninstall kx -n krystalinex
kubectl delete namespace krystalinex  # Removes all resources including PVCs
```

---

## Production Checklist

- [ ] Use external-secrets or sealed-secrets for credentials
- [ ] Set `server.replicaCount` ≥ 2
- [ ] Enable HPA for server and payment-processor
- [ ] Configure proper resource limits
- [ ] Set up TLS for ingress
- [ ] Use managed PostgreSQL/RabbitMQ or StatefulSet HA mode
- [ ] Configure proper network policies
- [ ] Set up log aggregation (Loki, ELK)
- [ ] Configure alerting (Alertmanager + ntfy/PagerDuty)
