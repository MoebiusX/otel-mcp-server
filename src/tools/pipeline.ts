/**
 * Pipeline skill — health/throughput introspection for telemetry collection agents.
 *
 * Each agent runs its own monitoring API at its own URL, so each tool is gated
 * on its agent's env var and returns a clear error if that agent isn't configured.
 * Read-only.
 *
 * Tools: pipeline_fluentbit, pipeline_beats, pipeline_vector, pipeline_alloy
 *
 * Enabled when any of VECTOR_URL / FLUENTBIT_URL / BEATS_URL / ALLOY_URL is set.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const fluentbitUrl = helpers.env('FLUENTBIT_URL');
  const beatsUrl = helpers.env('BEATS_URL');
  const vectorUrl = helpers.env('VECTOR_URL');
  const alloyUrl = helpers.env('ALLOY_URL');

  const fetchFluentbit = helpers.createFetcher('FLUENTBIT', 'fluentbit');
  const fetchBeats = helpers.createFetcher('BEATS', 'beats');
  const fetchVector = helpers.createFetcher('VECTOR', 'vector');
  const fetchAlloy = helpers.createFetcher('ALLOY', 'alloy');

  // ── pipeline_fluentbit ────────────────────────────────────────────────────

  server.tool(
    'pipeline_fluentbit',
    'Fluent Bit pipeline health — per-input/output record and byte counts, retries, and drops.',
    {},
    async () => {
      if (!fluentbitUrl) return errorResult('FLUENTBIT_URL is not configured');
      try {
        const [metrics, uptime] = await Promise.all([
          fetchFluentbit(`${fluentbitUrl}/api/v1/metrics`),
          fetchFluentbit(`${fluentbitUrl}/api/v1/uptime`).catch(() => null),
        ]);
        const inputs = Object.entries(metrics.input || {}).map(([name, m]: [string, any]) => ({
          name, records: m.records, bytes: m.bytes,
        }));
        const outputs = Object.entries(metrics.output || {}).map(([name, m]: [string, any]) => ({
          name,
          procRecords: m.proc_records,
          procBytes: m.proc_bytes,
          errors: m.errors,
          retries: m.retries,
          retriesFailed: m.retries_failed,
          droppedRecords: m.dropped_records,
        }));
        return textResult({ uptimeSec: uptime?.uptime_sec ?? null, inputs, outputs });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pipeline_beats ────────────────────────────────────────────────────────

  server.tool(
    'pipeline_beats',
    'Beats pipeline stats — output event throughput (acked/failed/dropped) and write errors.',
    {},
    async () => {
      if (!beatsUrl) return errorResult('BEATS_URL is not configured');
      try {
        const stats = await fetchBeats(`${beatsUrl}/stats`);
        const out = stats.libbeat?.output || {};
        const pipe = stats.libbeat?.pipeline || {};
        return textResult({
          outputType: out.type,
          outputEvents: out.events || null,
          writeErrors: out.write?.errors ?? null,
          readErrors: out.read?.errors ?? null,
          pipelineEvents: pipe.events || null,
          uptimeMs: stats.beat?.info?.uptime?.ms ?? null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pipeline_vector ───────────────────────────────────────────────────────

  server.tool(
    'pipeline_vector',
    'Vector health and configured components (via the GraphQL API).',
    {},
    async () => {
      if (!vectorUrl) return errorResult('VECTOR_URL is not configured');
      try {
        const health = await fetchVector(`${vectorUrl}/health`).catch(() => null);
        const gql = await fetchVector(`${vectorUrl}/graphql`, undefined, {
          method: 'POST',
          body: JSON.stringify({
            query: 'query { components { edges { node { componentId componentType } } } }',
          }),
        });
        const components = (gql.data?.components?.edges || []).map((e: any) => ({
          id: e.node?.componentId,
          type: e.node?.componentType,
        }));
        return textResult({ healthy: health?.ok ?? null, componentCount: components.length, components });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pipeline_alloy ────────────────────────────────────────────────────────

  server.tool(
    'pipeline_alloy',
    'Grafana Alloy components and their health.',
    {},
    async () => {
      if (!alloyUrl) return errorResult('ALLOY_URL is not configured');
      try {
        const data = await fetchAlloy(`${alloyUrl}/api/v0/web/components`);
        const components = (Array.isArray(data) ? data : []).map((c: any) => ({
          name: c.localID || c.name,
          health: c.health?.state || null,
          message: c.health?.message || null,
        }));
        const unhealthy = components.filter((c: any) => c.health && c.health !== 'healthy').length;
        return textResult({ componentCount: components.length, unhealthy, components });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'pipeline',
  name: 'Collection Pipelines',
  description: 'Health and throughput introspection for Fluent Bit, Beats, Vector, and Grafana Alloy',
  tools: 4,
  backends: ['Fluent Bit', 'Beats', 'Vector', 'Alloy'],
  isAvailable: () =>
    !!(process.env['FLUENTBIT_URL'] || process.env['BEATS_URL'] ||
       process.env['VECTOR_URL'] || process.env['ALLOY_URL']),
  register: registerTools,
};
