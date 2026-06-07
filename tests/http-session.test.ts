import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Integration tests for the HTTP transport's session lifecycle.
 *
 * Regression coverage for two bugs:
 *  1. transport.onclose infinite recursion — a client DELETE crashed the
 *     process with "RangeError: Maximum call stack size exceeded" because
 *     onclose -> mcpServer.close() -> transport.close() -> onclose recursed.
 *  2. Session leak — sessions were only removed on DELETE, so clients that
 *     disconnected without one leaked an McpServer per handshake.
 *
 * The server is launched as a child process (matching production) and driven
 * over real HTTP so the SDK transport's close path is exercised end to end.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', 'dist', 'index.js');

const PROTOCOL_VERSION = '2025-06-18';
const ACCEPT = 'application/json, text/event-stream';

describe('HTTP session lifecycle', () => {
  let proc: ChildProcessWithoutNullStreams;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    port = 13000 + Math.floor(Math.random() * 2000);
    baseUrl = `http://127.0.0.1:${port}`;

    proc = spawn(process.execPath, [ENTRY, '--http', String(port)], {
      env: { ...process.env, MCP_SESSION_IDLE_MS: '500', MCP_SESSION_SWEEP_MS: '500' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('server did not start in time')),
        15_000,
      );
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

  async function initialize(): Promise<string> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: ACCEPT,
        'MCP-Protocol-Version': PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'vitest', version: '1' },
        },
      }),
    });
    const sid = res.headers.get('mcp-session-id');
    expect(sid, 'initialize should return an mcp-session-id header').toBeTruthy();
    return sid!;
  }

  it('does not crash when a client closes its session with DELETE', async () => {
    const sid = await initialize();

    const del = await fetch(`${baseUrl}/mcp`, {
      method: 'DELETE',
      headers: { Accept: ACCEPT, 'Mcp-Session-Id': sid },
    });
    expect(del.status).toBeLessThan(500);

    // The recursion bug crashed the process on DELETE. If the server is still
    // serving /health, the onclose guard held.
    const health = await fetch(`${baseUrl}/health?versions=0`);
    expect(health.status).toBe(200);
    expect(proc.exitCode).toBeNull();
  });

  it('reaps idle sessions so the session map stays bounded', async () => {
    const before = await activeSessions();
    await initialize(); // never closed by the client
    expect(await activeSessions()).toBeGreaterThan(before);

    // With MCP_SESSION_IDLE_MS=500 and MCP_SESSION_SWEEP_MS=500, an idle
    // session is reaped within ~1s. Poll until the gauge returns to baseline.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if ((await activeSessions()) <= before) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(await activeSessions()).toBeLessThanOrEqual(before);
    expect(proc.exitCode).toBeNull();
  }, 15_000);

  async function activeSessions(): Promise<number> {
    const res = await fetch(`${baseUrl}/metrics`);
    const body = await res.text();
    const match = body.match(/^mcp_active_sessions\s+(\d+)/m);
    return match ? Number(match[1]) : 0;
  }
});
