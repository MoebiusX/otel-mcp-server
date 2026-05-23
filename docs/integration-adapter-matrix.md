# Integration Adapter Matrix

Date: 2026-05-21
Status: Proposal (pre-ADR). No code changes yet.
Scope: **Core (OSS, self-hostable) only.** OnPrem-commercial, SaaS/egress, and CLI/file tools are
out of scope and not pursued. Build order is **eBPF-first** (see Sequencing).

This document maps the in-scope observability landscape onto the
**capability → provider → protocol-adapter** model proposed for `otel-mcp-server`. Headline: the
Core OSS set is ~70 products that collapse to **~30 adapters**, two of which (`promql`, `k8s-crd`)
cover most of the map.

## How to read this

Two decoupled axes:

- **Capability** — the stable verb the *agent* reasons about (e.g. `metrics.query`). The MCP tool
  surface is the capability set, not the product set, so it stays small no matter how many backends
  are configured.
- **Provider** — a configured *instance* of a product (`{adapter, endpoint, auth, scope}`) that
  implements one or more capabilities through a **protocol adapter**. Adding a product is a registry
  entry; only a genuinely new wire protocol needs new adapter code.

### Auth codes

`net` network-trusted/none · `bearer` Bearer token · `basic` Basic · `apikey` custom header ·
`sa` k8s ServiceAccount token · `mtls` client cert · `grpc-tls` gRPC+TLS(+token)

> Today's auth model ([`src/skill.ts`](../src/skill.ts): `_AUTH_TOKEN`/`_AUTH_BASIC`/`_AUTH_HEADER`)
> covers `bearer`/`basic`/`apikey`. **Gaps to add:** `sa`, `mtls`, `grpc-tls`, plus a multi-instance
> **connection registry** (the one-prefix-per-backend env scheme can't express three Prometheis or
> two Tempos).

## Capability catalog (stable tool surface)

| Capability | Group | What it does |
|---|---|---|
| `metrics.query` / `metrics.range` / `metrics.metadata` / `metrics.labels` | Query | Time-series query, metadata, label discovery |
| `logs.search` / `logs.labels` | Query | Log/event search, label discovery |
| `traces.search` / `traces.get` / `traces.deps` | Query | Trace search, full trace, dependency graph |
| `profiles.query` | Query | Continuous-profiling flamegraph/pprof query |
| `flows.query` | Network | L3/L7 network flow query (eBPF) — **net-new** |
| `events.recent` | Runtime | Bounded query of recent runtime/kernel events — **net-new** |
| `topology.get` | Derived | Service/mesh topology |
| `alerts.list` / `alerts.rules` | State | Active alerts and alerting rules |
| `slo.status` | State | SLO compliance / burn rate |
| `pipeline.health` / `pipeline.config` | Control | Collector/agent health, throughput, drops, config |
| `policy.violations` | Control | Policy decisions / admission violations |
| `experiment.status` | Control | Chaos experiment state/results |
| `rollout.status` | Control | Progressive-delivery rollout/canary state |
| `mesh.config` / `mesh.status` | Control | Service-mesh config dump and proxy status |
| `storage.status` | Control | Object-store capacity, health, inventory |
| `synthetic.results` | State | Synthetic probe / check results |

> `events.recent`, not `events.stream`: MCP tools are request/response, so kernel/security events
> are exposed as a bounded "events since T" query (like today's `logs_tail_context`), not a live
> subscription.

## Adapter catalog (Core only — ~30 units)

| Adapter id | Protocol / API | Transport | Covers | Auth |
|---|---|---|---|---|
| `promql` ★*(built)* | Prometheus HTTP query API | HTTP | Prometheus, Mimir, Thanos, Cortex, VictoriaMetrics, **+ all `/metrics` self-metrics** | bearer/basic/net |
| `influx` | InfluxDB Flux/InfluxQL | HTTP | InfluxDB | bearer |
| `pgsql` | Postgres wire + SQL | TCP | TimescaleDB | basic/mtls |
| `clickhouse` | ClickHouse HTTP + SQL | HTTP | ClickHouse | basic |
| `opentsdb` | OpenTSDB HTTP | HTTP | OpenTSDB | net |
| `esdsl` ★*(built)* | Elasticsearch `_search`/`_cat` | HTTP | Elasticsearch, OpenSearch, Quickwit, Elastic APM | basic/apikey |
| `logql` ★*(built)* | Loki HTTP | HTTP | Loki | bearer/apikey |
| `graylog` | Graylog REST search | HTTP | Graylog | bearer/basic |
| `jaeger` ★*(built)* | Jaeger Query API | HTTP | Jaeger, Tempo (Jaeger-compat) | bearer |
| `traceql` | Tempo native TraceQL | HTTP | Tempo (richer search) | bearer |
| `zipkin` | Zipkin API v2 | HTTP | Zipkin | net |
| `skywalking` | SkyWalking GraphQL | HTTP | Apache SkyWalking | bearer |
| `pinpoint` | Pinpoint web API | HTTP | Pinpoint | net |
| `pyroscope` | Pyroscope query/render | HTTP | Pyroscope | bearer |
| `parca` | Parca Connect/gRPC | **gRPC** | Parca | grpc-tls |
| `hubble` | Hubble Observer gRPC | **gRPC** | Cilium/Hubble flows | grpc-tls |
| `pixie` | Pixie PxL (Vizier gRPC) | **gRPC** | Pixie | grpc-tls/apikey |
| `falco-events` | Falco gRPC / event API | **gRPC** | Falco, Tracee, Inspektor Gadget | grpc-tls |
| `k8s-crd` | Kubernetes API — CRD status reader | HTTP | Gatekeeper, Kyverno, Kubewarden, Chaos Mesh, Litmus, Argo Rollouts, Flagger, KEDA, Argo Events, Keptn, OSM, Istio/Linkerd/Cilium CP, Inspektor Gadget | sa/mtls |
| `opa-rest` | OPA Data/Decision API | HTTP | OPA (standalone) | bearer |
| `envoy-admin` | Envoy admin (config_dump/stats) | HTTP | Envoy, Istio sidecars | net |
| `consul-api` | Consul catalog/health | HTTP | Consul Connect | bearer |
| `kong-admin` | Kong Admin API | HTTP | Kong Gateway | apikey |
| `traefik-api` | Traefik API | HTTP | Traefik Mesh | net |
| `minio-admin` | MinIO Admin API | HTTP | MinIO | apikey |
| `ceph-mgr` | Ceph mgr / RGW admin | HTTP | Ceph | bearer |
| `s3-stats` | S3-compatible admin/stats | HTTP | SeaweedFS, OpenIO, Garage | apikey |
| `pipeline-admin` (family) | Per-agent monitor APIs | HTTP | Vector (GraphQL), Fluent Bit (`/api/v1/metrics`), Beats (`/stats`), Alloy | net |

★ = already present or ~80% present in the codebase today.
**gRPC transport** is net-new — today's [`src/helpers.ts`](../src/helpers.ts) fetcher is HTTP-only.

---

## Build status (as of 2026-05-21)

The codebase went from **8 skills / 42 tools → 25 skills / 111 tools**. The entire **open
(unblocked HTTP) path is built**; only the three transport/auth blockers remain.

**✅ Built skills (new this cycle):** `cilium`, `kubernetes` (k8s-crd), `clickhouse`,
`pyroscope`, `opa`, `zipkin`, `envoy`, `consul`, `kong`, `traefik`, `influx`, `opentsdb`,
`graylog`, `tempo` (TraceQL), `skywalking`, `pinpoint`, `pipeline` (Fluent Bit/Beats/Vector/Alloy).
Plus the pre-existing `traces`(Jaeger), `metrics`(Prometheus), `logs`(Loki), `elasticsearch`, `grafana`, `alertmanager`.

**🔁 Covered via config (no separate skill):** VictoriaMetrics/Mimir/Thanos/Cortex (point
`PROMETHEUS_URL`); OpenSearch/Quickwit/Elastic APM (`ELASTICSEARCH_URL`); SLO/delivery/chaos/policy
CRD products (Argo, Flagger, KEDA, Keptn, Kyverno, Gatekeeper, Kubewarden, Chaos Mesh, Litmus, OSM
via `kubernetes`); Sloth/Pyrra/Blackbox via `metrics`.

**🚧 Still blocked (next sprint candidates):**
- **gRPC transport** → Hubble, Pixie, Falco/Tracee, Parca *(also catches Parca profiling)*
- **Postgres wire** → TimescaleDB
- **S3 SigV4 auth** → object-storage admin APIs (MinIO/SeaweedFS/Garage/OpenIO/Ceph) — health is
  already reachable via their Prometheus `/metrics` through the `metrics` skill

**Caveats:** all 17 new skills are type-checked and pattern-consistent but **have no unit tests yet**
and have not been exercised against live backends. The hand-maintained `tools:` counts (now ×25) and
the `isAvailable: () => true` on core skills remain open debt — see the next-sprint plan.

---

## Category matrices (Core only)

### 1. Telemetry Pipelines & Collection
*Excluded (out of scope): Sysdig Agent (egress).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| OpenTelemetry Collector | pipeline.health/config | `promql` + zpages | net |
| Prometheus *(also §2)* | metrics.* / pipeline.health | `promql` | bearer |
| Grafana Alloy | pipeline.health/config | `promql` + `pipeline-admin` | net |
| Vector | pipeline.health/config | `promql` + `pipeline-admin` (GraphQL) | bearer |
| Fluent Bit | pipeline.health | `promql` + `pipeline-admin` | net |
| Fluentd | pipeline.health | `promql` (monitor plugin) | net |
| Telegraf | pipeline.health | `promql` (internal plugin) | net |
| Beats (Elastic) | pipeline.health | `pipeline-admin` (`/stats`) | net |
| Splunk OTel Collector | pipeline.health/config | `promql` + zpages | net |

### 2. Metrics / TSDB
*Excluded: Wavefront, Chronosphere (egress).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Prometheus | metrics.* | `promql` | bearer |
| Grafana Mimir | metrics.* | `promql` | bearer |
| Thanos | metrics.* | `promql` | bearer |
| VictoriaMetrics | metrics.* | `promql` | bearer |
| InfluxDB | metrics.* | `influx` | bearer |
| TimescaleDB | metrics.* | `pgsql` | basic |
| Cortex | metrics.* | `promql` | bearer |
| OpenTSDB | metrics.* | `opentsdb` | net |

### 3. Logs & Search
*Excluded: Splunk Enterprise (onprem), LogScale (onprem), Mezmo, Sumo Logic (egress).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Loki | logs.* | `logql` | bearer |
| Elasticsearch | logs.* | `esdsl` | basic/apikey |
| OpenSearch | logs.* | `esdsl` | basic |
| Graylog | logs.* | `graylog` | bearer |
| ClickHouse | logs.* | `clickhouse` | basic |
| Quickwit | logs.* | `esdsl` | net |

### 4. Distributed Tracing
*Excluded: OpenTelemetry (instrumentation, N/A), Datadog APM, Dynatrace, Honeycomb (egress).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Jaeger | traces.* | `jaeger` | bearer |
| Grafana Tempo | traces.* | `jaeger` (+ `traceql`) | bearer |
| Zipkin | traces.search/get | `zipkin` | net |
| Apache SkyWalking | traces.* / topology | `skywalking` | bearer |
| Pinpoint | traces.* | `pinpoint` | net |
| Elastic APM | traces.* | `esdsl` | basic |

### 5. Continuous Profiling
*Excluded: Polar Signals, Datadog/GCP/Dynatrace profilers (egress), Elastic Universal (onprem), perf/async-profiler/VTune (CLI).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Pyroscope | profiles.query | `pyroscope` | bearer |
| Parca | profiles.query | `parca` | grpc-tls |

### 6. eBPF / Kernel / Network Visibility — **FIRST (Camp 4 differentiator)**
*Excluded: Sysdig Monitor (egress), bcc-tools (CLI).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Hubble | flows.query | `hubble` | grpc-tls |
| Cilium | flows.query / topology / metrics | `hubble` + `k8s-crd` + `promql` | grpc-tls/sa |
| Pixie | flows.query / events.recent | `pixie` | grpc-tls |
| Falco | events.recent / policy.violations | `falco-events` | grpc-tls |
| Tracee | events.recent | `falco-events` | grpc-tls |
| Inspektor Gadget | events.recent | `k8s-crd` + `falco-events` | sa |
| Beyla | (emits OTel/Prom → feeds other layers) | via `promql`/OTLP | net |
| Katran | metrics | `promql` | net |

### 7. Object Storage
*Excluded: Cloudian, Scality, Dell ECS, StorageGRID, Red Hat ODF (onprem).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| MinIO | storage.status | `minio-admin` + `promql` | apikey |
| Ceph | storage.status | `ceph-mgr` + `promql` | bearer |
| SeaweedFS | storage.status | `s3-stats` | apikey |
| OpenIO | storage.status | `s3-stats` | apikey |
| Garage | storage.status | `s3-stats` | apikey |

### 8. Service Mesh / Traffic / Resilience
*Excluded: Gloo Mesh (onprem).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Envoy | mesh.config/status / metrics | `envoy-admin` + `promql` | net |
| Istio | mesh.* / topology / metrics | `k8s-crd` + `envoy-admin` + `promql` | sa |
| Linkerd | mesh.* / metrics | Linkerd viz + `promql` | sa |
| Cilium Service Mesh | flows / mesh.* | `hubble` + `k8s-crd` + `promql` | grpc-tls/sa |
| Consul Connect | mesh.* / topology | `consul-api` | bearer |
| Kong Gateway | mesh.status / metrics | `kong-admin` + `promql` | apikey |
| NGINX Service Mesh | metrics / status | `promql` + NGINX status | net |
| Traefik Mesh | mesh.status / metrics | `traefik-api` + `promql` | net |
| Open Service Mesh | mesh.* | `k8s-crd` + `promql` | sa |

### 9. SLO / Progressive Delivery / Automation
*Excluded: Nobl9 (egress).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Sloth | slo.status | `promql` (generated rules) | bearer |
| Pyrra | slo.status | Pyrra API + `promql` | net |
| Argo Rollouts | rollout.status | `k8s-crd` | sa |
| Flagger | rollout.status | `k8s-crd` | sa |
| Spinnaker | rollout.status | Spinnaker (Gate) API | bearer |
| KEDA | rollout.status (scaling) | `k8s-crd` | sa |
| Argo Events | rollout.status (events) | `k8s-crd` | sa |
| Rundeck | experiment/job status | Rundeck API | apikey |
| Keptn | rollout.status | `k8s-crd` / Keptn API | sa |

### 10. Governance / Policy-as-Code
*Excluded: Sentinel (onprem/egress), Conftest/Checkov/Chainsaw (CLI), Cloud Custodian (egress).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Open Policy Agent (OPA) | policy.violations | `opa-rest` | bearer |
| Gatekeeper | policy.violations | `k8s-crd` | sa |
| Kyverno | policy.violations | `k8s-crd` | sa |
| Kubewarden | policy.violations | `k8s-crd` | sa |
| Falco | policy.violations / events.recent | `falco-events` | grpc-tls |

### 11. Chaos / Synthetic
*Excluded: Gremlin, Steadybit (egress), PowerfulSeal/Pumba (CLI), Grafana SM/Checkly/Catchpoint (egress).*

| Product | Capabilities | Adapter | Auth |
|---|---|---|---|
| Chaos Mesh | experiment.status | `k8s-crd` | sa |
| LitmusChaos | experiment.status | `k8s-crd` | sa |
| Blackbox Exporter | synthetic.results | `promql` | net |

---

## Reuse summary

| | Count |
|---|---|
| Core products in scope | ~70 |
| **Distinct adapters to build** | **~30** |
| Already built / ~80% present | `promql`, `logql`, `jaeger`, `esdsl` → **~18 products day one** |
| `promql` covers | 5 TSDBs + every `/metrics` self-metrics surface |
| `k8s-crd` covers | ~14 products across mesh / SLO / governance / chaos |
| New gRPC adapters | `hubble`, `pixie`, `falco-events`, `parca` |

## Sequencing — eBPF-first

The current code is HTTP-only and coupled to Jaeger/Prometheus/Loki. Going eBPF-first is
**greenfield**, which makes it the ideal place to establish the new framework — no refactor risk —
and it forces the hardest transport (gRPC) in from day one rather than bolting it on later.

1. **Phase 1 — Framework + eBPF layer (merged).** Build the capability/provider/registry framework
   *and* its first providers as the eBPF layer. New capabilities `flows.query` + `events.recent`;
   new adapters `hubble`, `pixie`, `falco-events`, plus `k8s-crd` (Cilium/IG control plane) and
   `promql` reuse (Beyla/Katran/cilium-agent metrics). **~4 new adapters unlock the whole Camp 4 layer.**
   Establishes gRPC transport + the connection registry + `grpc-tls`/`sa` auth as framework primitives.
2. **Phase 2 — Migrate the existing three layers.** Move traces→`jaeger`, metrics→`promql`,
   logs→`logql` onto the framework. Now multi-provider, so Tempo / VictoriaMetrics / OpenSearch
   drop in as config.
3. **Phase 3 — Query breadth + profiling.** TSDB/log/trace long tail; Pyroscope + Parca
   (`parca` reuses the Phase-1 gRPC transport).
4. **Phase 4 — Control plane.** `k8s-crd` (built in Phase 1) makes mesh / SLO / governance / chaos
   status cheap to finish.

## Open items for the ADR

1. **Connection registry** — named multi-instance providers with per-instance scope/labels.
2. **Transport abstraction** — HTTP *and* gRPC (+ streaming-to-bounded-query for `events.recent`).
3. **Auth extensions** — `sa`, `mtls`, `grpc-tls` beyond today's bearer/basic/header.
4. **Capability routing** — explicit `source` param vs. auto-route by capability + scope.
5. **Read-only invariant** — all capabilities here are read-only; any future action surface gated
   behind explicit opt-in + approval, consistent with [docs/studio-user-journeys.md](studio-user-journeys.md).
