/**
 * AgentRelay skill — coordinate with other agents via the AgentRelay hosted
 * REST API ("headless Slack for agents").
 *
 * Read tools: agentrelay_agents
 * Write tools (only when MCP_ENABLE_WRITES is set): agentrelay_send
 *
 * Enabled when `AGENTRELAY_URL` is set (e.g. https://api.agentrelay.tech).
 * Auth: set AGENTRELAY_AUTH_TOKEN for a bearer token (sent as
 * Authorization: Bearer). Use AGENTRELAY_AUTH_HEADER to send a raw header value
 * instead (e.g. an `X-API-Key` style scheme) if the deployment requires it.
 *
 * Scope (v1.5): outbound send + agent discovery only. Inbox, read-state,
 * threads, reactions, channels, and search are SDK-only and out of scope here.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

/** Writes are opt-in: only register mutating tools when MCP_ENABLE_WRITES is set. */
function writesEnabled(helpers: SkillHelpers): boolean {
  return /^(1|true|yes|on)$/i.test(helpers.env('MCP_ENABLE_WRITES').trim());
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('AGENTRELAY_URL');
  if (!baseUrl) return;

  const fetchJSON = helpers.createFetcher('AGENTRELAY', 'agentrelay');

  // ── agentrelay_agents ─────────────────────────────────────────────────────

  server.tool(
    'agentrelay_agents',
    'List the agents currently connected to your AgentRelay organization, with their handles and status.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/v1/agents`);
        const list = Array.isArray(data) ? data : (data?.agents ?? []);
        const agents = (Array.isArray(list) ? list : []).map((a: any) => ({
          id: a.id ?? a.agentId,
          name: a.name,
          handle: a.handle,
          status: a.status,
          type: a.type,
        }));
        return textResult({ count: agents.length, agents });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── Write tools (opt-in) ──────────────────────────────────────────────────
  // Disabled unless MCP_ENABLE_WRITES is set. Read-only stays the default
  // posture, so these tools are only advertised when writes are enabled.
  if (!writesEnabled(helpers)) return;

  // ── agentrelay_send ───────────────────────────────────────────────────────

  server.tool(
    'agentrelay_send',
    'Send a message or task to another agent through the AgentRelay relay via ' +
      'POST /v1/relay/send. Requires MCP_ENABLE_WRITES and an AgentRelay token.',
    {
      to: z.string().describe('Target agent handle or name (e.g. "reviewer").'),
      text: z.string().optional().describe('Message text. Wrapped into the payload as { message: text } unless an explicit payload is given.'),
      type: z.enum(['message', 'task']).default('message').describe('Delivery kind: "message" for chat, "task" for a unit of work.'),
      payload: z.record(z.string(), z.any()).optional().describe('Structured payload override. When supplied, it is sent as-is and "text" is ignored.'),
      dry_run: z.boolean().default(false).describe('Validate and report the planned request without sending.'),
    },
    async ({ to, text, type, payload, dry_run }) => {
      try {
        if (!payload && (text === undefined || text.trim() === '')) {
          return errorResult('provide either "text" or a structured "payload".');
        }
        const body = {
          to,
          type,
          payload: payload ?? { message: text },
        };
        if (dry_run) {
          return textResult({ dryRun: true, request: { method: 'POST', url: `${baseUrl}/v1/relay/send`, body } });
        }
        const data = await fetchJSON(
          `${baseUrl}/v1/relay/send`,
          undefined,
          { method: 'POST', body: JSON.stringify(body) },
        );
        return textResult({ sent: true, to, type, response: data });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'agentrelay',
  name: 'AgentRelay',
  description: 'Coordinate with other agents through the AgentRelay hosted REST API — list connected agents (plus an opt-in send tool via MCP_ENABLE_WRITES)',
  tools: 1,
  backends: ['AgentRelay'],
  isAvailable: () => !!process.env['AGENTRELAY_URL'],
  register: registerTools,
};
