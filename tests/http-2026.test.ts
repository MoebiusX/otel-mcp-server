import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Integration tests for MCP 2026-07-28 serving over real HTTP.
 *
 * The point of these is that the 2026 revision removed the handshake and the
 * session (SEP-2575, SEP-2567), which SDK v1 still requires — so the only way
 * to know our shim actually works is to drive a real server the way a 2026
 * client would: a bare `tools/call` as the very first request, with no
 * initialize, no session id, `_meta` client info, and the routing headers.
 *
 * Pre-2026 behaviour is covered by http-session.test.ts and must keep working
 * against the same process; the "both eras" test below asserts that.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', 'dist', 'index.js');

const SPEC_2026 = '2026-07-28';
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('MCP 2026-07-28 over HTTP', () => {
  let proc: ChildProcessWithoutNullStreams;
  let baseUrl: string;

  beforeAll(async () => {
    const port = 15000 + Math.floor(Math.random() * 2000);
    baseUrl = `http://127.0.0.1:${port}`;

    proc = spawn(process.execPath, [ENTRY, '--http', String(port)], {
      env: { ...process.env, MCP_SESSION_IDLE_MS: '5000', MCP_SESSION_SWEEP_MS: '5000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start in time')), 15_000);
      proc.stderr.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening on')) {
          clearTimeout(timer);
          resolve();
        }
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited early with code ${code}`));
      });
    });
  }, 20_000);

  afterAll(() => {
    proc?.kill('SIGKILL');
  });

  /** Post a 2026-style request: no session, JSON-only Accept, routing headers. */
  async function post2026(
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; headers: Headers; body: any }> {
    const params = body.params as Record<string, unknown> | undefined;
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // A 2026 client may sensibly ask for JSON only — SDK v1 would 406.
        Accept: 'application/json',
        'MCP-Protocol-Version': SPEC_2026,
        'Mcp-Method': String(body.method),
        ...(typeof params?.name === 'string' ? { 'Mcp-Name': params.name } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      // The SDK may answer with an SSE frame; pull the JSON payload out.
      const line = text.split('\n').find((l) => l.startsWith('data:'));
      parsed = line ? JSON.parse(line.slice(5).trim()) : text;
    }
    return { status: res.status, headers: res.headers, body: parsed };
  }

  const meta = {
    [CLIENT_INFO_KEY]: { name: 'vitest-2026', version: '1.0' },
    traceparent: TRACEPARENT,
  };

  it('serves tools/list as the first request — no initialize handshake', async () => {
    const r = await post2026({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: meta },
    });

    expect(r.status).toBe(200);
    expect(r.body.error, JSON.stringify(r.body.error)).toBeUndefined();
    expect(Array.isArray(r.body.result?.tools)).toBe(true);
    expect(r.body.result.tools.length).toBeGreaterThan(0);
  });

  it('issues no session id — any replica can serve any request (SEP-2567)', async () => {
    const r = await post2026({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } });
    expect(r.headers.get('mcp-session-id')).toBeNull();

    // A second, wholly independent request works with no continuity token.
    const again = await post2026({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: meta } });
    expect(again.status).toBe(200);
    expect(again.body.result?.tools?.length).toBe(r.body.result?.tools?.length);
  });

  it('attaches ttlMs and cacheScope to list results (SEP-2549)', async () => {
    const r = await post2026({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: meta } });
    expect(r.body.result.ttlMs).toBeGreaterThan(0);
    expect(r.body.result.cacheScope).toBe('session');
  });

  it('answers server/discover with capabilities and the skill inventory (SEP-2575)', async () => {
    const r = await post2026({ jsonrpc: '2.0', id: 5, method: 'server/discover', params: { _meta: meta } });
    expect(r.status).toBe(200);
    expect(r.body.result.serverInfo.name).toBe('otel-mcp-server');
    expect(r.body.result.supportedProtocolVersions).toContain(SPEC_2026);
    expect(Array.isArray(r.body.result.skills)).toBe(true);
  });

  it('rejects a request whose Mcp-Method disagrees with the body (SEP-2243)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'MCP-Protocol-Version': SPEC_2026,
        'Mcp-Method': 'tools/list', // lies about the body below
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'x', _meta: meta } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toMatch(/Mcp-Method/);
  });

  it('rejects a Mcp-Name that disagrees with the tool being called', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'MCP-Protocol-Version': SPEC_2026,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'metrics_query',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'system_health' } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Mcp-Name/);
  });

  it('reports an unknown resource with -32602, not the retired -32002 (SEP-2164)', async () => {
    const r = await post2026({
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/read',
      params: { uri: 'otel://does-not-exist', _meta: meta },
    });
    expect(r.body.error?.code).toBe(-32602);
  });

  it('still serves pre-2026 clients on the same endpoint', async () => {
    // Session-based initialize must keep working alongside the stateless path.
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id'), 'legacy clients still get a session').toBeTruthy();
  });

  it('advertises spec support and both eras on /health', async () => {
    const health = await (await fetch(`${baseUrl}/health?versions=0`)).json();
    expect(health.mcpSpec.latest).toBe(SPEC_2026);
    expect(health.mcpSpec.supported).toContain(SPEC_2026);
    expect(health.mcpSpec.supported).toContain('2025-11-25');
  });

  it('records spec version and trace-context propagation in metrics', async () => {
    await post2026({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: { _meta: meta } });
    const text = await (await fetch(`${baseUrl}/metrics`)).text();
    expect(text).toMatch(/mcp_spec_requests_total\{.*mode="stateless".*version="2026-07-28".*\} \d+/);
    expect(text).toMatch(/mcp_trace_context_propagated_total\{source="meta"\} \d+/);
    expect(text).toMatch(/mcp_routing_header_rejections_total\{header="Mcp-Method"\} \d+/);
  });

  it('advertises the 2026 headers in the CORS preflight', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'OPTIONS' });
    const allowed = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowed).toMatch(/Mcp-Method/);
    expect(allowed).toMatch(/Mcp-Name/);
    expect(allowed).toMatch(/MCP-Protocol-Version/);
  });
});
