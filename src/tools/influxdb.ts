/**
 * InfluxDB skill — query metrics via the InfluxQL HTTP endpoint.
 *
 * Uses the `/query` InfluxQL API, which returns JSON and is served by both
 * InfluxDB 1.x and InfluxDB 2.x (via its 1.x-compatibility API). Read-only.
 *
 * Tools: influx_health, influx_databases, influx_query
 *
 * Enabled when `INFLUX_URL` is set (e.g. http://localhost:8086).
 * Auth:
 *   - 1.x: INFLUX_AUTH_BASIC=user:password
 *   - 2.x: INFLUX_AUTH_HEADER=Token <api-token>   (and a DBRP mapping for the bucket)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

/** Flatten an InfluxQL JSON result into curated series. */
function curateResults(data: any): any {
  const out: any[] = [];
  for (const r of data.results || []) {
    if (r.error) { out.push({ error: r.error }); continue; }
    for (const s of r.series || []) {
      out.push({
        name: s.name,
        tags: s.tags || null,
        columns: s.columns || [],
        rowCount: (s.values || []).length,
        rows: s.values || [],
      });
    }
  }
  return out;
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('INFLUX_URL', 'http://localhost:8086');
  const fetchJSON = helpers.createFetcher('INFLUX', 'influxdb');

  // ── influx_health ─────────────────────────────────────────────────────────

  server.tool(
    'influx_health',
    'Check InfluxDB health and report its version and status.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/health`);
        return textResult({
          name: data.name,
          status: data.status,
          message: data.message,
          version: data.version,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── influx_databases ──────────────────────────────────────────────────────

  server.tool(
    'influx_databases',
    'List databases (1.x) / DBRP-mapped buckets (2.x).',
    {},
    async () => {
      try {
        const qs = new URLSearchParams({ q: 'SHOW DATABASES' });
        const data = await fetchJSON(`${baseUrl}/query?${qs}`);
        const values = data.results?.[0]?.series?.[0]?.values || [];
        return textResult({ databases: values.map((v: any[]) => v[0]) });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── influx_query ──────────────────────────────────────────────────────────

  server.tool(
    'influx_query',
    'Run a read-only InfluxQL query and return the resulting series (columns + rows).',
    {
      query: z.string().describe('InfluxQL query (e.g. "SELECT mean(usage_idle) FROM cpu WHERE time > now() - 1h GROUP BY time(5m)")'),
      database: z.string().optional().describe('Database / bucket to query against'),
      epoch: z.enum(['ns', 'u', 'ms', 's', 'm', 'h']).optional().describe('Return timestamps as epoch in this precision instead of RFC3339'),
    },
    async ({ query, database, epoch }) => {
      try {
        const qs = new URLSearchParams({ q: query });
        if (database) qs.set('db', database);
        if (epoch) qs.set('epoch', epoch);
        const data = await fetchJSON(`${baseUrl}/query?${qs}`);
        return textResult({ series: curateResults(data) });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'influx',
  name: 'InfluxDB Metrics',
  description: 'Query InfluxDB metrics via the InfluxQL HTTP API (1.x and 2.x compatible)',
  tools: 3,
  backends: ['InfluxDB'],
  isAvailable: () => !!process.env['INFLUX_URL'],
  register: registerTools,
};
