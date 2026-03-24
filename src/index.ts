#!/usr/bin/env node

/**
 * OpenTelemetry MCP Server
 *
 * Exposes traces (Jaeger), metrics (Prometheus), logs (Loki),
 * Elasticsearch, Alertmanager, and optionally ZK proofs as MCP
 * tools for AI agents.
 *
 * Transports:
 *   stdio   — Default. For Claude Desktop, GitHub Copilot, etc.
 *   HTTP    — Use --http <port> for remote / multi-client access.
 *
 * Usage:
 *   otel-mcp-server                  # stdio mode
 *   otel-mcp-server --http 3001      # HTTP mode on port 3001
 *   otel-mcp-server --tools traces,metrics,logs   # only core OTEL tools
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer, VERSION, ALL_TOOL_GROUPS } from './server.js';
import type { ToolGroup, ServerOptions } from './server.js';
import { loadClientKeys, validateClientKey } from './auth.js';
import { metrics, serializeMetrics } from './metrics.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse --tools flag
  const toolsIndex = args.indexOf('--tools');
  const options: ServerOptions = {};
  if (toolsIndex !== -1 && args[toolsIndex + 1]) {
    const toolNames = args[toolsIndex + 1]!.split(',').map(t => t.trim());
    options.tools = toolNames.filter(t => (ALL_TOOL_GROUPS as readonly string[]).includes(t)) as ToolGroup[];
  }

  const config = loadConfig();
  const server = createServer(config, options);
  const enabledTools = options.tools || ALL_TOOL_GROUPS;

  // Parse --http flag
  const httpIndex = args.indexOf('--http');

  if (httpIndex !== -1 && args[httpIndex + 1]) {
    // ── HTTP transport ────────────────────────────────────────────────────
    const port = parseInt(args[httpIndex + 1]!, 10);
    const clientKeys = loadClientKeys();
    const authEnabled = clientKeys.length > 0;

    if (!authEnabled) {
      console.error('  Auth:    ⚠ No client keys configured — HTTP server is OPEN');
      console.error('           Set MCP_AUTH_KEYS env or mount auth-keys.json');
    }

    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const http = await import('node:http');

    const httpServer = http.createServer(async (req, res) => {
      // Health check — always open
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          server: 'otel-mcp-server',
          version: VERSION,
          auth: authEnabled ? 'enabled' : 'disabled',
          tools: enabledTools,
        }));
        return;
      }

      // Prometheus metrics — always open
      if (req.method === 'GET' && req.url === '/metrics') {
        res.writeHead(200, {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        });
        res.end(serializeMetrics());
        return;
      }

      // CORS preflight — always open
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
        });
        res.end();
        return;
      }

      // Client authentication
      if (authEnabled) {
        const authHeader = req.headers['authorization'] as string | undefined;
        const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
        const clientKey = validateClientKey(clientKeys, authHeader, apiKeyHeader);

        if (!clientKey) {
          metrics.authAttempts.inc({ result: 'rejected' });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Unauthorized',
            message: 'Valid API key required. Pass via Authorization: Bearer <key> or X-API-Key header.',
          }));
          return;
        }
        metrics.authAttempts.inc({ result: 'accepted' });
      }

      // Track active sessions
      metrics.activeSessions.inc();

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        metrics.activeSessions.dec();
        transport.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    httpServer.listen(port, () => {
      console.error(`✓ otel-mcp-server v${VERSION} listening on http://0.0.0.0:${port}`);
      console.error(`  Health:  http://localhost:${port}/health`);
      console.error(`  Metrics: http://localhost:${port}/metrics`);
      console.error(`  Jaeger:  ${config.jaegerUrl}`);
      console.error(`  Prom:    ${config.prometheusUrl}${config.prometheusPathPrefix}`);
      console.error(`  Loki:    ${config.lokiUrl}`);
      if (config.elasticsearchUrl) console.error(`  ES:      ${config.elasticsearchUrl}`);
      if (config.alertmanagerUrl)  console.error(`  AM:      ${config.alertmanagerUrl}`);
      if (options.tools) {
        console.error(`  Tools:   ${options.tools.join(', ')}`);
      }
    });
  } else {
    // ── stdio transport (default) ─────────────────────────────────────────
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`✓ otel-mcp-server v${VERSION} running on stdio`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
