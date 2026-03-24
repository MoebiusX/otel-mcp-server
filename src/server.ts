/**
 * MCP Server factory — creates and configures the McpServer
 * with all tool groups and resources.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.js';
import { registerTraceTools } from './tools/traces.js';
import { registerMetricsTools } from './tools/metrics.js';
import { registerLogTools } from './tools/logs.js';
import { registerZKTools } from './tools/zk-proofs.js';
import { registerSystemTools } from './tools/system.js';
import { registerElasticsearchTools } from './tools/elasticsearch.js';
import { registerAlertmanagerTools } from './tools/alertmanager.js';
import { registerResources } from './resources/overview.js';

export const VERSION = '1.1.0';

export type ToolGroup = 'traces' | 'metrics' | 'logs' | 'zk-proofs' | 'system' | 'elasticsearch' | 'alertmanager';

export const ALL_TOOL_GROUPS: ToolGroup[] = [
  'traces', 'metrics', 'logs', 'zk-proofs', 'system', 'elasticsearch', 'alertmanager',
];

export interface ServerOptions {
  /** Tool groups to enable. Defaults to all. */
  tools?: ToolGroup[];
}

/**
 * Create a fully configured MCP server.
 *
 * @param config  - Backend URLs and settings
 * @param options - Which tool groups to enable (default: all)
 */
export function createServer(config: Config, options: ServerOptions = {}): McpServer {
  const enabled = new Set(options.tools || ALL_TOOL_GROUPS);

  const server = new McpServer({
    name: 'otel-mcp-server',
    version: VERSION,
  });

  if (enabled.has('traces'))         registerTraceTools(server, config);
  if (enabled.has('metrics'))        registerMetricsTools(server, config);
  if (enabled.has('logs'))           registerLogTools(server, config);
  if (enabled.has('zk-proofs'))      registerZKTools(server, config);
  if (enabled.has('system'))         registerSystemTools(server, config);
  if (enabled.has('elasticsearch'))  registerElasticsearchTools(server, config);
  if (enabled.has('alertmanager'))   registerAlertmanagerTools(server, config);

  registerResources(server);

  return server;
}
