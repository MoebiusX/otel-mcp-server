/**
 * Pyroscope skill — query continuous-profiling data via the HTTP render API.
 *
 * Works against OSS Pyroscope and Grafana Pyroscope (the `/render`,
 * `/label-names`, `/label-values` endpoints are common to both). Read-only.
 *
 * Tools: pyroscope_profile_types, pyroscope_labels, pyroscope_label_values,
 *        pyroscope_render
 *
 * Enabled when `PYROSCOPE_URL` is set (e.g. http://pyroscope:4040).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('PYROSCOPE_URL', 'http://localhost:4040');
  const fetchJSON = helpers.createFetcher('PYROSCOPE', 'pyroscope');

  // ── pyroscope_profile_types ───────────────────────────────────────────────

  server.tool(
    'pyroscope_profile_types',
    'List the available profile/application names (the values of the __name__ label).',
    {
      from: z.string().default('now-1h').describe('Range start (e.g. "now-1h", or Unix seconds)'),
      until: z.string().default('now').describe('Range end (e.g. "now")'),
    },
    async ({ from, until }) => {
      try {
        const qs = new URLSearchParams({ label: '__name__', from, until });
        const data = await fetchJSON(`${baseUrl}/label-values?${qs}`);
        const names = Array.isArray(data) ? data : (data.names || data || []);
        return textResult({ count: names.length, profileTypes: names });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pyroscope_labels ──────────────────────────────────────────────────────

  server.tool(
    'pyroscope_labels',
    'List label names available for a given profile type.',
    {
      query: z.string().optional().describe('Profile type/app to scope labels to (e.g. "process_cpu")'),
      from: z.string().default('now-1h').describe('Range start'),
      until: z.string().default('now').describe('Range end'),
    },
    async ({ query, from, until }) => {
      try {
        const qs = new URLSearchParams({ from, until });
        if (query) qs.set('query', query);
        const data = await fetchJSON(`${baseUrl}/label-names?${qs}`);
        const labels = Array.isArray(data) ? data : (data.names || []);
        return textResult({ count: labels.length, labels });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pyroscope_label_values ────────────────────────────────────────────────

  server.tool(
    'pyroscope_label_values',
    'List the values for a given label.',
    {
      label: z.string().describe('Label name (e.g. "service_name")'),
      query: z.string().optional().describe('Profile type/app to scope to'),
      from: z.string().default('now-1h').describe('Range start'),
      until: z.string().default('now').describe('Range end'),
    },
    async ({ label, query, from, until }) => {
      try {
        const qs = new URLSearchParams({ label, from, until });
        if (query) qs.set('query', query);
        const data = await fetchJSON(`${baseUrl}/label-values?${qs}`);
        const values = Array.isArray(data) ? data : (data.names || []);
        return textResult({ label, count: values.length, values });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pyroscope_render ──────────────────────────────────────────────────────

  server.tool(
    'pyroscope_render',
    'Render a profile and return the heaviest functions by self time. Decodes the flamegraph and aggregates self-samples per function.',
    {
      query: z.string().describe('Profile query (e.g. "process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name=\\"api\\"}" or "myapp.cpu{}")'),
      from: z.string().default('now-1h').describe('Range start (e.g. "now-1h", or Unix seconds)'),
      until: z.string().default('now').describe('Range end'),
      max_functions: z.number().default(20).describe('How many top functions to return'),
    },
    async ({ query, from, until, max_functions }) => {
      try {
        const qs = new URLSearchParams({ query, from, until, format: 'json' });
        const data = await fetchJSON(`${baseUrl}/render?${qs}`);

        const fb = data.flamebearer || {};
        const names: string[] = fb.names || [];
        const levels: number[][] = fb.levels || [];
        const numTicks: number = fb.numTicks ?? data.metadata?.numTicks ?? 0;
        const units: string = data.metadata?.units || 'samples';

        // Single-format flamebearer: each level is groups of 4 ints
        // [x_offset, total, self, nameIndex]. Aggregate self per function.
        const selfByName = new Map<string, number>();
        for (const level of levels) {
          for (let i = 0; i + 3 < level.length; i += 4) {
            const self = level[i + 2] || 0;
            const name = names[level[i + 3]!] ?? String(level[i + 3]);
            selfByName.set(name, (selfByName.get(name) || 0) + self);
          }
        }
        const topFunctions = [...selfByName.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, max_functions)
          .map(([name, self]) => ({
            name,
            self,
            selfPct: numTicks ? +(100 * self / numTicks).toFixed(2) : null,
          }));

        return textResult({ units, totalSamples: numTicks, functionCount: names.length, topFunctions });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'pyroscope',
  name: 'Pyroscope Profiling',
  description: 'Query continuous-profiling data and find the heaviest functions via the Pyroscope HTTP API',
  tools: 4,
  backends: ['Pyroscope'],
  isAvailable: () => !!process.env['PYROSCOPE_URL'],
  register: registerTools,
};
