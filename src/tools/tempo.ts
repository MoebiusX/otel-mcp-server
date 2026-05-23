/**
 * Tempo skill — Grafana Tempo's native TraceQL search API.
 *
 * Note: Tempo also exposes a Jaeger-compatible query API, which the `traces`
 * (Jaeger) skill can target by pointing `JAEGER_URL` at Tempo. This skill adds
 * the richer native surface — TraceQL search and tag discovery. Read-only.
 *
 * Tools: tempo_search, tempo_trace_get, tempo_tags, tempo_tag_values
 *
 * Enabled when `TEMPO_URL` is set (e.g. http://localhost:3200).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult, parseDuration } from '../helpers.js';

/** Extract a scalar from an OTLP attribute value object. */
function attrValue(v: any): any {
  if (v == null) return null;
  return v.stringValue ?? v.intValue ?? v.boolValue ?? v.doubleValue ?? v.arrayValue ?? null;
}

function flattenAttrs(attrs: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of attrs || []) out[a.key] = attrValue(a.value);
  return out;
}

/** Nanosecond epoch string → ISO; uses BigInt to avoid precision loss. */
function nanoToIso(nano?: string): string | null {
  if (!nano) return null;
  try {
    return new Date(Number(BigInt(nano) / 1_000_000n)).toISOString();
  } catch {
    return null;
  }
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('TEMPO_URL', 'http://localhost:3200');
  const fetchJSON = helpers.createFetcher('TEMPO', 'tempo');

  // ── tempo_search ──────────────────────────────────────────────────────────

  server.tool(
    'tempo_search',
    'Search traces with TraceQL. Returns trace summaries with root service/operation, duration, and start time.',
    {
      query: z.string().describe('TraceQL query (e.g. \'{ duration > 1s && resource.service.name = "api" }\')'),
      lookback: z.string().default('1h').describe('Time window (e.g. "1h", "30m", "2d")'),
      limit: z.number().default(20).describe('Max traces to return'),
    },
    async ({ query, lookback, limit }) => {
      try {
        const end = Math.floor(Date.now() / 1000);
        const start = end - Math.floor(parseDuration(lookback) / 1000);
        const qs = new URLSearchParams({ q: query, start: String(start), end: String(end), limit: String(limit) });
        const data = await fetchJSON(`${baseUrl}/api/search?${qs}`);
        const traces = (data.traces || []).map((t: any) => ({
          traceId: t.traceID,
          rootService: t.rootServiceName,
          rootOperation: t.rootTraceName,
          durationMs: t.durationMs ?? null,
          startTime: nanoToIso(t.startTimeUnixNano),
        }));
        return textResult({ count: traces.length, traces });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── tempo_trace_get ───────────────────────────────────────────────────────

  server.tool(
    'tempo_trace_get',
    'Get a full trace by ID — all spans with service, timing, and attributes.',
    { trace_id: z.string().describe('Tempo trace ID (hex string)') },
    async ({ trace_id }) => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/traces/${encodeURIComponent(trace_id)}`);
        const batches = data.batches || data.resourceSpans || [];
        const spans: any[] = [];
        for (const b of batches) {
          const service = flattenAttrs(b.resource?.attributes)['service.name'] || null;
          const scopeSpans = b.scopeSpans || b.instrumentationLibrarySpans || [];
          for (const ss of scopeSpans) {
            for (const s of ss.spans || []) {
              let duration_ms: number | null = null;
              try {
                if (s.startTimeUnixNano && s.endTimeUnixNano) {
                  duration_ms = Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1e6;
                }
              } catch { /* leave null */ }
              spans.push({
                spanId: s.spanId,
                parentSpanId: s.parentSpanId || null,
                name: s.name,
                service,
                startTime: nanoToIso(s.startTimeUnixNano),
                duration_ms,
                attributes: flattenAttrs(s.attributes),
              });
            }
          }
        }
        if (spans.length === 0) return errorResult(`Trace ${trace_id} not found or empty`);
        return textResult({
          traceId: trace_id,
          spanCount: spans.length,
          services: Array.from(new Set(spans.map((s) => s.service).filter(Boolean))),
          spans,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── tempo_tags ────────────────────────────────────────────────────────────

  server.tool(
    'tempo_tags',
    'List searchable tag names.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/search/tags`);
        return textResult({ tagNames: data.tagNames || data.scopes || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── tempo_tag_values ──────────────────────────────────────────────────────

  server.tool(
    'tempo_tag_values',
    'List values for a given tag name.',
    { tag: z.string().describe('Tag name (e.g. "service.name")') },
    async ({ tag }) => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/search/tag/${encodeURIComponent(tag)}/values`);
        return textResult({ tag, tagValues: data.tagValues || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'tempo',
  name: 'Grafana Tempo (TraceQL)',
  description: 'Search traces with TraceQL and inspect trace detail via the native Tempo API',
  tools: 4,
  backends: ['Tempo'],
  isAvailable: () => !!process.env['TEMPO_URL'],
  register: registerTools,
};
