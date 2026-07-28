import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * End-to-end proof of W3C Trace Context propagation (MCP 2026-07-28 SEP-414).
 *
 * The unit tests cover extraction and header building; this one covers the
 * thing that actually matters and that unit tests cannot show: a `traceparent`
 * a client puts in a tool call's `_meta` arrives on the outbound HTTP request
 * this server makes to the telemetry backend. Without that, a tool call and
 * the backend queries it triggers are unrelated spans — the exact correlation
 * an OpenTelemetry MCP server exists to provide.
 *
 * A stub backend stands in for Prometheus and records the headers it received.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', 'dist', 'index.js');

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACESTATE = 'vendor=abc';
const BAGGAGE = 'tenant=acme';
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';

describe('trace context reaches backend requests (SEP-414)', () => {
  let proc: ChildProcessWithoutNullStreams;
  let backend: Server;
  let baseUrl: string;
  const received: Array<Record<string, string | string[] | undefined>> = [];

  beforeAll(async () => {
    // Stub Prometheus: answers any query, records the request headers.
    const backendPort = 17000 + Math.floor(Math.random() * 1000);
    backend = createServer((req, res) => {
      received.push({ ...req.headers });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [] } }));
    });
    await new Promise<void>((resolve) => backend.listen(backendPort, '127.0.0.1', resolve));

    const port = 16000 + Math.floor(Math.random() * 1000);
    baseUrl = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [ENTRY, '--http', String(port), '--tools', 'metrics'], {
      env: { ...process.env, PROMETHEUS_URL: `http://127.0.0.1:${backendPort}` },
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
  }, 25_000);

  afterAll(async () => {
    proc?.kill('SIGKILL');
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  });

  async function callTool(meta: Record<string, unknown>, httpHeaders: Record<string, string> = {}) {
    received.length = 0;
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'metrics_query',
        ...httpHeaders,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'metrics_query', arguments: { query: 'up' }, _meta: meta },
      }),
    });
    expect(res.status).toBe(200);
    return received;
  }

  it('propagates traceparent, tracestate, and baggage from _meta to the backend', async () => {
    const seen = await callTool({
      [CLIENT_INFO_KEY]: { name: 'vitest', version: '1' },
      traceparent: TRACEPARENT,
      tracestate: TRACESTATE,
      baggage: BAGGAGE,
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!['traceparent']).toBe(TRACEPARENT);
    expect(seen[0]!['tracestate']).toBe(TRACESTATE);
    expect(seen[0]!['baggage']).toBe(BAGGAGE);
  });

  it('falls back to inbound HTTP trace headers when _meta carries none', async () => {
    const seen = await callTool({}, { traceparent: TRACEPARENT });
    expect(seen[0]!['traceparent']).toBe(TRACEPARENT);
  });

  it('sends no trace headers when the client propagated none', async () => {
    const seen = await callTool({});
    expect(seen[0]!['traceparent']).toBeUndefined();
    expect(seen[0]!['tracestate']).toBeUndefined();
  });

  it('does not forward a malformed traceparent to the backend', async () => {
    const seen = await callTool({ traceparent: 'garbage-value' });
    expect(seen[0]!['traceparent']).toBeUndefined();
  });
});
