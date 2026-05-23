/**
 * Apache SkyWalking trace provider (OAP GraphQL).
 *
 * Reads `TRACES_SKYWALKING_URL` (preferred) or legacy `SKYWALKING_URL`. Auth via `SKYWALKING_AUTH_*`.
 *
 * Note: `operations` is intentionally omitted — SkyWalking's endpoint listing
 * needs a service id (not name) and is exposed indirectly via traces_search.
 */

import type { SkillHelpers } from '../../skill.js';
import { parseDuration } from '../../helpers.js';
import type { TracesProvider, TracesProviderFactory, TracesSearchParams } from './types.js';

function fmtMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export const createSkyWalkingProvider: TracesProviderFactory = (helpers: SkillHelpers): TracesProvider => {
  const baseUrl =
    helpers.env('TRACES_SKYWALKING_URL') ||
    helpers.env('SKYWALKING_URL', 'http://localhost:12800');
  const gqlUrl = `${baseUrl.replace(/\/$/, '')}/graphql`;
  const fetchJSON = helpers.createFetcher('SKYWALKING', 'skywalking');

  async function graphql(query: string, variables: any): Promise<any> {
    const data = await fetchJSON(gqlUrl, undefined, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    if (data.errors?.length) {
      throw new Error(data.errors.map((e: any) => e.message).join('; '));
    }
    return data.data;
  }

  function durationFor(lookback: string) {
    const end = new Date();
    const start = new Date(end.getTime() - parseDuration(lookback));
    return { start: fmtMinute(start), end: fmtMinute(end), step: 'MINUTE' };
  }

  return {
    id: 'skywalking',
    backend: 'SkyWalking',

    async search(p: TracesSearchParams) {
      const condition: any = {
        queryDuration: durationFor(p.lookback),
        traceState: p.state || 'ALL',
        queryOrder: 'BY_START_TIME',
        paging: { pageNum: 1, pageSize: p.limit },
      };
      // SkyWalking uses service IDs, not names. We accept either via `service` and pass it through;
      // the agent gets the service id from a prior `traces_services` call.
      if (p.service) condition.serviceId = p.service;
      if (p.operation) condition.endpointName = p.operation;
      if (p.min_duration) condition.minTraceDuration = parseDuration(p.min_duration);

      const data = await graphql(
        `query ($c: TraceQueryCondition!) {
           data: queryBasicTraces(condition: $c) {
             traces { segmentId endpointNames duration start isError traceIds }
           }
         }`,
        { c: condition },
      );
      const traces = (data.data?.traces || []).map((t: any) => ({
        traceIds: t.traceIds,
        endpoints: t.endpointNames,
        duration_ms: t.duration,
        start: t.start ? new Date(Number(t.start)).toISOString() : null,
        isError: t.isError,
      }));
      return { count: traces.length, traces };
    },

    async getTrace(traceId: string) {
      const data = await graphql(
        `query ($id: ID!) {
           trace: queryTrace(traceId: $id) {
             spans { spanId parentSpanId serviceCode startTime endTime endpointName type peer component isError }
           }
         }`,
        { id: traceId },
      );
      const spans = (data.trace?.spans || []).map((s: any) => ({
        spanId: s.spanId,
        parentSpanId: s.parentSpanId,
        service: s.serviceCode,
        endpoint: s.endpointName,
        type: s.type,
        component: s.component,
        peer: s.peer || null,
        isError: s.isError,
        startTime: s.startTime ? new Date(Number(s.startTime)).toISOString() : null,
        duration_ms: (s.endTime && s.startTime) ? Number(s.endTime) - Number(s.startTime) : null,
      }));
      if (spans.length === 0) throw new Error(`Trace ${traceId} not found`);
      return { traceId, spanCount: spans.length, spans };
    },

    async services({ lookback }) {
      const data = await graphql(
        'query ($d: Duration!) { services: getAllServices(duration: $d) { id name group } }',
        { d: durationFor(lookback) },
      );
      return { count: (data.services || []).length, services: data.services || [] };
    },

    async dependencies({ lookback }) {
      const data = await graphql(
        `query ($d: Duration!) {
           topology: getGlobalTopology(duration: $d) {
             nodes { id name type }
             calls { id source target detectPoints }
           }
         }`,
        { d: durationFor(lookback) },
      );
      return { dependencies: data.topology || { nodes: [], calls: [] } };
    },
  };
};
