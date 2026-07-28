#!/usr/bin/env node

/**
 * OpenTelemetry MCP Server
 *
 * Exposes telemetry backends as MCP tools for AI agents.
 * Each backend is a "skill" — a self-contained plugin that
 * self-configures from environment variables.
 *
 * Transports:
 *   stdio   — Default. For Claude Desktop, GitHub Copilot, etc.
 *   HTTP    — Use --http <port> for remote / multi-client access.
 *
 * Usage:
 *   otel-mcp-server                                # stdio mode
 *   otel-mcp-server --http 3001                    # HTTP mode
 *   otel-mcp-server --tools traces,metrics,logs    # only core OTEL tools
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, VERSION, allSkills } from './server.js';
import type { ServerOptions } from './server.js';
import { loadClientKeys, validateClientKey, extractCredential } from './auth.js';
import { readJitConfig, JitTokenService, looksLikeJitToken, jitPrincipal } from './jit.js';
import { createJitStores, type JitStoreBundle } from './jit-store.js';
import {
  readEnterpriseAuthConfig,
  EnterpriseAuthService,
  authorizationServerMetadata,
  protectedResourceMetadata,
  ENTERPRISE_AUTH_EXTENSION_ID,
} from './enterprise-auth.js';
import { handleJitRequest } from './transports/jit-endpoints.js';
import {
  parseMcpRequest,
  checkRoutingHeaders,
  rejectRoutingMismatch,
  adaptHeadersForSdk,
  withRequestContext,
  decorateWithCacheHints,
  type ParsedMcpRequest,
} from './transports/mcp-2026.js';
import { specFeatures, MCP_SPEC_LATEST, MCP_SPEC_VERSIONS } from './mcp-spec.js';
import { metrics, serializeMetrics } from './metrics.js';
import { createSkillHelpers } from './skill.js';
import { versionRegistry } from './version-registry.js';
import { SessionStore } from './transports/session-store.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const validIds = allSkills.map(s => s.id);

  // Parse --tools flag
  const toolsIndex = args.indexOf('--tools');
  const options: ServerOptions = {};
  if (toolsIndex !== -1 && args[toolsIndex + 1]) {
    const toolNames = args[toolsIndex + 1]!.split(',').map(t => t.trim());
    options.tools = toolNames.filter(t => validIds.includes(t));
  }

  const enabledIds = new Set(options.tools || validIds);

  // Parse --http flag
  const httpIndex = args.indexOf('--http');

  if (httpIndex !== -1 && args[httpIndex + 1]) {
    // ── HTTP transport ────────────────────────────────────────────────────
    const port = parseInt(args[httpIndex + 1]!, 10);
    const clientKeys = loadClientKeys();

    // Enterprise-managed authorization (MCP ext-auth): the corporate IdP
    // decides who may use this server; ID-JAG assertions are exchanged for
    // JIT session tokens at POST /auth/token.
    const enterpriseConfig = readEnterpriseAuthConfig();

    // Auth is on when local keys exist or an enterprise IdP is trusted — an
    // enterprise-only deployment must not leave the MCP endpoints open.
    const authEnabled = clientKeys.length > 0 || !!enterpriseConfig;

    if (!authEnabled) {
      console.error('  Auth:    ⚠ No client keys configured — HTTP server is OPEN');
      console.error('           Set MCP_AUTH_KEYS env or mount auth-keys.json');
    }

    // JIT privileged identity — exchange static keys (or enterprise ID-JAGs)
    // for scoped, ephemeral, rotatable session tokens (OWASP MCP Top 10:
    // MCP01/MCP02/MCP07/MCP08). Enterprise auth mints through the same
    // service, so configuring it auto-enables the token infrastructure.
    const jitConfig = readJitConfig();
    let jitService: JitTokenService | null = null;
    let jitStores: JitStoreBundle | null = null;
    if (jitConfig.mode !== 'off' || enterpriseConfig) {
      if (!authEnabled && !enterpriseConfig) {
        console.error('  JIT:     ⚠ MCP_JIT_MODE is set but no client keys exist to mint from — JIT identity disabled');
      } else {
        // Token + single-use replay state live behind MCP_JIT_STORE (default:
        // in-process memory). A shared adapter makes validation, revocation,
        // and ID-JAG single-use correct across replicas (roadmap Phase 1).
        jitStores = await createJitStores();
        jitService = new JitTokenService(jitConfig, { store: jitStores.tokens });
        console.error(
          `  JIT:     mode=${jitConfig.mode} ttl=${jitConfig.ttlSeconds}s ` +
          `maxLifetime=${jitConfig.maxLifetimeSeconds}s store=${jitStores.description} ` +
          `— POST /auth/token to mint scoped session tokens`,
        );
      }
    }

    const enterpriseService =
      enterpriseConfig && jitService && jitStores
        ? new EnterpriseAuthService(enterpriseConfig, { denylist: jitStores.denylist })
        : null;
    if (enterpriseService) {
      console.error(
        `  IdP:     enterprise-managed authorization — issuer=${enterpriseConfig!.issuer} ` +
        `audience=${enterpriseConfig!.audience}`,
      );
    }
    // Clients discover the resource's authorization server via RFC 9728
    // metadata referenced from 401 challenges (MCP core authorization spec).
    const wwwAuthenticate = enterpriseConfig
      ? `Bearer resource_metadata="${enterpriseConfig.resource.replace(/\/$/, '')}/.well-known/oauth-protected-resource"`
      : undefined;

    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const http = await import('node:http');

      // ── Session-based MCP transport ──────────────────────────────
      // Each MCP session gets its own McpServer + Transport pair.
      // The init request creates a new session; subsequent requests
      // reuse the same pair via the Mcp-Session-Id header.
      const { randomUUID } = await import('node:crypto');
      const sessions = new SessionStore<
        InstanceType<typeof StreamableHTTPServerTransport>,
        ReturnType<typeof createServer>
      >({
        onOpen: () => metrics.activeSessions.inc(),
        onClose: () => metrics.activeSessions.dec(),
      });

      // Idle-session reaper. A session is normally removed when the client
      // sends an HTTP DELETE, which fires transport.onclose. Clients that
      // disconnect without DELETE (stateless callers, crashes, synthetic
      // health probes) would otherwise leave their McpServer + transport pair
      // in the map forever — one leaked instance per handshake — until the
      // process runs out of memory. Periodically close any session whose last
      // activity is older than SESSION_IDLE_MS; closing the transport fires the
      // (re-entry-guarded) onclose, which removes it and closes its McpServer.
      const SESSION_IDLE_MS = Number(process.env.MCP_SESSION_IDLE_MS) || 5 * 60_000;
      const SESSION_SWEEP_MS = Number(process.env.MCP_SESSION_SWEEP_MS) || 60_000;
      const reaper = setInterval(() => {
        sessions.sweepIdle(SESSION_IDLE_MS);
        // Store calls are async; a rejection here must never become an
        // unhandled rejection that kills the process on a sweep tick (e.g. a
        // transient outage of an external MCP_JIT_STORE backend).
        void (async () => {
          if (jitService) {
            await jitService.sweep();
            metrics.jitActiveTokens.set({}, await jitService.activeCount());
          }
          if (enterpriseService) {
            await enterpriseService.sweep();
            metrics.jitIdjagReplayCacheSize.set({}, await enterpriseService.redeemedCount());
          }
        })().catch((err) => {
          console.error(
            `  JIT:     ⚠ store sweep failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, SESSION_SWEEP_MS);
      reaper.unref();

      const httpServer = http.createServer(async (req, res) => {
        // Health check — always open
        if (req.method === 'GET' && req.url?.startsWith('/health')) {
          // Detected backend versions/tiers. Opt out with `/health?versions=0`
          // to skip live probing (e.g. for fast liveness checks).
          const wantVersions = !/[?&]versions=0\b/.test(req.url);
          let versions: unknown[] = [];
          if (wantVersions) {
            try {
              versions = await versionRegistry.resolveEnabled(
                createSkillHelpers(),
                enabledIds,
              );
            } catch {
              versions = [];
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            server: 'otel-mcp-server',
            version: VERSION,
            auth: authEnabled ? 'enabled' : 'disabled',
            jit: jitService
              ? {
                  mode: jitConfig.mode,
                  activeTokens: await jitService.activeCount(),
                  store: jitStores?.description ?? 'memory',
                }
              : { mode: 'off' },
            enterpriseAuth: enterpriseService
              ? { configured: true, issuer: enterpriseConfig!.issuer }
              : { configured: false },
            mcpSpec: {
              latest: MCP_SPEC_LATEST,
              supported: [...MCP_SPEC_VERSIONS],
              // Stateless serving is selected per request from the client's
              // declared revision — both eras are served concurrently.
              statelessFrom: '2026-07-28',
              extensions: enterpriseConfig ? [ENTERPRISE_AUTH_EXTENSION_ID] : [],
            },
            skills: allSkills
              .filter(s => enabledIds.has(s.id))
              .map(s => ({ id: s.id, available: s.isAvailable(), tools: s.tools })),
            backendVersions: versions,
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

        // OAuth discovery documents (enterprise-managed authorization) —
        // always open, like /health. RFC 8414 metadata advertises the ID-JAG
        // grant profile; RFC 9728 points clients at this authorization server.
        if (enterpriseConfig && req.method === 'GET') {
          const path = req.url?.split('?')[0];
          if (path === '/.well-known/oauth-authorization-server') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(authorizationServerMetadata(enterpriseConfig, [...enabledIds])));
            return;
          }
          if (path === '/.well-known/oauth-protected-resource') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(protectedResourceMetadata(enterpriseConfig, [...enabledIds])));
            return;
          }
        }

        // CORS preflight — always open. The allow-list covers both protocol
        // eras: Mcp-Session-Id for ≤2025-11-25 clients, and the 2026-07-28
        // routing/version headers (SEP-2243, SEP-2575) for newer ones.
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              'Content-Type, Authorization, X-API-Key, Mcp-Session-Id, ' +
              'MCP-Protocol-Version, Mcp-Method, Mcp-Name, traceparent, tracestate, baggage',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
          });
          res.end();
          return;
        }

        // JIT identity lifecycle — mint / refresh / revoke session tokens.
        // Handles all /auth/* paths (404 with a hint when JIT is disabled).
        if (
          await handleJitRequest(req, res, {
            service: jitService,
            enterprise: enterpriseService,
            clientKeys,
            enabledSkillIds: [...enabledIds],
          })
        ) {
          return;
        }

        // Client authentication — static API key or JIT session token.
        // `principal` binds the MCP session to the identity that created it;
        // `scopes` restricts which skills the session may activate (null =
        // unrestricted).
        let principal: string | undefined;
        let scopes: string[] | null = null;
        if (authEnabled) {
          const authHeader = req.headers['authorization'] as string | undefined;
          const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
          const credential = extractCredential(authHeader, apiKeyHeader);

          if (jitService && credential && looksLikeJitToken(credential)) {
            // Ephemeral session token
            const validation = await jitService.validate(credential);
            if (!validation.ok) {
              metrics.authAttempts.inc({ result: 'rejected' });
              metrics.jitDenials.inc({ reason: validation.reason });
              res.writeHead(401, {
                'Content-Type': 'application/json',
                ...(wwwAuthenticate ? { 'WWW-Authenticate': wwwAuthenticate } : {}),
              });
              res.end(JSON.stringify({
                error: 'Unauthorized',
                message: `Session token is ${validation.reason}. Rotate live tokens via POST /auth/token/refresh, or mint a new one via POST /auth/token.`,
              }));
              return;
            }
            metrics.authAttempts.inc({ result: 'accepted' });
            principal = jitPrincipal(validation.record);
            scopes = validation.record.scopes;
          } else {
            // Static API key
            const clientKey = validateClientKey(clientKeys, authHeader, apiKeyHeader);

            if (!clientKey) {
              metrics.authAttempts.inc({ result: 'rejected' });
              res.writeHead(401, {
                'Content-Type': 'application/json',
                ...(wwwAuthenticate ? { 'WWW-Authenticate': wwwAuthenticate } : {}),
              });
              res.end(JSON.stringify({
                error: 'Unauthorized',
                message: 'Valid API key required. Pass via Authorization: Bearer <key> or X-API-Key header.',
              }));
              return;
            }

            if (jitService && jitService.config.mode === 'required') {
              // Zero standing privilege: static keys may only mint tokens.
              metrics.authAttempts.inc({ result: 'rejected' });
              metrics.jitDenials.inc({ reason: 'static_key_blocked' });
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'Forbidden',
                message: 'MCP_JIT_MODE=required — static API keys may only mint session tokens. POST /auth/token, then authenticate with the returned token.',
              }));
              return;
            }

            metrics.authAttempts.inc({ result: 'accepted' });
            principal = `key:${clientKey.id}`;
            scopes = clientKey.allowedTools ?? null;
          }
        }

        // ── MCP request pre-processing (2026-07-28 readiness) ──────────
        // Buffer the body once here: it is what makes the SEP-2243 header/
        // body cross-check possible and what carries _meta trace context.
        // The SDK accepts it as `parsedBody` so nothing re-reads the stream.
        let parsed: ParsedMcpRequest;
        try {
          parsed = await parseMcpRequest(req, principal);
        } catch (err) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Payload Too Large',
            message: err instanceof Error ? err.message : 'Request body too large',
          }));
          return;
        }

        const features = specFeatures(parsed.specVersion);

        // SEP-2243: a gateway may have routed or rate-limited on these
        // headers, so a body that disagrees means that decision was made on
        // false information. The spec requires rejection.
        const routing = checkRoutingHeaders(req, parsed.body);
        if (!routing.ok) {
          rejectRoutingMismatch(res, routing);
          return;
        }

        // SDK v1 hard-rejects protocol versions it does not know and demands
        // both Accept media types; translate before it ever sees the request.
        adaptHeadersForSdk(req, parsed.specVersion);

        const sessionScopes = scopes;
        const serverOptions = {
          ...(sessionScopes
            ? { tools: [...enabledIds].filter((id) => sessionScopes.includes(id)) }
            : options),
          ...(enterpriseConfig ? { extensions: [ENTERPRISE_AUTH_EXTENSION_ID] } : {}),
        };

        // ── Stateless path (MCP 2026-07-28) ────────────────────────────
        // No handshake, no session id: a fresh Server+transport pair serves
        // one request and is discarded, so any replica can answer any
        // request (SEP-2567). Scope enforcement is unchanged — the per-
        // request server registers only the credential's skills.
        if (features.statelessLifecycle) {
          // Only POST carries meaning without a session. A GET would open the
          // SDK's standalone SSE stream, whose body never ends — the await
          // below would never resolve, the cleanup in `finally` would never
          // run, and every such request would pin an McpServer for the life of
          // the process. DELETE is equally meaningless: there is no session to
          // close. 2026-07-28 removed SSE-delivered server requests anyway.
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32600,
                message: `${req.method} is not supported for MCP ${parsed.specVersion}; the protocol is stateless — send requests as POST`,
              },
            }));
            return;
          }

          await withRequestContext(parsed, async () => {
            const mcpServer = createServer(serverOptions);
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
              enableJsonResponse: true,
            });
            if (features.cacheHints) decorateWithCacheHints(transport, parsed.body);
            try {
              await mcpServer.connect(transport);
              await transport.handleRequest(req, res, parsed.body);
            } finally {
              // One-shot by design: the SDK refuses to reuse a stateless
              // transport, and nothing here may outlive the response.
              try { await transport.close(); } catch { /* already closed */ }
              try { await mcpServer.close(); } catch { /* already closed */ }
            }
          });
          return;
        }

        // ── Session path (≤ 2025-11-25 clients) ────────────────────────
        // Look up existing session
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId) {
          const session = sessions.touch(sessionId);
          if (!session) {
            // Fall through to the SDK's initialize handling for unknown session
            // ids, preserving the previous behavior where non-matching ids were
            // treated like new requests.
          } else if (session.principal && session.principal !== principal) {
            // A different credential may not reuse this session (OWASP MCP07).
            // JIT rotation is unaffected: the principal is the token lineage's
            // root id, which refresh preserves.
            metrics.jitDenials.inc({ reason: 'session_principal_mismatch' });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Forbidden',
              message: 'This MCP session belongs to a different credential. Initialize a new session.',
            }));
            return;
          } else {
            await withRequestContext(parsed, () =>
              session.transport.handleRequest(req, res, parsed.body),
            );
            return;
          }
        }

        // New session (initialize request). The session's McpServer registers
        // only the skills the presented credential is scoped to — out-of-scope
        // tools do not exist for this session.
        const mcpServer = createServer(serverOptions);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        sessions.bind(transport, mcpServer);

        await mcpServer.connect(transport);
        await withRequestContext(parsed, () => transport.handleRequest(req, res, parsed.body));

        if (transport.sessionId) {
          sessions.register(transport, mcpServer, principal);
        } else {
          // No session id was assigned (e.g. a non-initialize request with an
          // unknown session id). Nothing will ever close this pair otherwise,
          // so the active-sessions gauge would drift up permanently and the
          // McpServer would leak until GC.
          try { transport.close(); } catch { /* already closing */ }
        }
      });

    httpServer.listen(port, () => {
      console.error(`✓ otel-mcp-server v${VERSION} listening on http://0.0.0.0:${port}`);
      console.error(`  Health:  http://localhost:${port}/health`);
      console.error(`  Metrics: http://localhost:${port}/metrics`);
      console.error(`  Skills:`);
      for (const skill of allSkills) {
        if (!enabledIds.has(skill.id)) continue;
        const available = skill.isAvailable();
        const icon = available ? '✓' : '✗';
        const detail = available
          ? `${skill.name} (${skill.tools} tools) [${skill.backends.join(', ')}]`
          : 'not configured';
        console.error(`    ${icon} ${skill.id.padEnd(14)} — ${detail}`);
      }
    });
  } else {
    // ── stdio transport (default) ─────────────────────────────────────────
    const server = createServer(options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`✓ otel-mcp-server v${VERSION} running on stdio`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
