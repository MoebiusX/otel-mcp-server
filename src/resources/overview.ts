/**
 * MCP resources — pre-built context documents for AI agents.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerResources(server: McpServer): void {
  server.resource(
    'platform-overview',
    'otel://overview',
    async () => ({
      contents: [{
        uri: 'otel://overview',
        mimeType: 'text/markdown',
        text: `# OpenTelemetry MCP Server — Platform Overview

## Telemetry Signals

| Signal   | Backend       | API                          |
|----------|---------------|------------------------------|
| Traces   | Jaeger        | \`/api/traces\`, \`/api/services\`, \`/api/dependencies\` |
| Metrics  | Prometheus    | \`/api/v1/query\`, \`/api/v1/query_range\`, \`/api/v1/targets\` |
| Logs     | Loki          | \`/loki/api/v1/query_range\`, \`/loki/api/v1/labels\` |
| Search   | Elasticsearch | \`/_search\`, \`/_cluster/health\`, \`/_cat/indices\` |
| Alerts   | Alertmanager  | \`/api/v2/alerts\`, \`/api/v2/silences\` |

## Available Tool Groups

### Traces (5 tools)
- \`traces_search\` — Search traces by service, operation, tags, duration
- \`trace_get\` — Full trace detail with all spans
- \`traces_services\` — List reporting services
- \`traces_operations\` — List operations per service
- \`traces_dependencies\` — Service dependency graph

### Metrics (6 tools)
- \`metrics_query\` — Instant PromQL query
- \`metrics_query_range\` — Range PromQL query (time series)
- \`metrics_targets\` — Scrape target health
- \`metrics_alerts\` — Alert rules and state
- \`metrics_metadata\` — Metric type/help/unit lookup
- \`metrics_label_values\` — Label value enumeration

### Logs (4 tools)
- \`logs_query\` — LogQL query
- \`logs_labels\` — Available label names
- \`logs_label_values\` — Values for a label
- \`logs_tail_context\` — Logs correlated with a trace ID

### Elasticsearch (5 tools) — optional
- \`es_search\` — Full-text search across indices
- \`es_cluster_health\` — Cluster health status
- \`es_indices\` — List indices with stats
- \`es_index_mapping\` — Field mappings for an index
- \`es_cat_nodes\` — Node resource usage

### Alertmanager (4 tools) — optional
- \`alertmanager_alerts\` — Active alerts with routing status
- \`alertmanager_silences\` — Active and expired silences
- \`alertmanager_groups\` — Alert groups by routing rules
- \`alertmanager_status\` — Cluster and config status

### ZK Proofs (4 tools) — optional
- \`zk_proof_get\` — Retrieve a ZK-SNARK proof
- \`zk_proof_verify\` — Verify a proof
- \`zk_solvency\` — Latest solvency proof
- \`zk_stats\` — Proof statistics

### System (4 tools) — optional
- \`anomalies_active\` — Active anomalies
- \`anomalies_baselines\` — Detection baselines
- \`system_health\` — Full health check
- \`system_topology\` — Service dependency topology

## Self-Metrics

The server exposes its own metrics at \`GET /metrics\` (HTTP mode):
- \`mcp_tool_calls_total\` — Tool call counter by tool name and status
- \`mcp_tool_duration_seconds\` — Tool call latency histogram
- \`mcp_backend_requests_total\` — Outbound backend request counter
- \`mcp_backend_duration_seconds\` — Backend request latency histogram
- \`mcp_auth_attempts_total\` — Authentication attempt counter
- \`mcp_active_sessions\` — Current connected sessions gauge
- \`mcp_uptime_seconds\` — Server uptime

## Common Workflows

### Investigate a slow request
1. \`traces_search\` with \`min_duration: "1s"\` to find slow traces
2. \`trace_get\` with the trace ID to see all spans
3. \`logs_tail_context\` with the trace ID for correlated logs
4. \`metrics_query\` for resource metrics at that time

### Check system health
1. \`metrics_targets\` for scrape target status
2. \`metrics_alerts\` with \`filter: "firing"\` for active alerts
3. \`alertmanager_alerts\` for routed alert status
4. \`system_health\` for application-level health
5. \`traces_dependencies\` for service topology

### Search logs across Elasticsearch
1. \`es_cluster_health\` to verify cluster status
2. \`es_indices\` to find relevant indices
3. \`es_search\` with Lucene query for full-text log search
`,
      }],
    }),
  );
}
