/**
 * MCP resources — auto-generated context documents for AI agents.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Skill } from '../skill.js';

export function registerResources(server: McpServer, skills: Skill[]): void {
  server.resource(
    'platform-overview',
    'otel://overview',
    async () => ({
      contents: [{
        uri: 'otel://overview',
        mimeType: 'text/markdown',
        text: generateOverview(skills),
      }],
    }),
  );
}

function generateOverview(skills: Skill[]): string {
  const totalTools = skills.reduce((sum, s) => sum + s.tools, 0);

  const skillSections = skills.map(s =>
    `### ${s.name} — \`${s.id}\` (${s.tools} tools)\n` +
    `${s.description}.\n` +
    `Backends: ${s.backends.join(', ')}`,
  ).join('\n\n');

  return `# OpenTelemetry MCP Server — Platform Overview

## Active Skills (${skills.length} skills, ${totalTools} tools)

${skillSections}

## Self-Metrics

The server exposes its own metrics at \`GET /metrics\` (HTTP mode):
- \`mcp_backend_requests_total\` — Outbound backend request counter
- \`mcp_backend_duration_seconds\` — Backend request latency histogram
- \`mcp_auth_attempts_total\` — Authentication attempt counter
- \`mcp_active_sessions\` — Current connected sessions gauge
- \`mcp_uptime_seconds\` — Server uptime

## Common Workflows

### Switch trace backend
The \`traces\` skill is provider-agnostic. Set \`TRACES_PROVIDER\` to one of
\`jaeger\` (default), \`tempo\`, \`zipkin\`, or \`skywalking\` and point the
matching URL var (e.g. \`TRACES_TEMPO_URL\`, legacy \`TEMPO_URL\` still works).
The verb surface (\`traces_search\`, \`trace_get\`, \`traces_services\`,
\`traces_operations\`, \`traces_dependencies\`) is the same across providers;
capabilities the chosen backend doesn't support return a clear error.

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

### Inspect eBPF networking (Cilium)
1. \`cilium_health\` to confirm the agent and datapath are healthy
2. \`cilium_endpoints\` to map pods to security identities and state
3. \`cilium_services\` for eBPF load-balancer programming
4. \`cilium_policy\` to see the enforced network policy

### Triage a service with eBPF auto-instrumentation (Beyla)
1. \`beyla_services\` to see which services Beyla is instrumenting and their request rates
2. \`beyla_red_metrics\` for one service's rate, error %, and p50/p95/p99 latency
3. \`beyla_top_routes\` to find which HTTP routes are slow or hot
4. \`beyla_network_flows\` for top service-to-service traffic (network metrics enabled)

### Inspect control-plane state via Kubernetes CRDs
1. \`k8s_api_resources\` to discover which products/CRDs are installed
2. \`k8s_list\` with the group/version/plural (e.g. group="argoproj.io" plural="rollouts")
3. \`k8s_get\` for a single object's full status
4. \`k8s_events\` with \`type: "Warning"\` to see what's failing

### Search logs in ClickHouse
1. \`clickhouse_tables\` to find the log table
2. \`clickhouse_table_schema\` to confirm the time/message/level columns
3. \`clickhouse_logs_search\` (or \`clickhouse_query\` for custom SQL) to retrieve lines

### Find a CPU/memory hotspot (Pyroscope)
1. \`pyroscope_profile_types\` to see available profiles
2. \`pyroscope_label_values\` with \`label: "service_name"\` to find your service
3. \`pyroscope_render\` to get the heaviest functions by self time

### Check policy decisions (OPA)
1. \`opa_policies\` to see loaded modules
2. \`opa_query\` with \`q: "data.<pkg>.deny[msg]"\` to enumerate violations
3. \`opa_data\` to fetch a specific decision document

### Debug service-mesh routing
1. \`consul_checks\` or \`traefik_services\` to find unhealthy targets
2. \`envoy_clusters\` to see which upstream endpoints are failing health checks
3. \`kong_routes\` / \`traefik_routers\` to confirm how requests are routed
4. \`envoy_stats\` with a \`filter\` like "upstream_rq_5xx" for error counts
`;
}
