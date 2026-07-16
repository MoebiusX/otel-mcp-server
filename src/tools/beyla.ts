/**
 * Beyla skill — query application RED metrics and network flows that Grafana
 * Beyla generates via eBPF auto-instrumentation.
 *
 * Beyla has no query API of its own: it auto-instruments processes with eBPF
 * (zero code changes) and *exports* OpenTelemetry/Prometheus metrics. The
 * self-hosted query path is therefore a Prometheus-compatible store that has
 * scraped Beyla (or Beyla's own `/metrics` exposition behind a Prometheus).
 * This skill speaks PromQL to that store but exposes Beyla-aware, semantic
 * tools so the agent does not need to know Beyla's metric/label schema. The
 * label names are the Prometheus-normalized form (OTel dots → underscores),
 * e.g. `service_name`, `http_route`, `http_response_status_code`.
 *
 * Read-only. OSS, self-hosted.
 *
 * Tools: beyla_services, beyla_red_metrics, beyla_top_routes,
 *        beyla_network_flows
 *
 * Enabled when `BEYLA_PROMETHEUS_URL` is set (the Prometheus that holds Beyla's
 * metrics, e.g. http://prometheus:9090). Auth via BEYLA_AUTH_* if needed.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

/**
 * RED-metric "kind" → the Beyla histogram base name and the label/predicate
 * that marks an errored request. Beyla follows OTel HTTP/RPC/DB semconv, so the
 * server duration histograms share a common `_count` / `_bucket` shape.
 */
const KINDS = {
  http_server: {
    metric: 'http_server_request_duration_seconds',
    errorSelector: 'http_response_status_code=~"5.."',
  },
  http_client: {
    metric: 'http_client_request_duration_seconds',
    errorSelector: 'http_response_status_code=~"5.."',
  },
  rpc_server: {
    metric: 'rpc_server_duration_seconds',
    errorSelector: 'rpc_grpc_status_code!="0"',
  },
  db_client: {
    metric: 'db_client_operation_duration_seconds',
    errorSelector: '', // no standard error label — error rate left null
  },
} as const;

type Kind = keyof typeof KINDS;

/** A PromQL label matcher that is safe against injection of `"` and `\`. */
function matcher(label: string, value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${label}="${escaped}"`;
}

/** Extract the scalar value of a single-series instant vector, or null. */
function scalar(result: any[]): number | null {
  const v = result?.[0]?.value?.[1];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('BEYLA_PROMETHEUS_URL', 'http://localhost:9090');
  const fetchJSON = helpers.createFetcher('BEYLA', 'beyla');

  /** Run an instant PromQL query and return its `data.result` array. */
  const instant = async (query: string): Promise<any[]> => {
    const qs = new URLSearchParams({ query });
    const data = await fetchJSON(`${baseUrl}/api/v1/query?${qs}`);
    return data?.data?.result ?? [];
  };

  // ── beyla_services ──────────────────────────────────────────────────────
  // Discover the services Beyla is auto-instrumenting, by the presence of its
  // request-count series. Useful as the entry point before drilling into RED.

  server.tool(
    'beyla_services',
    'List the services Grafana Beyla is auto-instrumenting (discovered from its HTTP/RPC/DB request-count series), with each one\'s current request rate.',
    {
      window: z.string().default('5m').describe('Rate window for the request rate (e.g. "1m", "5m")'),
    },
    async ({ window }) => {
      try {
        const counts = `{__name__=~"http_server_request_duration_seconds_count|rpc_server_duration_seconds_count|db_client_operation_duration_seconds_count"}`;
        const result = await instant(
          `sort_desc(sum by (service_name) (rate(${counts}[${window}])))`,
        );
        const services = result.map((s: any) => ({
          service: s.metric?.service_name ?? null,
          requestRate: scalar([s]),
        }));
        return textResult({ count: services.length, window, services });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── beyla_red_metrics ───────────────────────────────────────────────────
  // Rate / Errors / Duration for one service, computed from Beyla's duration
  // histogram (request rate from `_count`, latency quantiles from `_bucket`).

  server.tool(
    'beyla_red_metrics',
    'Get RED metrics (request Rate, Error rate, and Duration percentiles) for a Beyla-instrumented service over a window, computed from its OTel duration histogram.',
    {
      service: z.string().describe('Service name (the `service_name` label, e.g. "checkout")'),
      kind: z.enum(['http_server', 'http_client', 'rpc_server', 'db_client'])
        .default('http_server')
        .describe('Which signal to summarize: inbound HTTP (http_server), outbound HTTP (http_client), gRPC (rpc_server), or DB calls (db_client)'),
      window: z.string().default('5m').describe('Rate/quantile window (e.g. "1m", "5m")'),
    },
    async ({ service, kind, window }) => {
      try {
        const { metric, errorSelector } = KINDS[kind as Kind];
        const svc = matcher('service_name', service);
        const sel = `{${svc}}`;

        const rate = scalar(await instant(`sum(rate(${metric}_count${sel}[${window}]))`));

        let errorRate: number | null = null;
        let errorPct: number | null = null;
        if (errorSelector) {
          errorRate = scalar(
            await instant(`sum(rate(${metric}_count{${svc},${errorSelector}}[${window}]))`),
          );
          if (rate !== null && rate > 0 && errorRate !== null) {
            errorPct = +(100 * errorRate / rate).toFixed(3);
          }
        }

        const buckets = `sum by (le) (rate(${metric}_bucket${sel}[${window}]))`;
        const q = async (p: number) =>
          scalar(await instant(`histogram_quantile(${p}, ${buckets})`));
        const [p50, p95, p99] = await Promise.all([q(0.5), q(0.95), q(0.99)]);

        return textResult({
          service,
          kind,
          window,
          requestRate: rate,
          errorRate,
          errorPct,
          latencySeconds: { p50, p95, p99 },
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── beyla_top_routes ────────────────────────────────────────────────────
  // Busiest HTTP routes for a service, with per-route p95 latency — the usual
  // next step after RED flags a service as hot or slow.

  server.tool(
    'beyla_top_routes',
    'List the busiest HTTP routes for a Beyla-instrumented service, each with its request rate and p95 latency. Routes come from the `http_route` label (low-cardinality templated paths).',
    {
      service: z.string().describe('Service name (the `service_name` label)'),
      side: z.enum(['server', 'client']).default('server')
        .describe('Inbound routes this service serves (server) or outbound calls it makes (client)'),
      window: z.string().default('5m').describe('Rate/quantile window'),
      max_routes: z.number().default(10).describe('How many top routes to return'),
    },
    async ({ service, side, window, max_routes }) => {
      try {
        const metric = side === 'client'
          ? 'http_client_request_duration_seconds'
          : 'http_server_request_duration_seconds';
        const svc = matcher('service_name', service);
        const sel = `{${svc}}`;

        const rates = await instant(
          `topk(${max_routes}, sum by (http_route) (rate(${metric}_count${sel}[${window}])))`,
        );
        const p95s = await instant(
          `histogram_quantile(0.95, sum by (le, http_route) (rate(${metric}_bucket${sel}[${window}])))`,
        );
        const p95ByRoute = new Map<string, number | null>();
        for (const s of p95s) p95ByRoute.set(s.metric?.http_route ?? '', scalar([s]));

        const routes = rates.map((s: any) => {
          const route = s.metric?.http_route ?? '(unset)';
          return {
            route,
            requestRate: scalar([s]),
            p95Seconds: p95ByRoute.get(route) ?? null,
          };
        });
        return textResult({ service, side, window, count: routes.length, routes });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── beyla_network_flows ─────────────────────────────────────────────────
  // Top network flows by throughput, from Beyla's eBPF network metrics (only
  // present when Beyla is run with network metrics enabled).

  server.tool(
    'beyla_network_flows',
    'List the top network flows by throughput from Beyla\'s eBPF network metrics (beyla_network_flow_bytes_total), grouped by source/destination workload and namespace. Requires Beyla network metrics to be enabled.',
    {
      window: z.string().default('5m').describe('Rate window for throughput (e.g. "1m", "5m")'),
      max_flows: z.number().default(15).describe('How many top flows to return'),
    },
    async ({ window, max_flows }) => {
      try {
        const groupBy = 'k8s_src_owner_name, k8s_dst_owner_name, k8s_src_namespace, k8s_dst_namespace';
        const result = await instant(
          `topk(${max_flows}, sum by (${groupBy}) (rate(beyla_network_flow_bytes_total[${window}])))`,
        );
        const flows = result.map((s: any) => {
          const m = s.metric ?? {};
          return {
            src: `${m.k8s_src_namespace ?? '?'}/${m.k8s_src_owner_name ?? '?'}`,
            dst: `${m.k8s_dst_namespace ?? '?'}/${m.k8s_dst_owner_name ?? '?'}`,
            bytesPerSecond: scalar([s]),
          };
        });
        return textResult({ window, count: flows.length, flows });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'beyla',
  name: 'Grafana Beyla (eBPF auto-instrumentation)',
  description: 'Query application RED metrics and network flows that Grafana Beyla generates via eBPF, through a Prometheus-compatible store',
  tools: 4,
  backends: ['Grafana Beyla'],
  isAvailable: () => !!process.env['BEYLA_PROMETHEUS_URL'],
  register: registerTools,
};
