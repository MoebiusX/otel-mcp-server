/**
 * Cilium skill — query the Cilium agent REST API for eBPF networking state.
 *
 * Targets the cilium-agent HTTP API (OpenAPI `/v1/...`). For L3/L7 flow
 * observability (Hubble) a gRPC transport is required — see the eBPF layer
 * plan; this skill covers the agent's HTTP-accessible control-plane surface:
 * health, endpoints, identities, policy, services, and cluster nodes.
 *
 * Tools: cilium_health, cilium_endpoints, cilium_identities, cilium_policy,
 *        cilium_services, cilium_nodes
 *
 * Enabled when `CILIUM_URL` is set (e.g. http://cilium-agent:9234).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const ciliumUrl = helpers.env('CILIUM_URL', 'http://localhost:9234');
  const fetchJSON = helpers.createFetcher('CILIUM', 'cilium');

  // ── cilium_health ───────────────────────────────────────────────────────

  server.tool(
    'cilium_health',
    'Get cilium-agent health — datapath/controller status, kube-apiserver and kvstore connectivity, and reported version.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${ciliumUrl}/v1/healthz`);
        return textResult({
          cilium: data.cilium ?? null,
          kubernetes: data.kubernetes ?? null,
          kvstore: data.kvstore ?? null,
          containerRuntime: data['container-runtime'] ?? null,
          stale: data.stale ?? null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── cilium_endpoints ────────────────────────────────────────────────────

  server.tool(
    'cilium_endpoints',
    'List Cilium-managed endpoints (pods) with security identity, datapath state, and addressing. Optionally filter by namespace.',
    {
      namespace: z.string().optional().describe('Filter to a Kubernetes namespace'),
      state: z.string().optional().describe('Filter by endpoint state (e.g. "ready", "waiting-for-identity")'),
    },
    async ({ namespace, state }) => {
      try {
        const data = await fetchJSON(`${ciliumUrl}/v1/endpoint`);
        const endpoints = (Array.isArray(data) ? data : []).map((ep: any) => {
          const ext = ep.status?.['external-identifiers'] || {};
          const addressing = ep.status?.networking?.addressing?.[0] || {};
          return {
            id: ep.id,
            podName: ext['pod-name'] || ext['k8s-pod-name'] || null,
            namespace: ext['k8s-namespace'] || null,
            containerName: ext['container-name'] || null,
            state: ep.status?.state || null,
            identity: ep.status?.identity?.id ?? null,
            labels: ep.status?.identity?.labels || [],
            ipv4: addressing.ipv4 || null,
            ipv6: addressing.ipv6 || null,
          };
        });
        const filtered = endpoints.filter((ep: any) =>
          (!namespace || ep.namespace === namespace) &&
          (!state || ep.state === state),
        );
        return textResult({ count: filtered.length, endpoints: filtered });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── cilium_identities ───────────────────────────────────────────────────

  server.tool(
    'cilium_identities',
    'List Cilium security identities — the numeric identity each unique label set maps to, used for policy enforcement.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${ciliumUrl}/v1/identity`);
        const identities = (Array.isArray(data) ? data : []).map((id: any) => ({
          id: id.id,
          labels: id.labels || [],
        }));
        return textResult({ count: identities.length, identities });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── cilium_policy ───────────────────────────────────────────────────────

  server.tool(
    'cilium_policy',
    'Get the network policy currently enforced by the agent, with its revision number.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${ciliumUrl}/v1/policy`);
        let ruleCount: number | null = null;
        try {
          const parsed = typeof data.policy === 'string' ? JSON.parse(data.policy) : data.policy;
          if (Array.isArray(parsed)) ruleCount = parsed.length;
        } catch { /* policy may be opaque text — leave count null */ }
        return textResult({
          revision: data.revision ?? null,
          ruleCount,
          policy: data.policy ?? null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── cilium_services ─────────────────────────────────────────────────────

  server.tool(
    'cilium_services',
    'List eBPF load-balancing services and their backends as programmed in the datapath.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${ciliumUrl}/v1/service`);
        const services = (Array.isArray(data) ? data : []).map((svc: any) => {
          const spec = svc.spec || {};
          const fe = spec['frontend-address'] || {};
          return {
            id: spec.id ?? svc.id ?? null,
            frontend: fe.ip ? `${fe.ip}:${fe.port}` : null,
            protocol: fe.protocol || null,
            type: spec.flags?.type || null,
            backends: (spec['backend-addresses'] || []).map((b: any) =>
              b.ip ? `${b.ip}:${b.port}` : null,
            ).filter(Boolean),
          };
        });
        return textResult({ count: services.length, services });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── cilium_nodes ────────────────────────────────────────────────────────

  server.tool(
    'cilium_nodes',
    'List nodes known to the agent (including cluster-mesh peers) with their addresses and source.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${ciliumUrl}/v1/cluster/nodes`);
        const nodes = (data.nodes || []).map((n: any) => ({
          name: n.name,
          cluster: n.cluster || null,
          source: n.source || null,
          primaryAddress: n['primary-address']?.ipv4?.ip
            || n['primary-address']?.ipv6?.ip
            || null,
        }));
        return textResult({
          count: nodes.length,
          clusters: data.clusters || [],
          nodes,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'cilium',
  name: 'Cilium (eBPF networking)',
  description: 'Query Cilium agent state — endpoints, identities, policy, services, and node health via the agent REST API',
  tools: 6,
  backends: ['Cilium'],
  isAvailable: () => !!process.env['CILIUM_URL'],
  register: registerTools,
};
