/**
 * Public Exchange skill — read-only, unauthenticated tools that mirror
 * KrystalineX's `/api/public/*` transparency endpoints. Designed for the
 * **public** otel-mcp-server deployment so any AI agent can answer
 * questions about exchange health, trading volume, and trade traces
 * without credentials.
 *
 * Tools:
 *   - exchange_status        Overall system status + uptime
 *   - total_volume           Aggregate 24h trading volume
 *   - recent_trades          Anonymized recent trades feed (limit ≤ 100)
 *   - transparency_metrics   Full transparency metrics bundle
 *   - verify_trace           Public-safe trace details for a trade ID
 *
 * Backend: KrystalineX core (APP_API_URL).
 *
 * Deployment note:
 *   The public deployment runs with no MCP_AUTH_KEYS, so any client can
 *   call these tools. That's intentional — every endpoint here serves
 *   data that's already public on the transparency website.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const appApiUrl = helpers.env('APP_API_URL', 'http://localhost:5000');
  const fetchJSON = helpers.createFetcher('APP_API', 'app-api');

  // ── exchange_status ──────────────────────────────────────────────────────
  server.tool(
    'exchange_status',
    'Get the KrystalineX exchange overall status: operational state, uptime, current observability posture, and last incident summary.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${appApiUrl}/api/public/status`);
        return textResult(data);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── total_volume ─────────────────────────────────────────────────────────
  server.tool(
    'total_volume',
    'Get aggregate trading volume on the KrystalineX exchange (24h, weekly, all-time). Returns volume per asset and totals.',
    {},
    async () => {
      try {
        const metrics = await fetchJSON(`${appApiUrl}/api/public/metrics`);
        // Surface a focused view; the full metrics bundle is available
        // via transparency_metrics for callers that want everything.
        const summary = {
          volume24h: (metrics as any)?.volume24h ?? null,
          volumeWeek: (metrics as any)?.volumeWeek ?? null,
          volumeAllTime: (metrics as any)?.volumeAllTime ?? null,
          tradeCount24h: (metrics as any)?.tradeCount24h ?? null,
          asOf: (metrics as any)?.timestamp ?? new Date().toISOString(),
        };
        return textResult(summary);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── recent_trades ────────────────────────────────────────────────────────
  server.tool(
    'recent_trades',
    'Get the most recent anonymized public trades on KrystalineX. Useful for "is the market active?" questions. Trades carry no user identity.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('Number of trades to return (1–100, default 20)'),
    },
    async ({ limit }) => {
      try {
        const data = await fetchJSON(
          `${appApiUrl}/api/public/trades?limit=${encodeURIComponent(String(limit))}`,
        );
        return textResult(data);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── transparency_metrics ─────────────────────────────────────────────────
  server.tool(
    'transparency_metrics',
    'Get the full transparency metrics bundle: trace coverage, anomaly counts, MTTR, ZK proof generation rate, etc. Powers the public "Proof of Observability" dashboard.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${appApiUrl}/api/public/metrics`);
        return textResult(data);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── verify_trace ─────────────────────────────────────────────────────────
  server.tool(
    'verify_trace',
    'Look up the public-safe distributed trace for a given trade ID — service hops, timing, and verification result. Useful for "show me what happened to this trade".',
    {
      trace_id: z.string().min(1).describe('Trace ID associated with a trade'),
    },
    async ({ trace_id }) => {
      try {
        const data = await fetchJSON(
          `${appApiUrl}/api/public/trace/${encodeURIComponent(trace_id)}`,
        );
        return textResult(data);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'public-exchange',
  name: 'Public Exchange',
  description:
    'Read-only tools mirroring KrystalineX /api/public/* transparency endpoints — designed for the unauthenticated public MCP deployment.',
  tools: 5,
  backends: ['App API'],
  isAvailable: () => true,
  register: registerTools,
};
