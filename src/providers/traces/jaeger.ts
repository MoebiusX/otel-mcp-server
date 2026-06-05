/**
 * Jaeger trace provider.
 *
 * Reads `TRACES_JAEGER_URL` (preferred) or legacy `JAEGER_URL`, defaulting to
 * `http://localhost:16686`. Auth via the `JAEGER_AUTH_*` env prefix.
 */

import type { SkillHelpers } from '../../skill.js';
import { parseDuration } from '../../helpers.js';
import type { TracesProvider, TracesProviderFactory, TracesSearchParams } from './types.js';

export const createJaegerProvider: TracesProviderFactory = (helpers: SkillHelpers): TracesProvider => {
  const baseUrl =
    helpers.env('TRACES_JAEGER_URL') ||
    helpers.env('JAEGER_URL', 'http://localhost:16686');
  const fetchJSON = helpers.createFetcher('JAEGER', 'jaeger');

  return {
    id: 'jaeger',
    backend: 'Jaeger',

    async search(p: TracesSearchParams) {
      if (!p.service) throw new Error('jaeger.search requires `service`');
      const qs = new URLSearchParams({
        service: p.service,
        lookback: p.lookback,
        limit: String(p.limit),
      });
      if (p.operation) qs.set('operation', p.operation);
      if (p.tags) qs.set('tags', p.tags);
      if (p.min_duration) qs.set('minDuration', p.min_duration);
      if (p.max_duration) qs.set('maxDuration', p.max_duration);

      const data = await fetchJSON(`${baseUrl}/api/traces?${qs}`);
      const traces = (data.data || []).map((t: any) => {
        const spans = t.spans || [];
        const root = spans[0];
        const services = Array.from(new Set(
          spans.map((s: any) => s.processID).map((pid: string) => t.processes?.[pid]?.serviceName || pid),
        ));
        return {
          traceId: t.traceID,
          rootOperation: root?.operationName,
          spanCount: spans.length,
          duration_ms: (root?.duration || 0) / 1000,
          services,
          startTime: root ? new Date(root.startTime / 1000).toISOString() : null,
          hasErrors: spans.some((s: any) =>
            s.tags?.some((tag: any) => tag.key === 'error' && tag.value === true),
          ),
        };
      });
      return { count: traces.length, traces };
    },

    async getTrace(traceId: string) {
      const data = await fetchJSON(`${baseUrl}/api/traces/${encodeURIComponent(traceId)}`);
      const trace = data.data?.[0];
      if (!trace) throw new Error(`Trace ${traceId} not found`);

      const spans = (trace.spans || []).map((s: any) => ({
        spanId: s.spanID,
        parentSpanId: s.references?.[0]?.spanID || null,
        operationName: s.operationName,
        service: trace.processes?.[s.processID]?.serviceName,
        duration_ms: s.duration / 1000,
        startTime: new Date(s.startTime / 1000).toISOString(),
        tags: Object.fromEntries((s.tags || []).map((t: any) => [t.key, t.value])),
        logs: (s.logs || []).map((l: any) => ({
          timestamp: new Date(l.timestamp / 1000).toISOString(),
          fields: Object.fromEntries((l.fields || []).map((f: any) => [f.key, f.value])),
        })),
      }));

      return {
        traceId: trace.traceID,
        spanCount: spans.length,
        totalDuration_ms: spans[0]?.duration_ms,
        services: Array.from(new Set(spans.map((s: any) => s.service))),
        spans,
      };
    },

    async services() {
      const data = await fetchJSON(`${baseUrl}/api/services`);
      return { services: data.data || [] };
    },

    async operations({ service }) {
      const data = await fetchJSON(`${baseUrl}/api/operations?service=${encodeURIComponent(service)}`);
      return { service, operations: data.data || [] };
    },

    async dependencies({ lookback }) {
      const lookbackMs = parseDuration(lookback);
      const endTs = Date.now();
      const data = await fetchJSON(`${baseUrl}/api/dependencies?endTs=${endTs}&lookback=${lookbackMs}`);
      return { dependencies: data.data || [] };
    },
  };
};
