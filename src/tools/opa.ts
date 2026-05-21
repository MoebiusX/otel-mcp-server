/**
 * OPA skill — query Open Policy Agent decisions and policy via its REST API.
 *
 * Read-only: uses GET against the Data and Query APIs (policy evaluation has no
 * side effects). Good for surfacing policy violations / decision documents.
 *
 * Tools: opa_health, opa_policies, opa_data, opa_query
 *
 * Enabled when `OPA_URL` is set (e.g. http://opa:8181).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('OPA_URL', 'http://localhost:8181');
  const fetchJSON = helpers.createFetcher('OPA', 'opa');

  // ── opa_health ────────────────────────────────────────────────────────────

  server.tool(
    'opa_health',
    'Check OPA health, including whether all configured bundles have loaded and activated.',
    {},
    async () => {
      try {
        // /health returns 200 with {} when healthy; bundles=true checks bundle activation.
        await fetchJSON(`${baseUrl}/health?bundles=true`);
        return textResult({ status: 'ok', bundlesActivated: true });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── opa_policies ──────────────────────────────────────────────────────────

  server.tool(
    'opa_policies',
    'List loaded policy modules (Rego files) with their package paths.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/v1/policies`);
        const policies = (data.result || []).map((p: any) => ({
          id: p.id,
          package: p.ast?.package?.path
            ?.map((t: any) => t.value)
            .filter((v: any) => v !== 'data')
            .join('.') || null,
        }));
        return textResult({ count: policies.length, policies });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── opa_data ──────────────────────────────────────────────────────────────

  server.tool(
    'opa_data',
    'Fetch or evaluate a document at a data path (e.g. "kubernetes/admission/deny"). Optionally pass input to evaluate a decision against it.',
    {
      path: z.string().describe('Data path, slash-separated (e.g. "kubernetes/admission/deny")'),
      input: z.string().optional().describe('Optional JSON input object to evaluate the policy against'),
    },
    async ({ path, input }) => {
      try {
        const clean = path.replace(/^\/+|\/+$/g, '');
        const qs = new URLSearchParams();
        if (input) qs.set('input', input); // OPA accepts input as a URL-encoded JSON query param on GET
        const suffix = qs.toString() ? `?${qs}` : '';
        const data = await fetchJSON(`${baseUrl}/v1/data/${clean}${suffix}`);
        return textResult({ path: clean, result: data.result ?? null });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── opa_query ─────────────────────────────────────────────────────────────

  server.tool(
    'opa_query',
    'Run an ad-hoc Rego query and return the bindings — useful for enumerating violations across packages (e.g. "data.kubernetes.admission.deny[msg]").',
    {
      q: z.string().describe('Rego query expression (e.g. "data.example.violation[x]")'),
    },
    async ({ q }) => {
      try {
        const qs = new URLSearchParams({ q });
        const data = await fetchJSON(`${baseUrl}/v1/query?${qs}`);
        return textResult({ query: q, result: data.result ?? [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'opa',
  name: 'Open Policy Agent',
  description: 'Query OPA policy decisions, loaded modules, and data documents via its REST API',
  tools: 4,
  backends: ['OPA'],
  isAvailable: () => !!process.env['OPA_URL'],
  register: registerTools,
};
