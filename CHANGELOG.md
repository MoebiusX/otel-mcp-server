# Changelog

All notable changes to otel-mcp-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.1] - 2026-06-07

### Changed

- CI release workflow now builds and pushes multi-arch Docker images (`linux/amd64`, `linux/arm64`) to Docker Hub as part of every tagged release.

## [1.6.0] - 2026-06-06

### Added

- **vmalert skill** (`vmalert`, 4 read-only tools). Surfaces Victoria Metrics alerting state so agents can query firing alerts, inspect rule evaluation health, and filter by type/group. Tools: `vmalert_rules` (list all alerting/recording rules with optional `type` and `state` filters), `vmalert_alerts` (currently firing alerts), `vmalert_groups` (group-level summary of rule counts and health), `vmalert_rule_health` (surfaces rules whose health is not `ok`). Requires `VMALERT_URL`. Zero new runtime dependencies.
- **Public Exchange skill** (`public-exchange`, 5 read-only tools). Mirrors KrystalineX's `/api/public/*` transparency endpoints for an unauthenticated public MCP deployment — `exchange_status`, `total_volume`, `recent_trades`, `transparency_metrics`, and `verify_trace`. Always available (only needs `APP_API_URL`); every endpoint serves data already public on the transparency website. Zero new runtime dependencies.
- `MCP_SESSION_IDLE_MS` and `MCP_SESSION_SWEEP_MS` environment variables to tune HTTP session reaping.

### Fixed

- **HTTP transport no longer crashes on session close.** A client `DELETE` (or any transport close) triggered infinite recursion in `transport.onclose` — `onclose -> mcpServer.close() -> transport.close() -> onclose -> …` — overflowing the stack with `RangeError: Maximum call stack size exceeded` and killing the process. A re-entry guard now makes `onclose` idempotent.
- **HTTP transport no longer leaks sessions.** Sessions were only removed from the in-memory map when the client sent a `DELETE`. Clients that disconnected without one (stateless callers, crashes, synthetic health probes) leaked an `McpServer` + transport pair per handshake, growing memory until the process was OOM-killed. An idle-session reaper now closes sessions inactive beyond `MCP_SESSION_IDLE_MS` (default 5m), swept every `MCP_SESSION_SWEEP_MS` (default 60s).

## [1.5.0] - 2026-06-06

### Added

- **AgentRelay skill** (`agentrelay`, 1 read + 1 write tool). Integrates the [AgentRelay](https://agentrelay.tech) hosted REST API so agents can coordinate through a shared messaging layer without embedding an external SDK.
  - `agentrelay_agents` — lists connected agents (handle, status, type) via `GET /v1/agents`. Always available when `AGENTRELAY_URL` is set.
  - `agentrelay_send` — posts a message or task to another agent via `POST /v1/relay/send`. Gated behind `MCP_ENABLE_WRITES` (same posture as Grafana write tools). Supports `type: message | task`, an optional structured `payload` override, and a `dry_run` mode that reports the planned request without sending.
  - Auth: `AGENTRELAY_AUTH_TOKEN` (Bearer) or `AGENTRELAY_AUTH_HEADER` (raw header override, e.g. `X-API-Key`).
  - Zero new runtime dependencies — uses the existing `helpers.createFetcher` HTTP path.

## [1.4.1] - 2026-06-05

### Fixed

- **Server version no longer drifts.** The startup banner, `GET /health`, and the `mcp_server_info{version}` metric now read the version from `package.json` at runtime via a new zero-dependency `src/version.ts` (using built-in `createRequire`), instead of a hardcoded constant that was stuck at `1.2.0`. The compiled `dist/version.js` resolves the sibling `package.json` in both the source (tests) and published (`dist/`) layouts.

## [1.4.0] - 2026-06-05

### Added

- **Grafana write tools (opt-in).** The Grafana skill gains five mutating tools so agents can provision dashboards, folders, and Grafana-managed alert/recording rules, not just read them (#22). Writes are **disabled by default** and only registered/advertised when `MCP_ENABLE_WRITES` is set (`true`/`1`/`yes`/`on`) — read-only stays the default posture.
  - `grafana_create_dashboard` — create / upsert / update a dashboard via `POST /api/dashboards/db`.
  - `grafana_delete_dashboard` — delete a dashboard by UID.
  - `grafana_create_folder` — create or upsert a folder.
  - `grafana_create_alert_rule` — create / upsert / update a Grafana-managed alerting **or recording** rule via the JSON provisioning API (`/api/v1/provisioning/alert-rules`). A rule whose body carries a `record` object is a recording rule; otherwise it is an alerting rule. No YAML dependency; Mimir/Cortex ruler rules remain a future follow-up.
  - `grafana_delete_alert_rule` — delete a Grafana-managed rule by UID.
  - **Write modes** via an explicit `mode` arg: `create` (default, strict insert — fails with a conflict error carrying the existing UID/version), `upsert` (idempotent create-or-update), and `update` (dashboards and alert rules, strict update). Strict conflict detection uses a GET pre-check (portable across backends), and dashboard creates also send Grafana's native `overwrite=false` as a second safety net. Provisioning writes set `X-Disable-Provenance: true` so rules stay UI-editable. All write tools support `dry_run` and never log secrets.
  - Docs: README Grafana write-tools section (modes, required token scopes including `alert.provisioning:write`), `MCP_ENABLE_WRITES` in the env-var table and `.env.example`.
- Test count: 219 → 246. Added `tests/grafana-write.test.ts` (27 tests) covering gating (off by default / on when enabled), all write modes (insert success, insert-conflict, upsert overwrite, strict-update-absent), recording-vs-alerting detection, the 204 No Content delete path, dry-run, validation, and request shaping. Existing read-only Grafana tests unchanged.
- **OAuth 2.0 / OIDC backend authentication (outbound).** Backends can now be accessed with a bearer token obtained via the OAuth 2.0 **client-credentials** grant, fetched and refreshed transparently at request time (#20).
  - `src/oauth.ts` — zero-dependency client (built-in `fetch`/`URLSearchParams` only): `readOAuthConfig`, `buildOAuthAuth`, `clearOAuthCaches`. In-memory token cache with refresh ~60s before expiry, concurrent-fetch de-duplication, and OIDC token-endpoint discovery via `/.well-known/openid-configuration`. Presets for Microsoft Entra ID (`entra`/`azure`/`azuread` — derives the tenant token URL and `<audience>/.default` scope), Google, and generic OIDC. Client secrets are never logged or echoed in error messages.
  - Configured per backend with `<PREFIX>_AUTH_OAUTH_*` env vars (`CLIENT_ID`, `CLIENT_SECRET`, `TOKEN_URL`, `ISSUER`, `SCOPE`, `AUDIENCE`, `PROVIDER`, `TENANT`). Used automatically when no static `_AUTH_*` var is set; static `_AUTH_TOKEN`/`_AUTH_BASIC`/`_AUTH_HEADER` still take precedence, so existing configs are unaffected.
  - `BackendAuth` gains an optional async `getAuthorization()` resolver; `src/auth.ts` adds `resolveAuthHeaders()` and the request path (`fetchJSON`) now resolves headers asynchronously so tokens are fetched/refreshed on demand.
- Test count: 246 → 262. Added `tests/oauth.test.ts` covering token acquisition, caching, refresh-on-expiry, concurrent de-dup, error/secret handling, OIDC discovery, Entra/Google presets, and `buildAuth` precedence/fallthrough.

## [1.3.1] - 2026-06-05

### Added

- **npm distribution.** The server is now published to npm as the scoped package `@moebiusx/otel-mcp-server` and can be run with `npx -y @moebiusx/otel-mcp-server` — no clone or build required. A `Release` GitHub Actions workflow publishes with npm provenance on every `v*` tag (gated on lint, build, and tests, and on the tag matching `package.json` version). README and example client configs (Claude Desktop, VS Code) now use the `npx` invocation.
- **Multi-version & protocol-feature model.** A typed catalog now tracks which product versions and protocol features each backend supports, following a `capability → product → protocol-adapter` model (many products share one protocol, but ship features at different versions).
  - `src/protocols.ts` — typed protocol catalog (`PROTOCOLS`) with per-protocol query language, products, baseline (always-available) features, and versioned-feature summaries. 30 protocol adapters.
  - `src/versions.ts` — version model (`BackendVersionSupport`, `SupportTier` of `must`/`should`/`optional` tiers) plus pure helpers: `parseVersion`, `compareVersions`, `matchesRange` (x-ranges, comparators, LTS-stripping), `classify`, `supportsFeature`, `supportsCapability`. The typed `backend()` builder checks `protocolFeaturesSince` keys against the protocol's feature union at compile time.
  - `src/skill-versions.ts` — centralized per-product version data for all 22 skills, with per-product feature since-versions (e.g. `native_histograms`: Prometheus 3.0 vs Mimir 2.10 vs Thanos 0.34).
  - `src/detect.ts` — best-effort backend product/version detection: `{PREFIX}_PRODUCT`/`{PREFIX}_VERSION` config override → buildinfo probe → protocol default. Unknown versions degrade optimistically.
  - `backend_capabilities` tool (system skill) — reports supported versions and per-feature availability; optionally classifies a concrete version into its support tier. System skill: 4 → 5 tools.
  - `npm run gen:versions` generates `docs/supported-versions.{json,md}` (grouped by protocol) from the catalog; a drift test guards the committed manifest.
- Test count: 162 → 167. Added version-metadata validation in `tests/skill-registry.test.ts` and a manifest drift guard in `tests/version-manifest.test.ts`. Default/full tool counts updated (23 → 24, 42 → 43).
- **Runtime version registry.** `src/version-registry.ts` resolves each configured backend's live product/version and classifies it into a support tier.
  - `BACKEND_INSTANCES` catalog maps every probeable backend slot to its protocol, env prefix, and URL env vars. Multi-product protocols (PromQL, Query DSL) leave the product unset so the buildinfo probe disambiguates the real product (e.g. Prometheus vs Mimir vs Thanos); the active traces provider is chosen via `TRACES_PROVIDER`, and the InfluxDB slot by `INFLUX_VERSION` major.
  - `VersionRegistry` probes lazily with a short timeout, caches results (60s TTL), and never throws — failures and unknown versions degrade to the `unknown` tier.
  - The HTTP `/health` endpoint now includes a `backendVersions` array (per-instance product, detected version, source, and tier). Skip probing with `/health?versions=0` for fast liveness checks.
- Test count: 167 → 178. Added `tests/version-registry.test.ts` (instance configuration predicates, probe-driven detection, product disambiguation, config override, TTL caching).
- **Capability gating.** `src/gating.ts` turns the version model and runtime registry into a guard tool handlers can call before attempting a version-sensitive feature.
  - `MCP_VERSION_GATING` policy: `off` (legacy, no gating) | `warn` (default — proceed but annotate when a feature is unlikely to be supported) | `enforce` (block features the detected version does not support).
  - Unknown versions always pass optimistically with a warning — even under `enforce` — so a probe failure is never worse than having no gating at all.
  - `requireFeature(skillId, feature, helpers, opts?)` resolves the live backend version via the registry and returns a proceed/block verdict with an advisory or error message; `evaluateFeature` / `applyGating` expose the pure pieces for offline classification.
  - `backend_capabilities` classification output now includes the active `gatingMode`, a `gatedOut` list of versioned features below the detected version's minimum, and a per-feature `proceed`/`blocked` decision with warning/error text.
- Test count: 178 → 198. Added `tests/gating.test.ts` (mode resolution, baseline vs versioned evaluation, per-product since maps, off/warn/enforce policy, optimistic unknown handling, live registry-backed guard).
- **Multi-backend instances & failover.** A skill can now address multiple named backends and fail over across replicas. `src/backends.ts` adds a `BackendRegistry` that resolves a skill's configured instances from the environment, fully backward compatible (a plain `PROMETHEUS_URL` stays the `default` instance).
  - **Named instances** via a `__<NAME>` suffix on the base URL var (`PROMETHEUS_URL__PROD`), with auth from the `<PREFIX>__<NAME>_` prefix.
  - **Failover** — any URL value may be a comma-separated list or JSON array; `createFailoverFetcher` (in `src/helpers.ts`) tries each URL in order and only fails over on infrastructure errors (5xx / timeout / network), never on a 4xx.
  - **Rich form** — `MCP_BACKENDS` (JSON array) for full control: explicit `product` (skips version probe), `authPrefix`, and per-instance `extraHeaders`. Precedence: `MCP_BACKENDS` > suffixed env > base env.
  - Tools on multi-backend skills accept an optional `target` argument to select a named instance; it is validated against the configured instance names only, so a caller can never coerce an arbitrary URL (no SSRF). `SkillHelpers` gains `listInstances` and `resolveBackend`.
  - Wired into the reference skills `metrics` (Prometheus), `logs` (Loki), and `elasticsearch`; remaining skills follow the same one-line `resolveBackend` pattern.
- Test count: 198 → 219. Added `tests/backends.test.ts` (URL splitting, default/named/`MCP_BACKENDS` precedence, SSRF-safe target resolution, and failover behaviour).

### Changed

- **Traces refactor (Layer→Provider).** Tempo, Zipkin, and SkyWalking are no longer standalone skills. They are now providers under a single provider-agnostic `traces` skill, selectable via `TRACES_PROVIDER` (`jaeger` [default] | `tempo` | `zipkin` | `skywalking`). The verb surface (`traces_search`, `trace_get`, `traces_services`, `traces_operations`, `traces_dependencies`) is stable across providers; capability gaps (e.g. Tempo has no dependency API) return a clear `not supported by provider "X"` error.
  - Provider implementations live under `src/providers/traces/{jaeger,tempo,zipkin,skywalking}.ts` behind a `TracesProvider` interface (`src/providers/traces/types.ts`). This establishes the template for future layer/provider collapses (metrics, logs).
  - Env vars: prefer namespaced `TRACES_<VENDOR>_URL` (`TRACES_TEMPO_URL`, `TRACES_ZIPKIN_URL`, `TRACES_SKYWALKING_URL`); legacy `TEMPO_URL` / `ZIPKIN_URL` / `SKYWALKING_URL` continue to work. Auth still uses per-vendor prefixes (`JAEGER_AUTH_*`, `TEMPO_AUTH_*`, `ZIPKIN_AUTH_*`, `SKYWALKING_AUTH_*`).
  - Skill count: 25 → 22. Tool count: 111 → 99 (5 superset verbs replace 5 + 4 + 3 = 12 vendor-prefixed tools).
  - Pinpoint stays as a standalone skill — its API surface (version-specific GET passthrough) doesn't fit the layer verbs cleanly.
- Test count: 155 → 162. Added `tests/traces-layer.test.ts` covering each provider through the layer (including the unsupported-capability path), and pruned the dropped vendor blocks from `tests/sprint-tools.test.ts` and `tests/skill-registry.test.ts`.

## [1.3.0] - 2026-05-23

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
