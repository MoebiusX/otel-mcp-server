/**
 * Zipkin trace provider (v2 API).
 *
 * Reads `TRACES_ZIPKIN_URL` (preferred) or legacy `ZIPKIN_URL`. Auth via `ZIPKIN_AUTH_*`.
 */

import type { SkillHelpers } from '../../skill.js';
import { parseDuration } from '../../helpers.js';
import type { TracesProvider, TracesProviderFactory, TracesSearchParams } from './types.js';

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

export const createZipkinProvider: TracesProviderFactory = (helpers: SkillHelpers): TracesProvider => {
  const baseUrl =
    helpers.env('TRACES_ZIPKIN_URL') ||
    helpers.env('ZIPKIN_URL', 'http://localhost:9411');
  const fetchJSON = helpers.createFetcher('ZIPKIN', 'zipkin');

  return {
    id: 'zipkin',
    backend: 'Zipkin',

    async search(p: TracesSearchParams) {
      if (!p.service) throw new Error('zipkin.search requires `service`');
      const qs = new URLSearchParams({
        serviceName: p.service,
        endTs: String(Date.now()),
        lookback: String(parseDuration(p.lookback)),
        limit: String(p.limit),
      });
      if (p.operation) qs.set('spanName', p.operation);
      if (p.annotation_query) qs.set('annotationQuery', p.annotation_query);
      if (p.min_duration) qs.set('minDuration', String(Math.round(parseDuration(p.min_duration) * 1000))); // ms → µs

      const data = await fetchJSON(`${baseUrl}/api/v2/traces?${qs}`);
      const traces = (Array.isArray(data) ? data : []).map((spans: any[]) => summarizeTrace(spans));
      return { count: traces.length, traces };
    },

    async getTrace(traceId: string) {
      const spans = await fetchJSON(`${baseUrl}/api/v2/trace/${encodeURIComponent(traceId)}`);
      if (!Array.isArray(spans) || spans.length === 0) {
        throw new Error(`Trace ${traceId} not found`);
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
      return { ...summarizeTrace(spans), spans: mapped };
    },

    async services() {
      const data = await fetchJSON(`${baseUrl}/api/v2/services`);
      return { services: data || [] };
    },

    async operations({ service }) {
      const qs = new URLSearchParams({ serviceName: service });
      const data = await fetchJSON(`${baseUrl}/api/v2/spans?${qs}`);
      return { service, operations: data || [] };
    },

    async dependencies({ lookback }) {
      const qs = new URLSearchParams({
        endTs: String(Date.now()),
        lookback: String(parseDuration(lookback)),
      });
      const data = await fetchJSON(`${baseUrl}/api/v2/dependencies?${qs}`);
      return { dependencies: data || [] };
    },
  };
};
