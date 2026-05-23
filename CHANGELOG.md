# Changelog

All notable changes to otel-mcp-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Grafana** read-only skill (10 tools):
  - `grafana_health` — Health, version, commit, and database status
  - `grafana_datasources` — Data source inventory with safe metadata
  - `grafana_datasource_health` — Data source health by UID
  - `grafana_datasource_query` — Read-only queries through Grafana's unified data source query API
  - `grafana_dashboards_search` — Dashboard and folder search
  - `grafana_dashboard_get` — Dashboard structure, panels, variables, data source references, and panel queries
  - `grafana_folders` — Folder inventory
  - `grafana_alert_rules` — Grafana-managed alert rules
  - `grafana_alerts` — Active Grafana Alertmanager alert instances
  - `grafana_contact_points` — Contact point / receiver status metadata
- **Cilium** eBPF networking skill (6 tools) — `cilium_health`, `cilium_endpoints`, `cilium_identities`, `cilium_policy`, `cilium_services`, `cilium_nodes`. Targets the cilium-agent REST API; enabled via `CILIUM_URL`.
- **Kubernetes** read-only CRD reader skill (5 tools) — `k8s_health`, `k8s_api_resources`, `k8s_list`, `k8s_get`, `k8s_events`. Generic resource/CRD access makes the control-plane tier (Argo, Flagger, Kyverno, Gatekeeper, KEDA, Chaos Mesh, Cilium policies, Inspektor Gadget, …) queryable without a per-product skill. Uses Node's built-in `node:https` for ServiceAccount auth + cluster-CA TLS validation — no new dependency. Auto-enables in-cluster.
- **ClickHouse** logs skill (5 tools) — `clickhouse_query`, `clickhouse_databases`, `clickhouse_tables`, `clickhouse_table_schema`, `clickhouse_logs_search`. Uses ClickHouse's read-only HTTP GET query path; enabled via `CLICKHOUSE_URL`.
- **Pyroscope** continuous-profiling skill (4 tools) — `pyroscope_profile_types`, `pyroscope_labels`, `pyroscope_label_values`, `pyroscope_render` (decodes the flamegraph and returns the heaviest functions by self time). Enabled via `PYROSCOPE_URL`.
- **Open Policy Agent** skill (4 tools) — `opa_health`, `opa_policies`, `opa_data`, `opa_query`. Read-only access to policy decisions and data documents; enabled via `OPA_URL`.
- **Zipkin** traces skill (5 tools) — `zipkin_services`, `zipkin_spans`, `zipkin_traces_search`, `zipkin_trace_get`, `zipkin_dependencies`. Mirrors the Jaeger skill's shape; enabled via `ZIPKIN_URL`.
- **Service mesh cluster** — four read-only skills sharing the admin-API pattern:
  - **Envoy** (4 tools) — `envoy_server_info`, `envoy_clusters`, `envoy_listeners`, `envoy_stats`. Enabled via `ENVOY_ADMIN_URL`.
  - **Consul** (5 tools) — `consul_health`, `consul_services`, `consul_service_instances`, `consul_checks`, `consul_members`. Enabled via `CONSUL_URL`.
  - **Kong** (4 tools) — `kong_status`, `kong_services`, `kong_routes`, `kong_plugins`. Enabled via `KONG_ADMIN_URL`.
  - **Traefik** (4 tools) — `traefik_overview`, `traefik_routers`, `traefik_services`, `traefik_entrypoints`. Enabled via `TRAEFIK_URL`.
- **InfluxDB** metrics skill (3 tools) — `influx_health`, `influx_databases`, `influx_query`. Uses the InfluxQL `/query` endpoint (1.x and 2.x-compatible); enabled via `INFLUX_URL`.
- **OpenTSDB** metrics skill (3 tools) — `opentsdb_version`, `opentsdb_suggest`, `opentsdb_query`. Enabled via `OPENTSDB_URL`.
- **Graylog** logs skill (3 tools) — `graylog_system`, `graylog_streams`, `graylog_search`. Enabled via `GRAYLOG_URL`.
- **Grafana Tempo** native TraceQL skill (4 tools) — `tempo_search`, `tempo_trace_get`, `tempo_tags`, `tempo_tag_values`. Complements pointing the Jaeger skill at Tempo; enabled via `TEMPO_URL`.
- **Apache SkyWalking** skill (3 tools) — `skywalking_services`, `skywalking_traces_search`, `skywalking_trace_get` via the OAP GraphQL API. Enabled via `SKYWALKING_URL`.
- **Pinpoint** skill (3 tools) — `pinpoint_applications`, `pinpoint_server_time`, and a read-only `pinpoint_get` passthrough for version-specific endpoints. Enabled via `PINPOINT_URL`.
- **Collection Pipelines** skill (4 tools) — `pipeline_fluentbit`, `pipeline_beats`, `pipeline_vector`, `pipeline_alloy`. Agent health/throughput introspection; enabled when any of `FLUENTBIT_URL`/`BEATS_URL`/`VECTOR_URL`/`ALLOY_URL` is set.

### Fixed

- Instrumented backend fetchers now forward request method/body options, which is required for `POST /api/ds/query` and Elasticsearch searches.
- `mcp_server_info{version}` now reports `1.2.0` instead of stale `1.1.0` metadata.
- README now accurately describes skill activation (core/app skills always-on with localhost defaults; all others opt-in via their backend URL) and the stray `v1.2.1` version reference was corrected to `v1.2.0`.
- `package.json` `repository.url` updated from the stale `KrystalineX/otel-mcp-server` to the current `MoebiusX/otel-mcp-server` GitHub URL. Author field unchanged.
- Docker image `org.opencontainers.image.source` label updated to the current `MoebiusX/otel-mcp-server` GitHub URL.

### Changed

- Fully configured tool count: 32 → 42 → 111.
- Skill count: 8 → 25.
- Test count: 99 → 106 → 155. Added a registry-integrity guard (declared-vs-actual tool counts, unique skill ids and tool names), behavioral tests for all skills added this cycle, and node:http-mocked tests for the kubernetes skill's request path.

### Testing & CI

- Added an isolated Docker live-test harness ([scripts/live-test.mjs](scripts/live-test.mjs)) that brings up one fixture at a time, runs a single skill against the real container image over HTTP with API-key auth, and writes a JSON report under `.live-test-results/` (gitignored, last 20 reports retained).
- Added [docker-compose.live.yml](docker-compose.live.yml), [tests/live-test-matrix.json](tests/live-test-matrix.json), [scripts/app-api-fixture.mjs](scripts/app-api-fixture.mjs), and the `tests/live-fixtures/` config tree.
- Added `npm run test:live` and `npm run test:live:standard`. Standard profile: 19 passed, 0 failed, 6 expected skips (kubernetes, cilium, opentsdb, graylog, skywalking, pinpoint — deferred to future `kind`/`full` profiles).
- Added a standalone HTML report viewer at [docs/live-test-report-viewer.html](docs/live-test-report-viewer.html) and live-test docs at [docs/live-testing.md](docs/live-testing.md), including a "how to add a new skill to live tests" section.
- Added GitHub Actions workflows: [.github/workflows/ci.yml](.github/workflows/ci.yml) (lint, build, test, harness syntax check, Compose config validation on Node 20/22) and [.github/workflows/live-test.yml](.github/workflows/live-test.yml) (manual `workflow_dispatch` and nightly schedule for the Docker-backed live profile, with report artifact upload).
- Added README workflow/status badges and Dependabot weekly npm update configuration targeting `develop`.

## [1.2.0] - 2026-03-24

### Added

- **Skill plugin architecture** — each telemetry backend is now a self-contained `Skill` object
  that self-configures from environment variables, declares its own availability, and registers
  MCP tools independently. Adding a new backend is now a single file + one registry line.
- `src/skill.ts` — `Skill` interface, `SkillHelpers` abstraction, `createSkillHelpers()` factory
- `src/skills.ts` — central skill registry (import + array)
- Skill-aware startup display showing ✓/✗ per skill with tool counts and backend names
- Health endpoint now returns per-skill availability status
- `buildAuth(prefix)` exported from auth.ts for use by skill helpers
- Overview resource auto-generates from active skill metadata

### Changed

- `createServer(config, options)` → `createServer(options)` — skills self-configure from env vars
- Config module stripped to `env()` helper — no more shared `Config` object
- Removed `loadBackendAuth()`, `BackendAuthConfig`, `buildLokiAuth()` from auth.ts (superseded by `buildAuth()`)
- Removed `ToolGroup` type, `ALL_TOOL_GROUPS` — replaced by `allSkills` registry
- Loki tenant ID (`LOKI_TENANT_ID`) now handled by the logs skill via `CreateFetcherOptions.extraHeaders`
  instead of special-cased auth logic
- Version bumped to 1.2.0
- Test count: 98 → 99

### How to add a new skill

```typescript
// 1. Create src/tools/tempo.ts
export const skill: Skill = {
  id: 'tempo',
  name: 'Grafana Tempo',
  description: 'Query traces via the Grafana Tempo API',
  tools: 3,
  backends: ['Tempo'],
  isAvailable: () => !!process.env.TEMPO_URL,
  register: registerTools,
};

// 2. Add to src/skills.ts
import { skill as tempo } from './tools/tempo.js';
export const allSkills: Skill[] = [..., tempo];
```

## [1.1.0] - 2026-03-24

### Added

- **Elasticsearch / OpenSearch** tool group (5 tools):
  - `es_search` — Full-text search across indices with Lucene query syntax
  - `es_cluster_health` — Cluster health status (green/yellow/red), node and shard counts
  - `es_indices` — List indices with doc counts, storage size, and health
  - `es_index_mapping` — Field mappings, types, and analyzers for an index
  - `es_cat_nodes` — Node resource usage (CPU, heap, disk, load)
- **Alertmanager** tool group (4 tools):
  - `alertmanager_alerts` — Active alerts with labels, annotations, and routing status
  - `alertmanager_silences` — List active/pending/expired silences with matchers
  - `alertmanager_groups` — Alert groups by routing rules and receivers
  - `alertmanager_status` — Cluster status, version, peer count, and live config
- **Self-metrics** (`GET /metrics` in HTTP mode):
  - `mcp_tool_calls_total{tool, status}` — Tool call counter
  - `mcp_tool_duration_seconds{tool}` — Tool call latency histogram
  - `mcp_backend_requests_total{backend, status}` — Outbound request counter
  - `mcp_backend_duration_seconds{backend}` — Backend request latency histogram
  - `mcp_auth_attempts_total{result}` — Authentication attempt counter
  - `mcp_active_sessions` — Active connected sessions gauge
  - `mcp_uptime_seconds` — Server uptime gauge
  - `mcp_server_info{version}` — Server metadata
- All backend fetchers now instrumented with per-backend request metrics
- `createFetcher()` accepts optional `backend` name for automatic instrumentation
- `fetchJSON()` supports POST requests with JSON body (for Elasticsearch)

### Changed

- Tool count: 23 → 32 (with all backends configured)
- Conditional tool registration: ES and AM tools only register when URLs are configured
- Version bumped to 1.1.0

## [1.0.0] - 2026-03-24

### Added

- **23 MCP tools** across 5 domains:
  - **Traces** (5): search, get, services, operations, dependencies
  - **Metrics** (6): query, query_range, targets, alerts, metadata, label_values
  - **Logs** (4): query, labels, label_values, tail_context
  - **ZK Proofs** (4): proof_get, proof_verify, solvency, stats
  - **System** (4): anomalies_active, anomalies_baselines, system_health, system_topology
- **Two transports**: stdio (Claude Desktop, Copilot) and Streamable HTTP (remote agents)
- **Backend authentication**: per-backend Bearer token, Basic auth, or raw Authorization headers; Loki multi-tenant support via X-Scope-OrgID
- **Client authentication**: API keys loaded from MCP_AUTH_KEYS env var (container-native), MCP_AUTH_KEYS_FILE, or local auth-keys.json
- **Selective tool groups**: `--tools traces,metrics,logs` flag to load only needed tools
- **MCP resource**: `otel://overview` with platform architecture and workflow guidance
- **Health endpoint**: `/health` (always unauthenticated) with version, auth status, and enabled tools
- **CORS support** for browser-based MCP clients
- **Dockerfile**: multi-stage build with health check
- **Client examples**: Claude Desktop and VS Code / GitHub Copilot configs
