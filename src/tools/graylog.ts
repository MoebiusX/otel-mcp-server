/**
 * Graylog skill — query logs and system state via the Graylog REST API.
 *
 * Read-only (GET only). Graylog requires `Accept: application/json`, which this
 * skill attaches via the fetcher's extra headers.
 *
 * Tools: graylog_system, graylog_streams, graylog_search
 *
 * Enabled when `GRAYLOG_URL` is set (e.g. http://localhost:9000).
 * Auth (Basic):
 *   - user/pass:   GRAYLOG_AUTH_BASIC=admin:password
 *   - API token:   GRAYLOG_AUTH_BASIC=<token>:token
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult, parseDuration } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('GRAYLOG_URL', 'http://localhost:9000');
  const fetchJSON = helpers.createFetcher('GRAYLOG', 'graylog', {
    extraHeaders: { Accept: 'application/json', 'X-Requested-By': 'otel-mcp-server' },
  });

  // ── graylog_system ────────────────────────────────────────────────────────

  server.tool(
    'graylog_system',
    'Get Graylog node system info — version, lifecycle state, hostname, and start time.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/system`);
        return textResult({
          version: data.version,
          lifecycle: data.lifecycle,
          isProcessing: data.is_processing,
          hostname: data.hostname,
          startedAt: data.started_at,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── graylog_streams ───────────────────────────────────────────────────────

  server.tool(
    'graylog_streams',
    'List streams — the routing rules that partition incoming messages.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/streams`);
        const streams = (data.streams || []).map((s: any) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          disabled: s.disabled,
        }));
        return textResult({ total: data.total ?? streams.length, streams });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── graylog_search ────────────────────────────────────────────────────────

  server.tool(
    'graylog_search',
    'Search messages over a relative time window using Graylog query syntax.',
    {
      query: z.string().describe('Graylog/Lucene query (e.g. "level:3 AND source:api", or "*" for all)'),
      range: z.string().default('1h').describe('Relative time window (e.g. "15m", "1h", "1d")'),
      limit: z.number().default(100).describe('Max messages to return'),
      fields: z.string().optional().describe('Comma-separated fields to return (e.g. "timestamp,source,message,level")'),
    },
    async ({ query, range, limit, fields }) => {
      try {
        const rangeSec = Math.round(parseDuration(range) / 1000);
        const qs = new URLSearchParams({
          query,
          range: String(rangeSec),
          limit: String(limit),
          sort: 'timestamp:desc',
        });
        if (fields) qs.set('fields', fields);
        const data = await fetchJSON(`${baseUrl}/api/search/universal/relative?${qs}`);
        const messages = (data.messages || []).map((m: any) => m.message || m);
        return textResult({
          totalResults: data.total_results ?? messages.length,
          returned: messages.length,
          messages,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'graylog',
  name: 'Graylog Logs',
  description: 'Search logs and inspect system/stream state via the Graylog REST API',
  tools: 3,
  backends: ['Graylog'],
  isAvailable: () => !!process.env['GRAYLOG_URL'],
  register: registerTools,
};
