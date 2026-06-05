/**
 * Grafana Tempo trace provider (native TraceQL API).
 *
 * Reads `TRACES_TEMPO_URL` (preferred) or legacy `TEMPO_URL`. Auth via `TEMPO_AUTH_*`.
 *
 * Capabilities: search (TraceQL), getTrace (OTLP decode), services and operations
 * (synthesized from tag values). Dependencies are not exposed by the Tempo API.
 */

import type { SkillHelpers } from '../../skill.js';
import { parseDuration } from '../../helpers.js';
import type { TracesProvider, TracesProviderFactory, TracesSearchParams } from './types.js';

function attrValue(v: any): any {
  if (v == null) return null;
  return v.stringValue ?? v.intValue ?? v.boolValue ?? v.doubleValue ?? v.arrayValue ?? null;
}

function flattenAttrs(attrs: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of attrs || []) out[a.key] = attrValue(a.value);
  return out;
}

function nanoToIso(nano?: string): string | null {
  if (!nano) return null;
  try {
    return new Date(Number(BigInt(nano) / 1_000_000n)).toISOString();
  } catch {
    return null;
  }
}

/** Build a TraceQL filter from the layer's structured params when no raw query is given. */
function synthesizeTraceQL(p: TracesSearchParams): string {
  const parts: string[] = [];
  if (p.service) parts.push(`resource.service.name = "${p.service}"`);
  if (p.operation) parts.push(`name = "${p.operation}"`);
  if (p.min_duration) parts.push(`duration > ${p.min_duration}`);
  if (p.max_duration) parts.push(`duration < ${p.max_duration}`);
  return parts.length ? `{ ${parts.join(' && ')} }` : '{}';
}

export const createTempoProvider: TracesProviderFactory = (helpers: SkillHelpers): TracesProvider => {
  const baseUrl =
    helpers.env('TRACES_TEMPO_URL') ||
    helpers.env('TEMPO_URL', 'http://localhost:3200');
  const fetchJSON = helpers.createFetcher('TEMPO', 'tempo');

  return {
    id: 'tempo',
    backend: 'Tempo',

    async search(p: TracesSearchParams) {
      const q = p.query || synthesizeTraceQL(p);
      const end = Math.floor(Date.now() / 1000);
      const start = end - Math.floor(parseDuration(p.lookback) / 1000);
      const qs = new URLSearchParams({ q, start: String(start), end: String(end), limit: String(p.limit) });
      const data = await fetchJSON(`${baseUrl}/api/search?${qs}`);
      const traces = (data.traces || []).map((t: any) => ({
        traceId: t.traceID,
        rootService: t.rootServiceName,
        rootOperation: t.rootTraceName,
        durationMs: t.durationMs ?? null,
        startTime: nanoToIso(t.startTimeUnixNano),
      }));
      return { count: traces.length, traces };
    },

    async getTrace(traceId: string) {
      const data = await fetchJSON(`${baseUrl}/api/traces/${encodeURIComponent(traceId)}`);
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
      if (spans.length === 0) throw new Error(`Trace ${traceId} not found or empty`);
      return {
        traceId,
        spanCount: spans.length,
        services: Array.from(new Set(spans.map((s) => s.service).filter(Boolean))),
        spans,
      };
    },

    async services() {
      const data = await fetchJSON(`${baseUrl}/api/search/tag/service.name/values`);
      return { services: data.tagValues || [] };
    },

    async operations({ service }) {
      // Tempo has no service-scoped operations endpoint; return all span names.
      // The caller can filter client-side.
      const data = await fetchJSON(`${baseUrl}/api/search/tag/name/values`);
      return { service, operations: data.tagValues || [], note: 'Tempo returns all span names; not service-scoped.' };
    },

    // dependencies: intentionally omitted — Tempo does not expose a service dependency API.
  };
};
