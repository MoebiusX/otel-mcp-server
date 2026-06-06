import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

interface Call {
  method: string;
  url: string;
  init?: any;
}

interface Route {
  method?: string;
  match: string;
  status?: number;
  json?: any;
}

/** Method- and URL-aware fetch mock. First matching route wins; unmatched → 404. */
function routedFetch(routes: Route[], calls: Call[]) {
  return vi.fn(async (url: string | URL | Request, init?: any) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    const urlStr = typeof url === 'string' ? url : url.toString();
    calls.push({ method, url: urlStr, init });
    for (const r of routes) {
      if ((!r.method || r.method === method) && urlStr.includes(r.match)) {
        const status = r.status ?? 200;
        return { ok: status < 400, status, statusText: `status-${status}`, json: async () => r.json ?? {} };
      }
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  });
}

async function createTestClient() {
  const server = createServer({ tools: ['public-exchange'] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function parse(result: any) {
  return JSON.parse((result.content as any)[0].text);
}

describe('public-exchange skill — registration', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.APP_API_URL = 'http://app.example.com';
    vi.stubGlobal('fetch', routedFetch([], []));
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('registers all five read-only tools', async () => {
    const { client } = await createTestClient();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['exchange_status', 'recent_trades', 'total_volume', 'transparency_metrics', 'verify_trace'].sort(),
    );
  });
});

describe('public-exchange tools', () => {
  const originalEnv = process.env;
  let calls: Call[];
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.APP_API_URL = 'http://app.example.com';
    calls = [];
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('exchange_status hits /api/public/status', async () => {
    vi.stubGlobal('fetch', routedFetch([{ match: '/api/public/status', json: { status: 'operational', uptime: 99.99 } }], calls));
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'exchange_status', arguments: {} });
    expect(parse(result).status).toBe('operational');
    expect(calls[0].url).toBe('http://app.example.com/api/public/status');
  });

  it('total_volume summarizes the metrics bundle', async () => {
    vi.stubGlobal('fetch', routedFetch([{ match: '/api/public/metrics', json: { volume24h: 1000, volumeWeek: 7000, volumeAllTime: 42000, tradeCount24h: 12, timestamp: '2026-06-06T00:00:00Z' } }], calls));
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'total_volume', arguments: {} });
    const body = parse(result);
    expect(body.volume24h).toBe(1000);
    expect(body.tradeCount24h).toBe(12);
    expect(body.asOf).toBe('2026-06-06T00:00:00Z');
    expect(calls[0].url).toBe('http://app.example.com/api/public/metrics');
  });

  it('recent_trades passes the limit query param', async () => {
    vi.stubGlobal('fetch', routedFetch([{ match: '/api/public/trades', json: [{ id: 't1' }] }], calls));
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'recent_trades', arguments: { limit: 5 } });
    expect(parse(result)).toEqual([{ id: 't1' }]);
    expect(calls[0].url).toBe('http://app.example.com/api/public/trades?limit=5');
  });

  it('transparency_metrics returns the full bundle', async () => {
    vi.stubGlobal('fetch', routedFetch([{ match: '/api/public/metrics', json: { traceCoverage: 0.97, anomalies: 3 } }], calls));
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'transparency_metrics', arguments: {} });
    expect(parse(result).traceCoverage).toBe(0.97);
  });

  it('verify_trace encodes the trace id in the path', async () => {
    vi.stubGlobal('fetch', routedFetch([{ match: '/api/public/trace/', json: { traceId: 'abc/def', verified: true } }], calls));
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'verify_trace', arguments: { trace_id: 'abc/def' } });
    expect(parse(result).verified).toBe(true);
    expect(calls[0].url).toBe('http://app.example.com/api/public/trace/abc%2Fdef');
  });

  it('returns an error result when the backend responds non-2xx', async () => {
    vi.stubGlobal('fetch', routedFetch([{ match: '/api/public/status', status: 503, json: { error: 'down' } }], calls));
    const { client } = await createTestClient();
    const result: any = await client.callTool({ name: 'exchange_status', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
