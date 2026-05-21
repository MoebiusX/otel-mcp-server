/**
 * OpenTSDB skill — query metrics via the OpenTSDB HTTP API.
 *
 * Read-only (GET only).
 *
 * Tools: opentsdb_version, opentsdb_suggest, opentsdb_query
 *
 * Enabled when `OPENTSDB_URL` is set (e.g. http://localhost:4242).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('OPENTSDB_URL', 'http://localhost:4242');
  const fetchJSON = helpers.createFetcher('OPENTSDB', 'opentsdb');

  // ── opentsdb_version ──────────────────────────────────────────────────────

  server.tool(
    'opentsdb_version',
    'Get the OpenTSDB version and build info.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/version`);
        return textResult({ version: data.version, host: data.host, repo: data.repo });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── opentsdb_suggest ──────────────────────────────────────────────────────

  server.tool(
    'opentsdb_suggest',
    'Autocomplete metric names, tag keys, or tag values.',
    {
      type: z.enum(['metrics', 'tagk', 'tagv']).default('metrics').describe('What to suggest'),
      q: z.string().optional().describe('Prefix to match'),
      max: z.number().default(25).describe('Max suggestions'),
    },
    async ({ type, q, max }) => {
      try {
        const qs = new URLSearchParams({ type, max: String(max) });
        if (q) qs.set('q', q);
        const data = await fetchJSON(`${baseUrl}/api/suggest?${qs}`);
        return textResult({ type, suggestions: data || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── opentsdb_query ────────────────────────────────────────────────────────

  server.tool(
    'opentsdb_query',
    'Query a metric over a time range, with an aggregator and optional downsampling and tag filters.',
    {
      metric: z.string().describe('Metric name (e.g. "sys.cpu.user")'),
      start: z.string().default('1h-ago').describe('Start time (e.g. "1h-ago", "2d-ago", or epoch)'),
      end: z.string().optional().describe('End time (defaults to now)'),
      aggregator: z.string().default('sum').describe('Aggregator (e.g. "sum", "avg", "max")'),
      downsample: z.string().optional().describe('Downsample spec (e.g. "5m-avg")'),
      tags: z.string().optional().describe('Tag filter as k=v pairs, comma-separated (e.g. "host=web1,dc=us")'),
      max_points: z.number().default(500).describe('Max data points to return per series'),
    },
    async ({ metric, start, end, aggregator, downsample, tags, max_points }) => {
      try {
        let m = aggregator;
        if (downsample) m += `:${downsample}`;
        m += `:${metric}`;
        if (tags) m += `{${tags}}`;

        const qs = new URLSearchParams({ start, m });
        if (end) qs.set('end', end);
        const data = await fetchJSON(`${baseUrl}/api/query?${qs}`);

        const series = (Array.isArray(data) ? data : []).map((s: any) => {
          const points = Object.entries(s.dps || {})
            .map(([ts, val]) => [Number(ts), val])
            .sort((a: any, b: any) => a[0] - b[0]);
          return {
            metric: s.metric,
            tags: s.tags || {},
            dpCount: points.length,
            dps: points.slice(-max_points),
          };
        });
        return textResult({ count: series.length, series });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'opentsdb',
  name: 'OpenTSDB Metrics',
  description: 'Query OpenTSDB metrics — version, name suggestions, and time-range queries',
  tools: 3,
  backends: ['OpenTSDB'],
  isAvailable: () => !!process.env['OPENTSDB_URL'],
  register: registerTools,
};
