/**
 * Zipkin skill — query distributed traces via the Zipkin API v2.
 *
 * Mirrors the Jaeger traces skill's shape so an agent can use either backend
 * with the same mental model. Read-only.
 *
 * Tools: zipkin_services, zipkin_spans, zipkin_traces_search, zipkin_trace_get,
 *        zipkin_dependencies
 *
 * Enabled when `ZIPKIN_URL` is set (e.g. http://zipkin:9411).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult, parseDuration } from '../helpers.js';

/** Zipkin timestamps and durations are in microseconds. */
function usToIso(us: number): string {
  return new Date(us / 1000).toISOString();
}

function summarizeTrace(spans: any[]): any {
  const root = spans.find((s) => !s.parentId) || spans[0] || {};
  const starts = spans.map((s) => s.timestamp || 0).filter(Boolean);
  const ends = spans.map((s) => (s.timestamp || 0) + (s.duration || 0));
  const start = starts.length ? Math.min(...starts) : 0;
  const end = ends.length ? Math.max(...ends) : 0;
  const services = Array.from(new Set(
    spans.map((s) => s.localEndpoint?.serviceName).filter(Boolean),
  ));
  return {
    traceId: root.traceId || spans[0]?.traceId,
    rootOperation: root.name || null,
    spanCount: spans.length,
    duration_ms: start ? (end - start) / 1000 : null,
    services,
    startTime: start ? usToIso(start) : null,
    hasErrors: spans.some((s) => s.tags && ('error' in s.tags)),
  };
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('ZIPKIN_URL', 'http://localhost:9411');
  const fetchJSON = helpers.createFetcher('ZIPKIN', 'zipkin');

  // ── zipkin_services ───────────────────────────────────────────────────────

  server.tool(
    'zipkin_services',
    'List all services reporting spans to Zipkin.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/v2/services`);
        return textResult({ services: data || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── zipkin_spans ──────────────────────────────────────────────────────────

  server.tool(
    'zipkin_spans',
    'List span (operation) names for a given service.',
    { service: z.string().describe('Service name') },
    async ({ service }) => {
      try {
        const qs = new URLSearchParams({ serviceName: service });
        const data = await fetchJSON(`${baseUrl}/api/v2/spans?${qs}`);
        return textResult({ service, spans: data || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── zipkin_traces_search ──────────────────────────────────────────────────

  server.tool(
    'zipkin_traces_search',
    'Search traces by service, span name, duration, or tags. Returns trace summaries with timing, span count, and error status.',
    {
      service: z.string().describe('Service name'),
      span_name: z.string().optional().describe('Filter by span/operation name'),
      min_duration: z.string().optional().describe('Minimum duration (e.g. "500ms", "1s")'),
      annotation_query: z.string().optional().describe('Tag/annotation query (e.g. "http.status_code=500 and error")'),
      lookback: z.string().default('1h').describe('Time window (e.g. "1h", "30m", "2d")'),
      limit: z.number().default(10).describe('Max traces to return'),
    },
    async (p) => {
      try {
        const qs = new URLSearchParams({
          serviceName: p.service,
          endTs: String(Date.now()),
          lookback: String(parseDuration(p.lookback)),
          limit: String(p.limit),
        });
        if (p.span_name) qs.set('spanName', p.span_name);
        if (p.annotation_query) qs.set('annotationQuery', p.annotation_query);
        if (p.min_duration) qs.set('minDuration', String(Math.round(parseDuration(p.min_duration) * 1000))); // ms → µs

        const data = await fetchJSON(`${baseUrl}/api/v2/traces?${qs}`);
        const traces = (Array.isArray(data) ? data : []).map((spans: any[]) => summarizeTrace(spans));
        return textResult({ count: traces.length, traces });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── zipkin_trace_get ──────────────────────────────────────────────────────

  server.tool(
    'zipkin_trace_get',
    'Get full trace detail — all spans with timing, service, tags, and parent-child relationships.',
    { trace_id: z.string().describe('Zipkin trace ID (hex string)') },
    async ({ trace_id }) => {
      try {
        const spans = await fetchJSON(`${baseUrl}/api/v2/trace/${encodeURIComponent(trace_id)}`);
        if (!Array.isArray(spans) || spans.length === 0) {
          return errorResult(`Trace ${trace_id} not found`);
        }
        const mapped = spans.map((s: any) => ({
          spanId: s.id,
          parentSpanId: s.parentId || null,
          name: s.name,
          service: s.localEndpoint?.serviceName || null,
          duration_ms: (s.duration || 0) / 1000,
          startTime: s.timestamp ? usToIso(s.timestamp) : null,
          tags: s.tags || {},
        }));
        return textResult({ ...summarizeTrace(spans), spans: mapped });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── zipkin_dependencies ───────────────────────────────────────────────────

  server.tool(
    'zipkin_dependencies',
    'Get the service dependency graph — which services call which, with call counts.',
    { lookback: z.string().default('1d').describe('Time window to compute dependencies (e.g. "1h", "1d")') },
    async ({ lookback }) => {
      try {
        const qs = new URLSearchParams({
          endTs: String(Date.now()),
          lookback: String(parseDuration(lookback)),
        });
        const data = await fetchJSON(`${baseUrl}/api/v2/dependencies?${qs}`);
        return textResult({ dependencies: data || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'zipkin',
  name: 'Zipkin Traces',
  description: 'Search and analyze distributed traces via the Zipkin API v2',
  tools: 5,
  backends: ['Zipkin'],
  isAvailable: () => !!process.env['ZIPKIN_URL'],
  register: registerTools,
};
