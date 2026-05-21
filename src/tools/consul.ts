/**
 * Consul skill — query the Consul HTTP API for service catalog and health.
 *
 * Covers Consul Connect service-mesh deployments. Read-only (GET only).
 *
 * Tools: consul_health, consul_services, consul_service_instances,
 *        consul_checks, consul_members
 *
 * Enabled when `CONSUL_URL` is set (e.g. http://localhost:8500).
 * Auth: set CONSUL_AUTH_TOKEN for an ACL token (sent as Authorization: Bearer).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

const MEMBER_STATUS: Record<number, string> = { 1: 'alive', 2: 'leaving', 3: 'left', 4: 'failed' };

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('CONSUL_URL', 'http://localhost:8500');
  const fetchJSON = helpers.createFetcher('CONSUL', 'consul');

  // ── consul_health ─────────────────────────────────────────────────────────

  server.tool(
    'consul_health',
    'Get agent info — datacenter, node name, version, server role — and the current leader.',
    {},
    async () => {
      try {
        const [self, leader] = await Promise.all([
          fetchJSON(`${baseUrl}/v1/agent/self`),
          fetchJSON(`${baseUrl}/v1/status/leader`).catch(() => null),
        ]);
        return textResult({
          datacenter: self.Config?.Datacenter,
          nodeName: self.Config?.NodeName,
          version: self.Config?.Version,
          server: self.Config?.Server,
          leader: typeof leader === 'string' ? leader : null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── consul_services ───────────────────────────────────────────────────────

  server.tool(
    'consul_services',
    'List all registered services with their tags.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/v1/catalog/services`);
        const services = Object.entries(data || {}).map(([name, tags]) => ({ name, tags }));
        return textResult({ count: services.length, services });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── consul_service_instances ──────────────────────────────────────────────

  server.tool(
    'consul_service_instances',
    'List instances of a service with address, port, and aggregated health.',
    {
      service: z.string().describe('Service name'),
      passing_only: z.boolean().default(false).describe('Return only passing instances'),
    },
    async ({ service, passing_only }) => {
      try {
        const qs = passing_only ? '?passing' : '';
        const data = await fetchJSON(`${baseUrl}/v1/health/service/${encodeURIComponent(service)}${qs}`);
        const instances = (Array.isArray(data) ? data : []).map((e: any) => {
          const checks = e.Checks || [];
          const allPassing = checks.length > 0 && checks.every((c: any) => c.Status === 'passing');
          return {
            node: e.Node?.Node,
            address: e.Service?.Address || e.Node?.Address,
            port: e.Service?.Port,
            tags: e.Service?.Tags || [],
            health: allPassing ? 'passing' : (checks.find((c: any) => c.Status !== 'passing')?.Status || 'unknown'),
          };
        });
        return textResult({ service, count: instances.length, instances });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── consul_checks ─────────────────────────────────────────────────────────

  server.tool(
    'consul_checks',
    'List health checks in a given state — defaults to critical (failing) checks.',
    {
      state: z.enum(['any', 'passing', 'warning', 'critical']).default('critical')
        .describe('Health check state to list'),
    },
    async ({ state }) => {
      try {
        const data = await fetchJSON(`${baseUrl}/v1/health/state/${state}`);
        const checks = (Array.isArray(data) ? data : []).map((c: any) => ({
          checkId: c.CheckID,
          name: c.Name,
          status: c.Status,
          service: c.ServiceName || null,
          node: c.Node,
          output: (c.Output || '').slice(0, 300),
        }));
        return textResult({ state, count: checks.length, checks });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── consul_members ────────────────────────────────────────────────────────

  server.tool(
    'consul_members',
    'List Consul cluster members (agents) and their gossip status.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/v1/agent/members`);
        const members = (Array.isArray(data) ? data : []).map((m: any) => ({
          name: m.Name,
          addr: m.Addr,
          status: MEMBER_STATUS[m.Status] || m.Status,
          role: m.Tags?.role || null,
        }));
        return textResult({ count: members.length, members });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'consul',
  name: 'Consul',
  description: 'Query the Consul service catalog, health checks, and cluster membership',
  tools: 5,
  backends: ['Consul'],
  isAvailable: () => !!process.env['CONSUL_URL'],
  register: registerTools,
};
