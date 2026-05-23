/**
 * Envoy skill — inspect an Envoy proxy via its admin API.
 *
 * Covers the standalone Envoy admin interface and the sidecar proxies that
 * Istio/other meshes run. Read-only (GET only).
 *
 * Tools: envoy_server_info, envoy_clusters, envoy_listeners, envoy_stats
 *
 * Enabled when `ENVOY_ADMIN_URL` is set (e.g. http://localhost:9901).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function sockAddr(a: any): string | null {
  const s = a?.socket_address;
  return s ? `${s.address}:${s.port_value}` : null;
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('ENVOY_ADMIN_URL', 'http://localhost:9901');
  const fetchJSON = helpers.createFetcher('ENVOY', 'envoy');

  // ── envoy_server_info ─────────────────────────────────────────────────────

  server.tool(
    'envoy_server_info',
    'Get Envoy version, serving state (LIVE/DRAINING/...), and uptime.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/server_info`);
        return textResult({
          version: data.version,
          state: data.state,
          uptimeCurrentEpoch: data.uptime_current_epoch,
          uptimeAllEpochs: data.uptime_all_epochs,
          hotRestartVersion: data.hot_restart_version,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── envoy_clusters ────────────────────────────────────────────────────────

  server.tool(
    'envoy_clusters',
    'List upstream clusters and the health of their endpoints.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/clusters?format=json`);
        const clusters = (data.cluster_statuses || []).map((c: any) => ({
          name: c.name,
          hosts: (c.host_statuses || []).map((h: any) => ({
            address: sockAddr(h.address),
            healthy: h.health_status?.eds_health_status === 'HEALTHY'
              && !h.health_status?.failed_active_health_check
              && !h.health_status?.failed_outlier_check,
            edsHealth: h.health_status?.eds_health_status,
            weight: h.weight,
          })),
        }));
        return textResult({ count: clusters.length, clusters });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── envoy_listeners ───────────────────────────────────────────────────────

  server.tool(
    'envoy_listeners',
    'List configured listeners and their bind addresses.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/listeners?format=json`);
        const listeners = (data.listener_statuses || []).map((l: any) => ({
          name: l.name,
          address: sockAddr(l.local_address),
        }));
        return textResult({ count: listeners.length, listeners });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── envoy_stats ───────────────────────────────────────────────────────────

  server.tool(
    'envoy_stats',
    'Read Envoy counters/gauges, optionally filtered by a name regex (e.g. "http.*5xx").',
    {
      filter: z.string().optional().describe('Regex to filter stat names'),
      limit: z.number().default(200).describe('Max stats to return'),
    },
    async ({ filter, limit }) => {
      try {
        const qs = new URLSearchParams({ format: 'json' });
        if (filter) qs.set('filter', filter);
        const data = await fetchJSON(`${baseUrl}/stats?${qs}`);
        const stats = (data.stats || [])
          .filter((s: any) => s.value !== undefined)
          .slice(0, limit)
          .map((s: any) => ({ name: s.name, value: s.value }));
        return textResult({ count: stats.length, stats });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'envoy',
  name: 'Envoy Proxy',
  description: 'Inspect Envoy via its admin API — server info, clusters, listeners, and stats',
  tools: 4,
  backends: ['Envoy'],
  isAvailable: () => !!process.env['ENVOY_ADMIN_URL'],
  register: registerTools,
};
