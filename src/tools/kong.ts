/**
 * Kong skill — inspect a Kong Gateway via its Admin API.
 *
 * Read-only (GET only).
 *
 * Tools: kong_status, kong_services, kong_routes, kong_plugins
 *
 * Enabled when `KONG_ADMIN_URL` is set (e.g. http://localhost:8001).
 * Auth: some deployments protect the Admin API — set KONG_AUTH_HEADER
 * (e.g. "Kong-Admin-Token: <token>") via KONG_AUTH_HEADER, or KONG_AUTH_TOKEN.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('KONG_ADMIN_URL', 'http://localhost:8001');
  const fetchJSON = helpers.createFetcher('KONG', 'kong');

  // ── kong_status ───────────────────────────────────────────────────────────

  server.tool(
    'kong_status',
    'Get Kong node version, database reachability, and connection stats.',
    {},
    async () => {
      try {
        const [status, root] = await Promise.all([
          fetchJSON(`${baseUrl}/status`),
          fetchJSON(`${baseUrl}/`).catch(() => ({})),
        ]);
        return textResult({
          version: root.version || null,
          database: status.database || null,
          server: status.server || null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── kong_services ─────────────────────────────────────────────────────────

  server.tool(
    'kong_services',
    'List configured services (upstream targets Kong proxies to).',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/services`);
        const services = (data.data || []).map((s: any) => ({
          name: s.name,
          host: s.host,
          port: s.port,
          protocol: s.protocol,
          path: s.path,
          enabled: s.enabled,
        }));
        return textResult({ count: services.length, hasMore: !!data.offset, services });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── kong_routes ───────────────────────────────────────────────────────────

  server.tool(
    'kong_routes',
    'List configured routes and the services they map to.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/routes`);
        const routes = (data.data || []).map((r: any) => ({
          name: r.name,
          protocols: r.protocols,
          methods: r.methods,
          hosts: r.hosts,
          paths: r.paths,
          serviceId: r.service?.id || null,
        }));
        return textResult({ count: routes.length, hasMore: !!data.offset, routes });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── kong_plugins ──────────────────────────────────────────────────────────

  server.tool(
    'kong_plugins',
    'List enabled plugins and their scope (global, or bound to a service/route/consumer).',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/plugins`);
        const plugins = (data.data || []).map((p: any) => ({
          name: p.name,
          enabled: p.enabled,
          scope: p.service ? 'service' : p.route ? 'route' : p.consumer ? 'consumer' : 'global',
        }));
        return textResult({ count: plugins.length, hasMore: !!data.offset, plugins });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'kong',
  name: 'Kong Gateway',
  description: 'Inspect Kong via its Admin API — status, services, routes, and plugins',
  tools: 4,
  backends: ['Kong'],
  isAvailable: () => !!process.env['KONG_ADMIN_URL'],
  register: registerTools,
};
