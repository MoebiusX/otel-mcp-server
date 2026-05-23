# Docker Live Skill Testing

The live-test harness runs the MCP server against real local Docker endpoints, one skill at a time. It complements the normal Vitest suite: unit tests stay fast and mocked, while this path validates the container image, HTTP transport, API-key auth, backend URLs, MCP tool listing, one smoke tool call, and `/metrics` output.

## Prerequisites

- Node.js 20+
- Docker Desktop or another Docker engine with Compose v2
- Enough local memory to run one fixture plus one MCP server container at a time; Elasticsearch is the heaviest default fixture

## Commands

```bash
npm run test:live

# Equivalent explicit profile
npm run test:live:standard

# Run a single skill while iterating
node scripts/live-test.mjs --skill metrics

# Run a single skill without rebuilding the image
node scripts/live-test.mjs --skill grafana --no-build

# Keep the fixture for inspection after the skill finishes
node scripts/live-test.mjs --skill grafana --keep-fixtures --no-build

# Keep a failed MCP skill container around for docker logs/exec inspection
node scripts/live-test.mjs --skill tempo --keep-containers-on-fail

# Start each fixture one by one, but keep them running for the whole profile
node scripts/live-test.mjs --fixture-mode sequential

# Start fixtures all at once instead of the default isolated mode
node scripts/live-test.mjs --fixture-mode all
```

The harness writes JSON reports to `.live-test-results/`, which is ignored by git.

Open `docs/live-test-report-viewer.html` in a browser to load a report JSON and review the run as a searchable table.

Each completed test prints a compact one-line record with the skill/tool tested, the arguments sent, and the summarized response:

```text
PASS metrics          tested=metrics/metrics_query sent={"query":"up"} response={"status":"success","data":{"type":"object","keys":["resultType","result"]}} duration=65ms tools=6/6
```

## What It Does

1. Runs `npm run build`.
2. Builds `otel-mcp-server:live-test` from the repo `Dockerfile`.
3. For each skill, pulls, starts, and readiness-checks only the fixture services listed for that skill in `tests/live-test-matrix.json`.
4. Starts a fresh MCP container for the skill with `--http 3001 --tools <skill>`.
5. Calls the smoke tool, removes the MCP container, then stops and removes that skill's fixture container before moving to the next skill.
6. Enables MCP HTTP API-key auth through `MCP_AUTH_KEYS`.
7. Checks `/health`, lists tools through MCP, calls one read-only smoke tool, and checks `/metrics`.
8. Prints a pass/fail/skip summary with one compact request/response line per skill and writes a JSON report.

The default `isolated` fixture mode is intentionally light on Docker Desktop: only the current skill's backend fixture and MCP server container should be running. Use `--fixture-mode sequential` when you want to start each fixture one by one but keep all fixtures up for the rest of the run, or `--fixture-mode all` when you want the old all-at-once Compose behavior.

Backend URLs use Docker service names because the MCP server runs inside Docker. For example, the Prometheus skill receives `PROMETHEUS_URL=http://prometheus:9090`.

## Standard Profile Coverage

| Skill | Fixture | Smoke tool |
| --- | --- | --- |
| `traces` | Jaeger | `traces_services` |
| `metrics` | Prometheus | `metrics_query` |
| `logs` | Loki | `logs_labels` |
| `elasticsearch` | Elasticsearch | `es_cluster_health` |
| `alertmanager` | Alertmanager | `alertmanager_status` |
| `grafana` | Grafana | `grafana_health` |
| `clickhouse` | ClickHouse | `clickhouse_databases` |
| `pyroscope` | Pyroscope | `pyroscope_profile_types` |
| `opa` | OPA | `opa_health` |
| `zipkin` | Zipkin | `zipkin_services` |
| `tempo` | Tempo | `tempo_tags` |
| `envoy` | Envoy | `envoy_server_info` |
| `consul` | Consul | `consul_health` |
| `kong` | Kong DB-less | `kong_status` |
| `traefik` | Traefik | `traefik_overview` |
| `influx` | InfluxDB 1.8 | `influx_health` |
| `pipeline` | Fluent Bit | `pipeline_fluentbit` |
| `zk-proofs` | Local APP_API fixture | `zk_stats` |
| `system` | Local APP_API fixture | `system_health` |

## Explicitly Skipped In Standard

These skills are still represented in `tests/live-test-matrix.json`, but are skipped with a reason when the `standard` profile is selected:

| Skill | Reason |
| --- | --- |
| `cilium` | Needs Kubernetes plus Cilium/eBPF support. |
| `kubernetes` | Needs a real kube-apiserver, token, and CA. |
| `opentsdb` | Needs HBase and ZooKeeper. |
| `graylog` | Needs Graylog plus MongoDB and Elasticsearch/OpenSearch. |
| `skywalking` | Heavy OAP stack with storage dependencies. |
| `pinpoint` | Multi-service Pinpoint stack. |

Those should become separate `full` or `kind` profiles rather than slowing down the default local loop.

## Troubleshooting

- If Docker ports are already in use, stop the conflicting local service or edit `docker-compose.live.yml` before running the harness.
- If a fixture is slow on first pull, rerun the command after images finish downloading.
- If a skill fails, inspect the JSON report in `.live-test-results/` and rerun the skill with `--keep-containers-on-fail`.
- To clean up fixtures manually, run:

```bash
docker compose -f docker-compose.live.yml -p otel-mcp-live down -v --remove-orphans
```