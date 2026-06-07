# otel-mcp-server

[![CI](https://github.com/MoebiusX/otel-mcp-server/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/MoebiusX/otel-mcp-server/actions/workflows/ci.yml)
[![Live Docker Tests](https://github.com/MoebiusX/otel-mcp-server/actions/workflows/live-test.yml/badge.svg)](https://github.com/MoebiusX/otel-mcp-server/actions/workflows/live-test.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that exposes your **OpenTelemetry** observability stack — traces, metrics, logs, and more — as tools for AI agents. Built on a **Skill** plugin architecture for easy extensibility.

> Give any LLM agent the ability to query your Jaeger traces, run PromQL, search Loki logs, and investigate production issues — through a standard protocol.

```
┌─────────────────┐      MCP     ┌──────────────────┐──► Traces (Jaeger · Zipkin · Tempo · SkyWalking)
│  Claude Desktop │ ◄──────────► │                  │──► Prometheus · InfluxDB · OpenTSDB
│  GitHub Copilot │ (stdio/HTTP) │  otel-mcp-server │──► Loki · ClickHouse · Graylog (logs)
│  Custom Agent   │              │                  │──► Pinpoint · Elasticsearch · Alertmanager
└─────────────────┘              │   24 skills      │──► Grafana · Pyroscope · OPA
                                 │   106 tools      │──► Cilium · Kubernetes (eBPF/CRDs)
                                 │   authenticated  │──► Envoy · Consul · Kong · Traefik
                                 └──────────────────┘──► Fluent Bit · Beats · Vector · Alloy
                                                     └─► App API    (ZK/system)
```

## Example

> *"What's running, what's healthy, and what needs attention?"* — answered in seconds by an AI agent using this MCP server against a local Docker Compose stack:

![MCP server exploring a local observability stack — showing Jaeger, Prometheus, and Loki backend status, active alerts, and key findings](docs/sample.png)

> *"Tell me what happened to order ORD-1774382223417-7"* — full distributed trace across 4 services, 40 spans, with ZK proof verification:

![Order tracing across gateway, exchange, matcher, and wallet services — showing timeline, fill price, latency breakdown, and Groth16 ZK proof verification](docs/sample2.png)

> *"What about the k8s cluster?"* 

![Health check across the cluster](docs/sample3.png)

## Features

- **110 tools** across 25 skills — a provider-agnostic `traces` layer (Jaeger/Zipkin/Tempo/SkyWalking via `TRACES_PROVIDER`), metrics (Prometheus/InfluxDB/OpenTSDB), logs (Loki/ClickHouse/Graylog), Pinpoint, Elasticsearch, Alertmanager, vmalert rule evaluation, Grafana, Cilium, Kubernetes, Pyroscope, OPA, service mesh (Envoy/Consul/Kong/Traefik), collection pipelines (Fluent Bit/Beats/Vector/Alloy), AgentRelay agent coordination, ZK proofs, system health, public exchange transparency
- **Skill plugin architecture** — each backend is a self-contained plugin; add new ones with a single file
- **Two transports** — stdio (Claude Desktop, Copilot) and HTTP (remote, multi-client)
- **Two-layer auth** — backend credentials (Bearer/Basic/custom headers per backend) and client API keys (env var, mounted file, or local file)
- **Selective skills** — enable only the skills you need (`--tools traces,metrics,logs`)
- **Multi-version aware** — a typed `capability → product → protocol-adapter` model tracks which versions and protocol features each backend supports; runtime detection surfaces live product/version on `/health`, and `MCP_VERSION_GATING` (`off`/`warn`/`enforce`) can guard version-sensitive features (unknown versions always pass optimistically)
- **Multi-backend & failover** — a single skill can address multiple named instances and fail over across replicas; tools accept an optional SSRF-safe `target` argument (see [Multi-backend instances & failover](#multi-backend-instances--failover))
- **Self-metrics** — `GET /metrics` endpoint with tool call counts, backend latencies, auth attempts
- **Container-native** — env-var config, K8s Secret mounting, multi-stage Dockerfile
- **Zero dependencies** beyond the MCP SDK and Zod

For role-based Studio workflows, see [docs/studio-user-journeys.md](docs/studio-user-journeys.md).

## Quick Start

### Install

Run directly with `npx` (no clone or build needed):

```bash
npx -y @moebiusx/otel-mcp-server
```

Or install globally:

```bash
npm install -g @moebiusx/otel-mcp-server
otel-mcp-server
```

<details>
<summary>Build from source (for development)</summary>

```bash
git clone https://github.com/MoebiusX/otel-mcp-server.git
cd otel-mcp-server
npm install
npm run build
```

</details>

### Run (stdio — for Claude Desktop / Copilot)

```bash
# Point at your backends
export JAEGER_URL=http://localhost:16686
export PROMETHEUS_URL=http://localhost:9090
export LOKI_URL=http://localhost:3100

node dist/index.js
```

### Run (HTTP — for remote agents / containers)

```bash
node dist/index.js --http 3001
# ✓ otel-mcp-server v1.4.0 listening on http://0.0.0.0:3001
#   Skills:
#     ✓ traces         — Distributed Traces (5 tools) [Jaeger]
#     ✓ metrics        — Prometheus Metrics (6 tools) [Prometheus]
#     ✓ logs           — Structured Logs (4 tools) [Loki]
#     ✓ zk-proofs      — ZK Proofs (4 tools) [App API]
#     ✓ system         — System Health (4 tools) [App API, Jaeger]
```

### Docker

```bash
docker build -t otel-mcp-server .
docker run -p 3001:3001 \
  -e JAEGER_URL=http://jaeger:16686 \
  -e PROMETHEUS_URL=http://prometheus:9090 \
  -e LOKI_URL=http://loki:3100 \
  -e ELASTICSEARCH_URL=http://elasticsearch:9200 \
  -e ALERTMANAGER_URL=http://alertmanager:9093 \
  -e GRAFANA_URL=http://grafana:3000 \
  -e GRAFANA_AUTH_TOKEN=glsa_xxx \
  -e MCP_AUTH_KEYS='{"keys":[{"id":"agent-1","key":"sk-my-secret-key"}]}' \
  otel-mcp-server
```

## Configuration

All configuration is via environment variables. The commonly used backend, auth, and runtime variables are listed below.

### Backend URLs

| Variable | Default | Description |
|----------|---------|-------------|
| `TRACES_PROVIDER` | `jaeger` | Trace backend selector — one of `jaeger`, `tempo`, `zipkin`, `skywalking` |
| `JAEGER_URL` / `TRACES_JAEGER_URL` | `http://localhost:16686` | Jaeger Query API (used when `TRACES_PROVIDER=jaeger`) |
| `TEMPO_URL` / `TRACES_TEMPO_URL` | `http://localhost:3200` | Grafana Tempo (used when `TRACES_PROVIDER=tempo`) |
| `ZIPKIN_URL` / `TRACES_ZIPKIN_URL` | `http://localhost:9411` | Zipkin v2 API (used when `TRACES_PROVIDER=zipkin`) |
| `SKYWALKING_URL` / `TRACES_SKYWALKING_URL` | `http://localhost:12800` | SkyWalking OAP GraphQL (used when `TRACES_PROVIDER=skywalking`) |
| `PROMETHEUS_URL` | `http://localhost:9090` | Prometheus API |
| `LOKI_URL` | `http://localhost:3100` | Loki API |
| `PROMETHEUS_PATH_PREFIX` | _(empty)_ | Path prefix (e.g. `/prometheus`) |
| `APP_API_URL` | `http://localhost:5000` | Application API (for ZK/system tools) |
| `ELASTICSEARCH_URL` | _(disabled)_ | Elasticsearch / OpenSearch API |
| `ALERTMANAGER_URL` | _(disabled)_ | Alertmanager API |
| `VMALERT_URL` | _(disabled)_ | vmalert rules + alerts API |
| `GRAFANA_URL` | _(disabled)_ | Grafana API |
| `CILIUM_URL` | _(disabled)_ | Cilium agent REST API (eBPF networking) |
| `KUBERNETES_URL` | _(in-cluster)_ | kube-apiserver; auto-detected in-cluster via the ServiceAccount mount |
| `CLICKHOUSE_URL` | _(disabled)_ | ClickHouse HTTP interface |
| `PYROSCOPE_URL` | _(disabled)_ | Pyroscope HTTP API (continuous profiling) |
| `OPA_URL` | _(disabled)_ | Open Policy Agent REST API |
| `ENVOY_ADMIN_URL` | _(disabled)_ | Envoy admin API |
| `CONSUL_URL` | _(disabled)_ | Consul HTTP API |
| `KONG_ADMIN_URL` | _(disabled)_ | Kong Admin API |
| `TRAEFIK_URL` | _(disabled)_ | Traefik API |
| `INFLUX_URL` | _(disabled)_ | InfluxDB HTTP API (InfluxQL) |
| `OPENTSDB_URL` | _(disabled)_ | OpenTSDB HTTP API |
| `GRAYLOG_URL` | _(disabled)_ | Graylog REST API |
| `PINPOINT_URL` | _(disabled)_ | Pinpoint web API |
| `FLUENTBIT_URL` | _(disabled)_ | Fluent Bit HTTP monitoring server |
| `BEATS_URL` | _(disabled)_ | Beats HTTP monitoring endpoint |
| `VECTOR_URL` | _(disabled)_ | Vector API (GraphQL + health) |
| `ALLOY_URL` | _(disabled)_ | Grafana Alloy |
| `AGENTRELAY_URL` | _(disabled)_ | AgentRelay hosted REST API (agent coordination) |
| `GRAFANA_DEFAULT_FROM` | `now-1h` | Default Grafana query range start |
| `GRAFANA_MAX_ITEMS` | `50` | Default Grafana list/search limit |
| `MCP_ENABLE_WRITES` | _(off)_ | Enable mutating/write tools (e.g. Grafana dashboard provisioning). Read-only by default |
| `MCP_TIMEOUT_MS` | `15000` | Backend query timeout (ms) |
| `MCP_SESSION_IDLE_MS` | `300000` | HTTP transport only: idle time before an inactive session is reaped (ms). Bounds the session map for clients that disconnect without sending a DELETE |
| `MCP_SESSION_SWEEP_MS` | `60000` | HTTP transport only: how often the idle-session reaper runs (ms) |

### Backend Authentication

The MCP server authenticates to each backend independently. For each backend prefix (`JAEGER_`, `TEMPO_`, `ZIPKIN_`, `SKYWALKING_`, `PROMETHEUS_`, `LOKI_`, `APP_API_`, `ELASTICSEARCH_`, `ALERTMANAGER_`, `GRAFANA_`, `CILIUM_`, `CLICKHOUSE_`, `PYROSCOPE_`, `OPA_`, `ENVOY_`, `CONSUL_`, `KONG_`, `TRAEFIK_`, `INFLUX_`, `OPENTSDB_`, `GRAYLOG_`, `PINPOINT_`, `FLUENTBIT_`, `BEATS_`, `VECTOR_`, `ALLOY_`, `AGENTRELAY_`, `VMALERT_`), you can set:

| Suffix | Effect |
|--------|--------|
| `_AUTH_TOKEN` | Sets `Authorization: Bearer <token>` |
| `_AUTH_BASIC` | Sets `Authorization: Basic <base64(user:pass)>` — provide as `user:password` |
| `_AUTH_HEADER` | Sets `Authorization: <raw value>` (overrides token/basic) |

Special:

| Variable | Effect |
|----------|--------|
| `LOKI_TENANT_ID` | Sets `X-Scope-OrgID` header for multi-tenant Loki |
| `GRAFANA_ORG_ID` | Sets `X-Grafana-Org-Id` header for multi-org Grafana |

> **Kubernetes** uses its own credential scheme rather than the prefix above: it presents a ServiceAccount bearer token (auto-loaded from the in-cluster mount, or `KUBERNETES_TOKEN` / `KUBERNETES_TOKEN_FILE`) and validates TLS against the cluster CA (`KUBERNETES_CA_FILE`, or the in-cluster mount). See [`.env.example`](.env.example).

**Example — Prometheus behind OAuth proxy + multi-tenant Loki:**

```bash
PROMETHEUS_AUTH_TOKEN=eyJhbGci...
LOKI_AUTH_TOKEN=my-loki-token
LOKI_TENANT_ID=team-platform
```

#### OAuth 2.0 / OIDC (client-credentials)

When **no** static `_AUTH_*` var is set for a backend, the server can obtain a
bearer token via the OAuth 2.0 **client-credentials** grant and refresh it
transparently (cached in-memory, refreshed ~60s before expiry, concurrent
requests de-duped). Client secrets are never logged or echoed in error
messages. Use the same `<PREFIX>` as above with `_AUTH_OAUTH_*` suffixes:

| Suffix | Effect |
|--------|--------|
| `_AUTH_OAUTH_CLIENT_ID` | OAuth client ID (required) |
| `_AUTH_OAUTH_CLIENT_SECRET` | OAuth client secret (required) |
| `_AUTH_OAUTH_TOKEN_URL` | Explicit token endpoint (skips OIDC discovery) |
| `_AUTH_OAUTH_ISSUER` | OIDC issuer — token endpoint is discovered from `/.well-known/openid-configuration` |
| `_AUTH_OAUTH_SCOPE` | Requested scope (optional) |
| `_AUTH_OAUTH_AUDIENCE` | Requested audience (optional; Entra derives `.default` scope from it) |
| `_AUTH_OAUTH_PROVIDER` | Preset: `entra` / `azure` / `azuread`, `google`, or `oidc` |
| `_AUTH_OAUTH_TENANT` | Entra/Azure tenant ID (with the `entra` preset) |

```bash
# Generic OIDC (token endpoint auto-discovered from the issuer)
PROMETHEUS_AUTH_OAUTH_ISSUER=https://idp.example.com/realms/obs
PROMETHEUS_AUTH_OAUTH_CLIENT_ID=otel-mcp
PROMETHEUS_AUTH_OAUTH_CLIENT_SECRET=...
PROMETHEUS_AUTH_OAUTH_SCOPE=metrics:read

# Microsoft Entra ID (Azure AD) preset
TEMPO_AUTH_OAUTH_PROVIDER=entra
TEMPO_AUTH_OAUTH_TENANT=00000000-0000-0000-0000-000000000000
TEMPO_AUTH_OAUTH_CLIENT_ID=...
TEMPO_AUTH_OAUTH_CLIENT_SECRET=...
TEMPO_AUTH_OAUTH_AUDIENCE=api://obs-backend       # → scope api://obs-backend/.default
```

Static `_AUTH_TOKEN` / `_AUTH_BASIC` / `_AUTH_HEADER` always take precedence,
so existing configs are unaffected.

### Multi-backend instances & failover

A single skill can talk to **multiple named backends** and **fail over** across
replicas. The single-URL config above keeps working unchanged — it simply
becomes the `default` instance. Supported skills today: `metrics` (Prometheus),
`logs` (Loki), and `elasticsearch`.

**Named instances** — add a `__<NAME>` suffix to the base URL var. Auth for a
named instance uses the `<PREFIX>__<NAME>_` prefix:

```bash
PROMETHEUS_URL=http://prom:9090                 # instance "default"
PROMETHEUS_URL__PROD=http://prom-prod:9090       # instance "PROD"
PROMETHEUS__PROD_AUTH_TOKEN=eyJhbGci...          # auth for "PROD"
```

**Failover** — any URL value may be a comma-separated list or JSON array. URLs
are tried in order; the server fails over only on infrastructure errors
(5xx / timeout / network) and never on a 4xx:

```bash
PROMETHEUS_URL=http://prom-a:9090,http://prom-b:9090
```

**Rich form** — `MCP_BACKENDS` (a JSON array) gives full control, including an
explicit `product` (skips version auto-probe) and per-instance headers. It takes
precedence over the env-var forms:

```bash
MCP_BACKENDS='[{"skill":"metrics","instance":"PROD",
  "urls":["http://mimir-a","http://mimir-b"],
  "authPrefix":"MIMIR_PROD","product":"Grafana Mimir",
  "extraHeaders":{"X-Scope-OrgID":"team-a"}}]'
```

**Selecting a backend** — tools on multi-backend skills accept an optional
`target` argument naming the instance (e.g. `"PROD"`). Omit it to use the
primary. `target` is validated against the configured instance names only, so a
caller can never coerce the server into fetching an arbitrary URL (no SSRF).

### Client Authentication (HTTP mode)

Clients connecting to the MCP server over HTTP must present an API key. Keys are loaded from (first match wins):

1. **`MCP_AUTH_KEYS` env var** — JSON string (best for containers / K8s Secrets)
2. **`MCP_AUTH_KEYS_FILE` env var** — path to a JSON file (K8s mounted Secret)
3. **`./auth-keys.json`** — local file in cwd
4. **`~/.otel-mcp/auth-keys.json`** — user home directory

If no keys are found, the server runs with **open access** (a warning is logged).

**Key format:**

```json
{
  "keys": [
    {
      "id": "agent-1",
      "key": "sk-my-secret-key-here",
      "description": "Production RCA agent"
    },
    {
      "id": "ci-readonly",
      "key": "sk-ci-key",
      "description": "CI pipeline — restricted tools",
      "allowedTools": ["traces", "metrics"]
    }
  ]
}
```

Clients authenticate via either header:
- `Authorization: Bearer sk-my-secret-key-here`
- `X-API-Key: sk-my-secret-key-here`

The `/health` endpoint is always unauthenticated.

### Kubernetes Deployment

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: otel-mcp-auth
stringData:
  # Client keys
  auth-keys.json: |
    {"keys":[{"id":"rca-agent","key":"sk-prod-xxx"}]}
  # Backend tokens
  PROMETHEUS_AUTH_TOKEN: "my-prom-token"
  LOKI_AUTH_TOKEN: "my-loki-token"
  LOKI_TENANT_ID: "platform"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-mcp-server
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: otel-mcp-server
          image: otel-mcp-server:latest
          ports:
            - containerPort: 3001
          env:
            - name: JAEGER_URL
              value: "http://jaeger-query.observability:16686"
            - name: PROMETHEUS_URL
              value: "http://prometheus.observability:9090"
            - name: LOKI_URL
              value: "http://loki.observability:3100"
            # Optional: uncomment to enable Elasticsearch / Alertmanager / Grafana skills
            # - name: ELASTICSEARCH_URL
            #   value: "http://elasticsearch.observability:9200"
            # - name: ALERTMANAGER_URL
            #   value: "http://alertmanager.observability:9093"
            # - name: GRAFANA_URL
            #   value: "http://grafana.observability:3000"
            # - name: GRAFANA_AUTH_TOKEN
            #   valueFrom:
            #     secretKeyRef:
            #       name: otel-mcp-auth
            #       key: GRAFANA_AUTH_TOKEN
            - name: PROMETHEUS_AUTH_TOKEN
              valueFrom:
                secretKeyRef:
                  name: otel-mcp-auth
                  key: PROMETHEUS_AUTH_TOKEN
            - name: LOKI_AUTH_TOKEN
              valueFrom:
                secretKeyRef:
                  name: otel-mcp-auth
                  key: LOKI_AUTH_TOKEN
            - name: LOKI_TENANT_ID
              valueFrom:
                secretKeyRef:
                  name: otel-mcp-auth
                  key: LOKI_TENANT_ID
            - name: MCP_AUTH_KEYS_FILE
              value: "/etc/otel-mcp/auth-keys.json"
          volumeMounts:
            - name: auth-keys
              mountPath: /etc/otel-mcp
              readOnly: true
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 5
          readinessProbe:
            httpGet:
              path: /health
              port: 3001
      volumes:
        - name: auth-keys
          secret:
            secretName: otel-mcp-auth
            items:
              - key: auth-keys.json
                path: auth-keys.json
```

## Skills

Each telemetry backend is a **skill** — an independent plugin. The core OTel skills
(`traces`, `metrics`, `logs`) and the app skills (`system`, `zk-proofs`, `public-exchange`) are **always active**,
defaulting to `localhost` backends so the server works out of the box. Every other skill is
**opt-in**: it activates only when its backend URL is set (e.g. `ELASTICSEARCH_URL`, `CILIUM_URL`,
`CLICKHOUSE_URL`), and is silently skipped otherwise. Use `--tools` to restrict which skills load
regardless of configuration.

### Traces — `traces` — 5 tools

> Provider-agnostic. Select backend with `TRACES_PROVIDER` (`jaeger` [default], `tempo`, `zipkin`, `skywalking`). The verb surface is stable across providers; capabilities the chosen backend doesn't support (e.g. `traces_dependencies` on Tempo) return a clear error.

| Tool | Description |
|------|-------------|
| `traces_search` | Search traces by service, operation, tags, or duration |
| `trace_get` | Full trace detail — all spans with timing, tags, and parent-child |
| `traces_services` | List all reporting services |
| `traces_operations` | List operations for a service |
| `traces_dependencies` | Service dependency graph |

### Metrics (Prometheus) — `metrics` — 6 tools

> Multi-backend: every tool accepts an optional `target` argument to select a named instance (see [Multi-backend instances & failover](#multi-backend-instances--failover)).

| Tool | Description |
|------|-------------|
| `metrics_query` | Instant PromQL query |
| `metrics_query_range` | Range PromQL query (time series) |
| `metrics_targets` | Scrape target health |
| `metrics_alerts` | Alerting rules and state |
| `metrics_metadata` | Metric type, help, unit lookup |
| `metrics_label_values` | Label value enumeration |

### Logs (Loki) — `logs` — 4 tools

> Multi-backend: every tool accepts an optional `target` argument to select a named instance (see [Multi-backend instances & failover](#multi-backend-instances--failover)).

| Tool | Description |
|------|-------------|
| `logs_query` | LogQL query for log lines |
| `logs_labels` | Available label names |
| `logs_label_values` | Values for a label |
| `logs_tail_context` | Logs correlated with a trace ID |

### Elasticsearch / OpenSearch — `elasticsearch` — 5 tools

> Enabled when `ELASTICSEARCH_URL` is set. Multi-backend: every tool accepts an optional `target` argument to select a named instance (see [Multi-backend instances & failover](#multi-backend-instances--failover)).

| Tool | Description |
|------|-------------|
| `es_search` | Full-text search across indices with Lucene query syntax |
| `es_cluster_health` | Cluster health (green/yellow/red), node and shard counts |
| `es_indices` | List indices with doc counts, storage size, and health |
| `es_index_mapping` | Field mappings, types, and analyzers for an index |
| `es_cat_nodes` | Node resource usage (CPU, heap, disk, load) |

### Alertmanager — `alertmanager` — 4 tools

> Enabled when `ALERTMANAGER_URL` is set.

| Tool | Description |
|------|-------------|
| `alertmanager_alerts` | Active alerts with labels, annotations, and routing status |
| `alertmanager_silences` | List active/pending/expired silences with matchers |
| `alertmanager_groups` | Alert groups by routing rules and receivers |
| `alertmanager_status` | Cluster status, version, peer count, and live config |

### vmalert — `vmalert` — 4 tools

> Enabled when `VMALERT_URL` is set (e.g. `http://localhost:8880`). vmalert is the rule-evaluation component in a VictoriaMetrics stack — VM single-node stores series but does **not** evaluate rules, so use this skill to query rules and active alerts from vmalert directly.

| Tool | Description |
|------|-------------|
| `vmalert_rules` | Alerting and recording rules with state, query, and evaluation health. Filterable by `type` (`all`/`alerting`/`recording`) and `state` (`all`/`firing`/`pending`/`inactive`) |
| `vmalert_alerts` | Active alerts as vmalert sees them pre-Alertmanager, with labels, value, and deep-link source |
| `vmalert_groups` | Rule groups with interval, concurrency, and rule counts by type |
| `vmalert_rule_health` | Rules whose evaluation health is not `ok` — surfaces evaluation errors immediately |

### Grafana — `grafana` — 10 tools

> Enabled when `GRAFANA_URL` is set. The 10 tools below are read-only and intended for verification/interrogation workflows. Three additional **write** tools are available when `MCP_ENABLE_WRITES` is set — see [Write tools](#write-tools-opt-in).

| Tool | Description |
|------|-------------|
| `grafana_health` | Grafana health, version, commit, and database status |
| `grafana_datasources` | List data sources with safe metadata |
| `grafana_datasource_health` | Check one data source by UID |
| `grafana_datasource_query` | Run read-only queries through Grafana's unified data source query API |
| `grafana_dashboards_search` | Search dashboards and folders by text, tag, folder, type, or starred status |
| `grafana_dashboard_get` | Get dashboard structure, panels, variables, data source references, and panel queries |
| `grafana_folders` | List folders with UID, title, URL, and metadata |
| `grafana_alert_rules` | List Grafana-managed alert rules and query references |
| `grafana_alerts` | List active Grafana Alertmanager alert instances |
| `grafana_contact_points` | List alert contact points or receivers with safe integration status metadata |

#### Write tools (opt-in)

> **Disabled by default.** The server is read-only out of the box. Set `MCP_ENABLE_WRITES=true` (also accepts `1`/`yes`/`on`) to advertise and enable the mutating tools below. The Grafana token must also carry the matching write scopes.

| Tool | Description | Token scope |
|------|-------------|-------------|
| `grafana_create_dashboard` | Create / upsert / update a dashboard (`POST /api/dashboards/db`) | `dashboards:write` |
| `grafana_delete_dashboard` | Delete a dashboard by UID (`DELETE /api/dashboards/uid/{uid}`) | `dashboards:delete` |
| `grafana_create_folder` | Create or upsert a folder | `folders:write` |
| `grafana_create_alert_rule` | Create / upsert / update a Grafana-managed alerting or recording rule (`/api/v1/provisioning/alert-rules`) | `alert.provisioning:write` |
| `grafana_delete_alert_rule` | Delete a Grafana-managed rule by UID (`DELETE /api/v1/provisioning/alert-rules/{uid}`) | `alert.provisioning:write` |

**Write modes** — each write tool takes an explicit `mode` so the caller controls overwrite behavior; the default is the safe one:

- `create` (default) — **strict insert**: fails with a clear conflict error (including the existing object's UID and version) if the target UID already exists. Use this for promotion workflows (e.g. staging → prod) where silently overwriting is dangerous.
- `upsert` — idempotent **create-or-update** by UID, for reconcile / infra-as-code loops.
- `update` (dashboards and alert rules) — **strict update**: fails if the target UID does not already exist.

Alert rules are **Grafana-managed** (the JSON provisioning API, no YAML dependency). A rule whose body includes a `record` object is treated as a **recording rule**; otherwise it is an **alerting rule**. Provisioning writes are sent with `X-Disable-Provenance: true` so the rules stay editable in the Grafana UI. (Mimir/Cortex ruler rules are YAML-based and remain a future follow-up.)

All write tools accept `dry_run: true` to validate and report the planned action without writing. Conflict detection for strict `create`/`update` uses a GET pre-check, and `grafana_create_dashboard` also sends Grafana's native `overwrite=false` as a second safety net. Returns the resulting UID and version on success. Existing read-only behavior is unchanged when writes are disabled.

### Cilium (eBPF networking) — `cilium` — 6 tools

> Enabled when `CILIUM_URL` is set. Targets the cilium-agent REST API. This is the agent
> control-plane surface; L3/L7 flow observability (Hubble) is gRPC and not yet wired.

| Tool | Description |
|------|-------------|
| `cilium_health` | Agent datapath/controller status, kube-apiserver and kvstore connectivity |
| `cilium_endpoints` | Managed endpoints (pods) with security identity, state, and addressing |
| `cilium_identities` | Security identities — the numeric identity each label set maps to |
| `cilium_policy` | Network policy currently enforced, with revision |
| `cilium_services` | eBPF load-balancing services and their backends |
| `cilium_nodes` | Nodes known to the agent (incl. cluster-mesh peers) |

### Kubernetes (CRD reader) — `kubernetes` — 5 tools

> Auto-enabled in-cluster (ServiceAccount mount), or set `KUBERNETES_URL` + token out-of-cluster.
> Read-only (GET only). The generic `k8s_list`/`k8s_get` work for any built-in resource or CRD, so
> the whole control-plane tier (Argo Rollouts, Flagger, Kyverno, Gatekeeper, KEDA, Chaos Mesh,
> Cilium policies, Inspektor Gadget, …) is queryable without a bespoke skill per product.

| Tool | Description |
|------|-------------|
| `k8s_health` | kube-apiserver connectivity — server version and readiness |
| `k8s_api_resources` | Discover installed API groups / CRD kinds (find what's installed) |
| `k8s_list` | List objects of any resource or CRD, with curated status |
| `k8s_get` | Get a single object by name, with full status and optional spec |
| `k8s_events` | Recent cluster events, filtered by namespace and type |

### ClickHouse Logs — `clickhouse` — 5 tools

> Enabled when `CLICKHOUSE_URL` is set. Uses ClickHouse's HTTP GET query path, which the engine
> forces to be **read-only** — writes are rejected by ClickHouse itself.

| Tool | Description |
|------|-------------|
| `clickhouse_query` | Run a read-only SQL query (SELECT/SHOW/DESCRIBE) with column types |
| `clickhouse_databases` | List databases |
| `clickhouse_tables` | List tables with engine and approximate row/byte counts |
| `clickhouse_table_schema` | Describe a table — columns, types, codecs |
| `clickhouse_logs_search` | Convenience log search — time window, message ILIKE, level, newest first |

### Pyroscope (continuous profiling) — `pyroscope` — 4 tools

> Enabled when `PYROSCOPE_URL` is set. Works against OSS Pyroscope and Grafana Pyroscope.

| Tool | Description |
|------|-------------|
| `pyroscope_profile_types` | List available profile/application names |
| `pyroscope_labels` | Label names available for a profile type |
| `pyroscope_label_values` | Values for a given label |
| `pyroscope_render` | Render a profile and return the heaviest functions by self time |

### Open Policy Agent — `opa` — 4 tools

> Enabled when `OPA_URL` is set. Read-only (GET against the Data/Query APIs).

| Tool | Description |
|------|-------------|
| `opa_health` | OPA health, including bundle activation |
| `opa_policies` | Loaded policy modules with package paths |
| `opa_data` | Fetch/evaluate a document at a data path, with optional input |
| `opa_query` | Ad-hoc Rego query — e.g. enumerate violations across packages |

### Envoy — `envoy` — 4 tools

> Enabled when `ENVOY_ADMIN_URL` is set. Works for standalone Envoy and mesh sidecar proxies.

| Tool | Description |
|------|-------------|
| `envoy_server_info` | Version, serving state, and uptime |
| `envoy_clusters` | Upstream clusters and per-endpoint health |
| `envoy_listeners` | Configured listeners and bind addresses |
| `envoy_stats` | Counters/gauges, optionally filtered by name regex |

### Consul — `consul` — 5 tools

> Enabled when `CONSUL_URL` is set. Set `CONSUL_AUTH_TOKEN` for an ACL token.

| Tool | Description |
|------|-------------|
| `consul_health` | Agent datacenter, node, version, role, and current leader |
| `consul_services` | Registered services with tags |
| `consul_service_instances` | Instances of a service with address, port, and health |
| `consul_checks` | Health checks in a given state (defaults to critical) |
| `consul_members` | Cluster members and gossip status |

### Kong Gateway — `kong` — 4 tools

> Enabled when `KONG_ADMIN_URL` is set.

| Tool | Description |
|------|-------------|
| `kong_status` | Node version, database reachability, connection stats |
| `kong_services` | Configured services (upstream targets) |
| `kong_routes` | Routes and the services they map to |
| `kong_plugins` | Enabled plugins and their scope |

### Traefik — `traefik` — 4 tools

> Enabled when `TRAEFIK_URL` is set.

| Tool | Description |
|------|-------------|
| `traefik_overview` | Version and router/service/middleware counts and features |
| `traefik_routers` | HTTP routers — rules, target service, status, entry points |
| `traefik_services` | HTTP services — type, status, load-balancer server health |
| `traefik_entrypoints` | Configured entry points and bind addresses |

### InfluxDB — `influx` — 3 tools

> Enabled when `INFLUX_URL` is set. Uses the InfluxQL `/query` endpoint (1.x and 2.x compatible).

| Tool | Description |
|------|-------------|
| `influx_health` | Health, status, and version |
| `influx_databases` | List databases / DBRP-mapped buckets |
| `influx_query` | Run a read-only InfluxQL query and return series |

### OpenTSDB — `opentsdb` — 3 tools

> Enabled when `OPENTSDB_URL` is set.

| Tool | Description |
|------|-------------|
| `opentsdb_version` | Version and build info |
| `opentsdb_suggest` | Autocomplete metric names, tag keys, or tag values |
| `opentsdb_query` | Query a metric over a range with aggregator, downsampling, and tag filters |

### Graylog — `graylog` — 3 tools

> Enabled when `GRAYLOG_URL` is set.

| Tool | Description |
|------|-------------|
| `graylog_system` | Node version, lifecycle state, hostname, start time |
| `graylog_streams` | Streams (message routing rules) |
| `graylog_search` | Search messages over a relative time window (Graylog query syntax) |

### Grafana Tempo, Apache SkyWalking — see `traces`

> Tempo and SkyWalking are now exposed through the provider-agnostic `traces` skill — set `TRACES_PROVIDER=tempo` or `TRACES_PROVIDER=skywalking` and point the matching URL var at your backend.

### Pinpoint — `pinpoint` — 3 tools

> Enabled when `PINPOINT_URL` is set. The API varies by Pinpoint version, so a read-only GET
> passthrough is provided for version-specific endpoints.

| Tool | Description |
|------|-------------|
| `pinpoint_applications` | Monitored applications and service types |
| `pinpoint_server_time` | Current server time (for building time ranges) |
| `pinpoint_get` | Read-only GET against any Pinpoint API path |

### Collection Pipelines — `pipeline` — 4 tools

> Enabled when any of `FLUENTBIT_URL` / `BEATS_URL` / `VECTOR_URL` / `ALLOY_URL` is set.
> Each tool errors clearly if its agent isn't configured.

| Tool | Description |
|------|-------------|
| `pipeline_fluentbit` | Fluent Bit per-input/output records, bytes, retries, drops |
| `pipeline_beats` | Beats output event throughput and write errors |
| `pipeline_vector` | Vector health and configured components |
| `pipeline_alloy` | Grafana Alloy components and their health |

### ZK Proofs — `zk-proofs` — 4 tools

| Tool | Description |
|------|-------------|
| `zk_proof_get` | Retrieve a ZK-SNARK proof |
| `zk_proof_verify` | Verify a proof server-side |
| `zk_solvency` | Latest solvency proof |
| `zk_stats` | Aggregate proof statistics |

### System — `system` — 5 tools

| Tool | Description |
|------|-------------|
| `anomalies_active` | Active anomalies |
| `anomalies_baselines` | Detection baselines |
| `system_health` | Full health check |
| `system_topology` | Service dependency topology |
| `backend_capabilities` | Supported product versions and per-feature availability; optionally classifies a concrete version into its support tier and reports the active gating mode |

### AgentRelay — `agentrelay` — 1 tool (+1 write tool via `MCP_ENABLE_WRITES`)

> Enabled when `AGENTRELAY_URL` is set (e.g. `https://api.agentrelay.tech`). Set `AGENTRELAY_AUTH_TOKEN` for a bearer token, or `AGENTRELAY_AUTH_HEADER` to send a raw header value (e.g. an `X-API-Key` scheme).

Coordinate with other agents through the AgentRelay hosted REST API ("headless Slack for agents"). Read-only by default; the send tool is opt-in behind `MCP_ENABLE_WRITES`.

| Tool | Description |
|------|-------------|
| `agentrelay_agents` | List the agents currently connected to your AgentRelay organization |
| `agentrelay_send` | _(write)_ Send a message or task to another agent via `POST /v1/relay/send`. Requires `MCP_ENABLE_WRITES`. Supports `dry_run` |

### Public Exchange — `public-exchange` — 5 tools

> Always available (only needs `APP_API_URL`, which defaults to `http://localhost:5000`). Read-only tools mirroring KrystalineX's `/api/public/*` transparency endpoints — designed for an **unauthenticated** public MCP deployment, since every endpoint already serves data that is public on the transparency website.

| Tool | Description |
|------|-------------|
| `exchange_status` | Operational state, uptime, observability posture |
| `total_volume` | Aggregate 24h / weekly / all-time trading volume |
| `recent_trades` | Anonymized recent trades feed (limit ≤ 100) |
| `transparency_metrics` | Full transparency metrics bundle |
| `verify_trace` | Public-safe distributed trace for a trade ID |

### Selective Skills

Only load the skills you need:

```bash
# Core OTEL only (no ZK / system health)
node dist/index.js --tools traces,metrics,logs

# Traces + metrics + alertmanager
node dist/index.js --http 3001 --tools traces,metrics,alertmanager
```

## Self-Metrics

In HTTP mode, `GET /metrics` exposes Prometheus-format metrics about the MCP server itself:

| Metric | Type | Description |
|--------|------|-------------|
| `mcp_tool_calls_total{tool,status}` | Counter | Tool invocation count |
| `mcp_tool_duration_seconds{tool}` | Histogram | Tool call latency |
| `mcp_backend_requests_total{backend,status}` | Counter | Outbound backend HTTP requests |
| `mcp_backend_duration_seconds{backend}` | Histogram | Backend request latency |
| `mcp_auth_attempts_total{result}` | Counter | Client auth attempts (accepted/rejected) |
| `mcp_active_sessions` | Gauge | Currently connected MCP sessions |
| `mcp_uptime_seconds` | Gauge | Server uptime |
| `mcp_server_info{version}` | Info | Server version metadata |

Scrape with Prometheus:

```yaml
scrape_configs:
  - job_name: 'otel-mcp-server'
    static_configs:
      - targets: ['otel-mcp-server:3001']
```

## Client Integration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "otel": {
      "command": "npx",
      "args": ["-y", "@moebiusx/otel-mcp-server"],
      "env": {
        "JAEGER_URL": "http://localhost:16686",
        "PROMETHEUS_URL": "http://localhost:9090",
        "LOKI_URL": "http://localhost:3100"
      }
    }
  }
}
```

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "otel": {
      "command": "npx",
      "args": ["-y", "@moebiusx/otel-mcp-server"],
      "env": {
        "JAEGER_URL": "http://localhost:16686",
        "PROMETHEUS_URL": "http://localhost:9090",
        "LOKI_URL": "http://localhost:3100"
      }
    }
  }
}
```

### HTTP Client (any agent)

```bash
# Health check
curl http://localhost:3001/health

# MCP request with auth
curl -X POST http://localhost:3001/mcp \
  -H "Authorization: Bearer sk-my-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Architecture

Each telemetry backend is a **Skill** — a self-contained plugin that declares its tools,
self-configures from env vars, and registers MCP tools on the server.

```
src/
├── index.ts              # CLI entry point (stdio / HTTP transport)
├── server.ts             # MCP server factory (iterates skills)
├── skill.ts              # Skill interface + SkillHelpers factory
├── skills.ts             # Skill registry (one import per backend)
├── config.ts             # env() helper
├── auth.ts               # Backend + client authentication
├── helpers.ts            # fetchJSON, createFetcher, utilities
├── metrics.ts            # Self-metrics (Prometheus format)
├── tools/
│   ├── traces.ts         # Traces layer — dispatches to a provider per TRACES_PROVIDER (5 tools)
│   ├── metrics.ts        # Prometheus metrics skill (6 tools)
│   ├── logs.ts           # Loki logs skill (4 tools)
│   ├── elasticsearch.ts  # ES/OpenSearch skill (5 tools)
│   ├── alertmanager.ts   # Alertmanager skill (4 tools)
│   ├── grafana.ts        # Grafana read-only skill (10 tools)
│   ├── cilium.ts         # Cilium eBPF networking skill (6 tools)
│   ├── kubernetes.ts     # Kubernetes CRD reader skill (5 tools)
│   ├── clickhouse.ts     # ClickHouse logs skill (5 tools)
│   ├── pyroscope.ts      # Pyroscope profiling skill (4 tools)
│   ├── opa.ts            # Open Policy Agent skill (4 tools)
│   ├── envoy.ts          # Envoy proxy admin skill (4 tools)
│   ├── consul.ts         # Consul skill (5 tools)
│   ├── kong.ts           # Kong Gateway skill (4 tools)
│   ├── traefik.ts        # Traefik skill (4 tools)
│   ├── influxdb.ts       # InfluxDB metrics skill (3 tools)
│   ├── opentsdb.ts       # OpenTSDB metrics skill (3 tools)
│   ├── graylog.ts        # Graylog logs skill (3 tools)
│   ├── pinpoint.ts       # Pinpoint skill (3 tools)
│   ├── pipeline.ts       # Collection pipelines skill (4 tools)
│   ├── zk-proofs.ts      # ZK proof skill (4 tools)
│   └── system.ts         # System health skill (4 tools)
├── providers/
│   └── traces/           # Trace provider implementations (Layer→Provider pattern)
│       ├── types.ts      # TracesProvider interface + factory type
│       ├── jaeger.ts     # Jaeger Query API provider (default)
│       ├── tempo.ts      # Grafana Tempo TraceQL provider
│       ├── zipkin.ts     # Zipkin v2 provider
│       └── skywalking.ts # SkyWalking OAP GraphQL provider
└── resources/
    └── overview.ts       # MCP resource: auto-generated overview
```

### Adding a new skill

```typescript
// 1. Create src/tools/tempo.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Skill, SkillHelpers } from '../skill.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const tempoUrl = helpers.env('TEMPO_URL');
  const fetchJSON = helpers.createFetcher('TEMPO', 'tempo');

  server.tool('tempo_search', 'Search traces in Tempo', { ... }, async (params) => {
    // ...
  });
}

export const skill: Skill = {
  id: 'tempo',
  name: 'Grafana Tempo',
  description: 'Query traces via the Grafana Tempo API',
  tools: 1,
  backends: ['Tempo'],
  isAvailable: () => !!process.env.TEMPO_URL,
  register: registerTools,
};

// 2. Add to src/skills.ts
import { skill as tempo } from './tools/tempo.js';
export const allSkills: Skill[] = [...existingSkills, tempo];
```

### Auth Flow

```
Client → [API Key] → MCP Server → [Backend Credentials] → Jaeger/Prometheus/Loki
                          │
                          ├── Authorization: Bearer <JAEGER_AUTH_TOKEN>  → Jaeger
                          ├── Authorization: Basic <PROMETHEUS_AUTH_BASIC> → Prometheus
                          └── Authorization: Bearer <LOKI_AUTH_TOKEN>    → Loki
                               X-Scope-OrgID: <LOKI_TENANT_ID>
```

## Development

```bash
# Dev mode (tsx, no build step)
npm run dev             # stdio
npm run dev:http        # HTTP on port 3001

# Type check
npm run lint

# Build
npm run build

# Tests (162 tests across 12 suites)
npm test

# Run a single test file
npx vitest run tests/auth.test.ts

# Docker live tests against local backend fixtures
npm run test:live
node scripts/live-test.mjs --skill metrics
```

For the Docker-backed one-skill-at-a-time workflow, fixture coverage, report viewer, and troubleshooting, see [docs/live-testing.md](docs/live-testing.md).

## Appendix: Live Cluster Analysis

The following analysis was generated entirely by an AI agent (GitHub Copilot CLI) using this MCP server to query a production KrystalineX cluster — 27 tool calls across 6 skills, zero manual commands. This is what "Proof of Observability" looks like in practice.

> **Cluster**: KrystalineX crypto exchange · 3-node K8s (1 control-plane, 2 workers) · Helm-managed  
> **MCP Server**: v1.2.0 · 6/7 skills active (Elasticsearch disabled) · session-based HTTP transport  
> **Date**: 2026-03-24T19:30 UTC

---

### Infrastructure

| Node | Role | CPU | Memory | Disk | Status |
|------|------|-----|--------|------|--------|
| kube (192.168.1.32) | control-plane | 13.4% | 29.7% | 62.3% | ✅ Ready |
| worker1 (192.168.1.34) | worker | 10.0% | 28.6% | 51.2% | ✅ Ready |
| worker2 (192.168.1.35) | worker | — | — | — | 🔴 NotReady (hardware) |

### Prometheus Targets — 12/12 UP

All scrape targets healthy with zero errors:

krystalinex-server · payment-processor · Kong · Grafana · Jaeger · OTEL Collector · Prometheus · RabbitMQ · Redis · kube-state-metrics · node-exporter ×2

### Application Services

| Service | Avg Latency | Traced Spans | Anomalies | Status |
|---------|------------|--------------|-----------|--------|
| kx-exchange | 491 ms | 19 | 0 | ✅ Healthy |
| kx-wallet | 156 ms | 6 | 0 | ✅ Healthy |
| kx-matcher | 29 ms | 3 | 0 | ✅ Healthy |
| kx-gateway | — | *(traced)* | 0 | ✅ Healthy |

### Performance Snapshot

| Metric | Value | Threshold | Verdict |
|--------|-------|-----------|---------|
| P50 latency | **4.1 ms** | — | 🟢 Excellent |
| P99 latency | **424 ms** | 2 s | 🟢 Well within budget |
| Error rate (5xx) | **0%** | 5% | 🟢 Clean |
| Request throughput | 0.21 req/s | — | Idle / low traffic |
| RabbitMQ backlog | **0 messages** | — | 🟢 No queuing |
| Pod restarts | **0** | — | 🟢 Stable |

### SLO Error Budgets

| SLO | Budget Remaining | Status |
|-----|-----------------|--------|
| **Availability** (99.9% target) | **100%** | 🟢 Full |
| **Latency** (P99 < 2s target) | **14.2%** | 🟡 Predictive alert firing |

The latency SLO budget is being consumed faster than expected. A `predict_linear` rule forecasts exhaustion within 24 hours. Worth investigating tail latency in kx-exchange.

### Active Alerts — 3

| Alert | Severity | Detail |
|-------|----------|--------|
| PodNotReady | ⚠️ warning | `server-df98765f9-pcxxv` — stale pod from rollout, auto-resolving |
| PodNotReady | ⚠️ warning | `payment-processor-f4f8b8d78-wxszp` — stale pod, auto-resolving |
| LatencyBudgetExhaustion | ⚠️ warning | Predictive: latency error budget depleting within 24h |

All critical rules — HighErrorRate, ServiceDown, ContainerCrashLooping, OOMKilled — are **inactive**.

### Service Dependency Graph

```
kx-gateway ──(99 calls)──► kx-exchange ──(5 calls)──► kx-matcher
                                │
                                └──(94 calls)──► jaeger (OTEL export)

kx-wallet  ──(23 calls)──► kx-exchange
kx-wallet  ──(14 calls)──► kx-gateway
```

### Logs & Traces

| Signal | Window | Count | Finding |
|--------|--------|-------|---------|
| Error logs | 1 h | **0** | Clean |
| Warning logs | 1 h | **0** | Clean |
| OOM logs | 6 h | **0** | No memory pressure |
| Error traces | 1 h | **3** | Transient tcp.connect / dns.lookup — network hiccups |
| Slow traces (>2s) | 1 h | **0** | No significant slow requests |

### Tools Used

This analysis invoked 27 MCP tool calls:

| Skill | Tools Called |
|-------|-------------|
| **Traces** | `traces_services`, `traces_search` ×2, `traces_dependencies`, `system_health` |
| **Metrics** | `metrics_query` ×12 (up, latency, errors, CPU, memory, disk, SLO budgets, RabbitMQ), `metrics_targets`, `metrics_alerts` |
| **Logs** | `logs_query` ×3 (errors, warnings, OOM) |
| **Alertmanager** | `alertmanager_alerts`, `alertmanager_groups`, `alertmanager_status` |
| **ZK Proofs** | `zk_stats` |
| **System** | `anomalies_active`, `anomalies_baselines` |

### Verdict

The cluster is **healthy and stable** with generous headroom on both active nodes. The main items to watch are the **latency SLO budget trend** and **kube node disk usage at 62%**. The offline worker2 node is a known hardware issue. No action required on the PodNotReady alerts — they are ephemeral artifacts of recent deployments.

---

## Monorepo Integration (git subtree)

This directory is maintained as a **git subtree** of the standalone repo [`MoebiusX/otel-mcp-server`](https://github.com/MoebiusX/otel-mcp-server). The standalone repo is the **single source of truth**.

### Pull latest changes from upstream

```bash
cd /path/to/KrystalineX
git subtree pull --prefix=otel-mcp-server otel-upstream master --squash
```

### Push monorepo changes back upstream

```bash
cd /path/to/KrystalineX
git subtree push --prefix=otel-mcp-server otel-upstream master
```

### Initial setup (already done)

```bash
git remote add otel-upstream https://github.com/MoebiusX/otel-mcp-server.git
git subtree add --prefix=otel-mcp-server otel-upstream master --squash
```

> **Note:** `src/client.ts` is currently monorepo-only. Push it upstream when ready.

## License

Apache-2.0 — see [LICENSE](LICENSE).
