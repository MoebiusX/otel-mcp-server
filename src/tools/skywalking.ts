/**
 * SkyWalking skill — query the Apache SkyWalking OAP via its GraphQL API.
 *
 * Read-only (GraphQL queries, no mutations).
 *
 * Tools: skywalking_services, skywalking_traces_search, skywalking_trace_get
 *
 * Enabled when `SKYWALKING_URL` is set (e.g. http://localhost:12800).
 * The GraphQL endpoint is assumed at `<SKYWALKING_URL>/graphql`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult, parseDuration } from '../helpers.js';

/** Format a Date as SkyWalking's MINUTE-step duration string: "yyyy-MM-dd HHmm" (UTC). */
function fmtMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('SKYWALKING_URL', 'http://localhost:12800');
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

  // ── skywalking_services ───────────────────────────────────────────────────

  server.tool(
    'skywalking_services',
    'List services known to SkyWalking over a time window.',
    {
      lookback: z.string().default('1h').describe('Time window (e.g. "1h", "1d")'),
    },
    async ({ lookback }) => {
      try {
        const data = await graphql(
          'query ($d: Duration!) { services: getAllServices(duration: $d) { id name group } }',
          { d: durationFor(lookback) },
        );
        return textResult({ count: (data.services || []).length, services: data.services || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── skywalking_traces_search ──────────────────────────────────────────────

  server.tool(
    'skywalking_traces_search',
    'Search traces by time window, optional service, state, and minimum duration.',
    {
      lookback: z.string().default('1h').describe('Time window (e.g. "1h", "30m")'),
      service_id: z.string().optional().describe('Restrict to a service ID (from skywalking_services)'),
      endpoint_name: z.string().optional().describe('Restrict to an endpoint name'),
      state: z.enum(['ALL', 'SUCCESS', 'ERROR']).default('ALL').describe('Trace state filter'),
      min_duration_ms: z.number().optional().describe('Minimum trace duration in milliseconds'),
      limit: z.number().default(20).describe('Max traces to return'),
    },
    async (p) => {
      try {
        const condition: any = {
          queryDuration: durationFor(p.lookback),
          traceState: p.state,
          queryOrder: 'BY_START_TIME',
          paging: { pageNum: 1, pageSize: p.limit },
        };
        if (p.service_id) condition.serviceId = p.service_id;
        if (p.endpoint_name) condition.endpointName = p.endpoint_name;
        if (p.min_duration_ms !== undefined) condition.minTraceDuration = p.min_duration_ms;

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
        return textResult({ count: traces.length, traces });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── skywalking_trace_get ──────────────────────────────────────────────────

  server.tool(
    'skywalking_trace_get',
    'Get the spans of a trace by trace ID.',
    { trace_id: z.string().describe('SkyWalking trace ID') },
    async ({ trace_id }) => {
      try {
        const data = await graphql(
          `query ($id: ID!) {
             trace: queryTrace(traceId: $id) {
               spans { spanId parentSpanId serviceCode startTime endTime endpointName type peer component isError }
             }
           }`,
          { id: trace_id },
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
        if (spans.length === 0) return errorResult(`Trace ${trace_id} not found`);
        return textResult({ traceId: trace_id, spanCount: spans.length, spans });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'skywalking',
  name: 'Apache SkyWalking',
  description: 'Query SkyWalking services and traces via its GraphQL API',
  tools: 3,
  backends: ['SkyWalking'],
  isAvailable: () => !!process.env['SKYWALKING_URL'],
  register: registerTools,
};
