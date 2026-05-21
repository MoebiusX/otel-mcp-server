/**
 * Traefik skill — inspect Traefik routing via its API.
 *
 * Read-only (GET only).
 *
 * Tools: traefik_overview, traefik_routers, traefik_services, traefik_entrypoints
 *
 * Enabled when `TRAEFIK_URL` is set (e.g. http://localhost:8080).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('TRAEFIK_URL', 'http://localhost:8080');
  const fetchJSON = helpers.createFetcher('TRAEFIK', 'traefik');

  // ── traefik_overview ──────────────────────────────────────────────────────

  server.tool(
    'traefik_overview',
    'Get Traefik version and an overview of router/service/middleware counts and enabled features.',
    {},
    async () => {
      try {
        const [version, overview] = await Promise.all([
          fetchJSON(`${baseUrl}/api/version`).catch(() => ({})),
          fetchJSON(`${baseUrl}/api/overview`),
        ]);
        return textResult({
          version: version.Version || null,
          http: overview.http || null,
          tcp: overview.tcp || null,
          features: overview.features || null,
          providers: overview.providers || null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── traefik_routers ───────────────────────────────────────────────────────

  server.tool(
    'traefik_routers',
    'List HTTP routers — their match rules, target service, status, and entry points.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/http/routers`);
        const routers = (Array.isArray(data) ? data : []).map((r: any) => ({
          name: r.name,
          rule: r.rule,
          service: r.service,
          status: r.status,
          entryPoints: r.entryPoints,
          provider: r.provider,
        }));
        return textResult({ count: routers.length, routers });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── traefik_services ──────────────────────────────────────────────────────

  server.tool(
    'traefik_services',
    'List HTTP services — type, status, and the health of their load-balancer servers.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/http/services`);
        const services = (Array.isArray(data) ? data : []).map((s: any) => ({
          name: s.name,
          status: s.status,
          type: s.type,
          provider: s.provider,
          serverCount: s.loadBalancer?.servers?.length ?? null,
          serverStatus: s.serverStatus || null,
        }));
        return textResult({ count: services.length, services });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── traefik_entrypoints ───────────────────────────────────────────────────

  server.tool(
    'traefik_entrypoints',
    'List configured entry points and their bind addresses.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/entrypoints`);
        const entrypoints = (Array.isArray(data) ? data : []).map((e: any) => ({
          name: e.name,
          address: e.address,
        }));
        return textResult({ count: entrypoints.length, entrypoints });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'traefik',
  name: 'Traefik',
  description: 'Inspect Traefik routing via its API — overview, routers, services, and entry points',
  tools: 4,
  backends: ['Traefik'],
  isAvailable: () => !!process.env['TRAEFIK_URL'],
  register: registerTools,
};
