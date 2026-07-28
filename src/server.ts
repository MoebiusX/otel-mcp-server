/**
 * MCP Server factory — creates and configures the McpServer
 * with skills and resources.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { allSkills } from './skills.js';
import { createSkillHelpers } from './skill.js';
import type { Skill } from './skill.js';
import { registerResources } from './resources/overview.js';
import { MCP_SPEC_VERSIONS, MCP_SPEC_LATEST } from './mcp-spec.js';

export { VERSION } from './version.js';
import { VERSION } from './version.js';

export interface ServerOptions {
  /** Skill IDs to enable. Defaults to all available. */
  tools?: string[];
  /**
   * MCP extensions to advertise, as reverse-DNS ids (MCP 2026-07-28 SEP-2133).
   * Declared in server capabilities and echoed by `server/discover`.
   */
  extensions?: string[];
}

/**
 * `server/discover` (MCP 2026-07-28 SEP-2575) replaces the removed initialize
 * handshake: a stateless client fetches capabilities on demand instead of
 * negotiating them once per connection. The SDK has no such method, but its
 * request-handler registry accepts any method name, so it registers cleanly.
 */
const ServerDiscoverRequestSchema = z.object({
  method: z.literal('server/discover'),
  params: z.optional(z.object({}).loose()),
});

/**
 * Create a fully configured MCP server.
 *
 * Skills self-configure from environment variables.
 * Use `options.tools` to restrict which skills are activated.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const helpers = createSkillHelpers();
  const enabledIds = new Set(options.tools || allSkills.map(s => s.id));
  const extensions = options.extensions ?? [];

  const server = new McpServer(
    {
      name: 'otel-mcp-server',
      version: VERSION,
    },
    // SEP-2133: extensions are negotiated through a reverse-DNS keyed map on
    // capabilities. Declared only when the deployment actually implements one
    // (e.g. enterprise-managed authorization), never speculatively.
    extensions.length > 0
      ? {
          capabilities: {
            extensions: Object.fromEntries(extensions.map((id) => [id, {}])),
          },
        }
      : undefined,
  );

  const registered: Skill[] = [];
  for (const skill of allSkills) {
    if (enabledIds.has(skill.id) && skill.isAvailable()) {
      skill.register(server, helpers);
      registered.push(skill);
    }
  }

  registerResources(server, registered);
  registerDiscovery(server, registered, extensions);

  return server;
}

/** Answer `server/discover` with the same identity/capability data initialize carried. */
function registerDiscovery(server: McpServer, skills: Skill[], extensions: string[]): void {
  server.server.setRequestHandler(ServerDiscoverRequestSchema, async () => ({
    serverInfo: { name: 'otel-mcp-server', version: VERSION },
    protocolVersion: MCP_SPEC_LATEST,
    supportedProtocolVersions: [...MCP_SPEC_VERSIONS],
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
      ...(extensions.length > 0
        ? { extensions: Object.fromEntries(extensions.map((id) => [id, {}])) }
        : {}),
    },
    // Skill inventory is what an agent actually wants from discovery: which
    // telemetry domains this deployment can answer questions about.
    skills: skills.map((s) => ({ id: s.id, name: s.name, tools: s.tools, backends: s.backends })),
  }));
}

export { allSkills };
