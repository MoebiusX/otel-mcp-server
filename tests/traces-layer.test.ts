import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

/**
 * Traces layer — provider-agnostic surface (traces_search, trace_get,
 * traces_services, traces_operations, traces_dependencies) dispatched to one
 * of jaeger/tempo/zipkin/skywalking via the `TRACES_PROVIDER` env var.
 *
 * These tests exercise each provider through the layer's MCP tool surface,
 * and verify the unsupported-capability behavior (Tempo has no dependencies).
 */

function mockFetch(responses: Record<string, any>) {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for (const [pattern, data] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) return { ok: true, json: async () => data };
    }
    return { ok: false, status: 404, statusText: 'Not Found' };
  });
}

async function createTestClient(tools: string[]) {
  const server = createServer({ tools });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(st);
  await client.connect(ct);
  return { client, server };
}

const parse = (r: any) => JSON.parse(r.content[0].text);

const originalEnv = process.env;
beforeEach(() => { process.env = { ...originalEnv }; });
afterEach(() => { process.env = originalEnv; vi.unstubAllGlobals(); });

// ─── Layer surface ────────────────────────────────────────────────────────────

describe('traces layer', () => {
  it('exposes the stable 5-verb tool surface regardless of provider', async () => {
    for (const provider of ['jaeger', 'tempo', 'zipkin', 'skywalking']) {
      process.env = { ...originalEnv, TRACES_PROVIDER: provider };
      const { client } = await createTestClient(['traces']);
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(['trace_get', 'traces_dependencies', 'traces_operations', 'traces_search', 'traces_services']);
    }
  });

  it('rejects an unknown TRACES_PROVIDER at first tool call', async () => {
    process.env.TRACES_PROVIDER = 'nonexistent-provider';
    // createServer doesn't throw — resolveProvider is called lazily inside register.
    // But our register calls resolveProvider eagerly. Validate that loading fails clearly.
    expect(() => createServer({ tools: ['traces'] })).toThrow(/Unknown TRACES_PROVIDER/);
  });
});

// ─── Jaeger provider (default) ───────────────────────────────────────────────

describe('traces layer → jaeger provider', () => {
  beforeEach(() => {
    process.env.JAEGER_URL = 'http://jaeger-test:16686';
    vi.stubGlobal('fetch', mockFetch({
      '/api/traces?': { data: [{
        traceID: 't1',
        processes: { p1: { serviceName: 'api' } },
        spans: [{ spanID: 's1', processID: 'p1', operationName: 'GET /', startTime: 1_000_000, duration: 500_000, tags: [{ key: 'error', value: true }] }],
      }] },
      '/api/services': { data: ['api', 'web'] },
      '/api/operations': { data: ['GET /', 'POST /'] },
      '/api/dependencies': { data: [{ parent: 'web', child: 'api', callCount: 42 }] },
    }));
  });

  it('traces_search returns curated trace summaries', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_search', arguments: { service: 'api' } }));
    expect(out.count).toBe(1);
    expect(out.traces[0]).toMatchObject({ traceId: 't1', rootOperation: 'GET /', spanCount: 1, hasErrors: true });
  });

  it('traces_services lists services', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_services', arguments: {} }));
    expect(out.services).toEqual(['api', 'web']);
  });

  it('traces_dependencies returns the dependency graph', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_dependencies', arguments: { lookback: '1h' } }));
    expect(out.dependencies[0]).toMatchObject({ parent: 'web', child: 'api', callCount: 42 });
  });
});

// ─── Tempo provider ──────────────────────────────────────────────────────────

describe('traces layer → tempo provider', () => {
  beforeEach(() => {
    process.env.TRACES_PROVIDER = 'tempo';
    process.env.TEMPO_URL = 'http://tempo-test:3200';
    vi.stubGlobal('fetch', mockFetch({
      '/api/search?': { traces: [{ traceID: 't1', rootServiceName: 'api', rootTraceName: 'GET /', durationMs: 500, startTimeUnixNano: '1700000000000000000' }] },
      '/api/traces/': {
        batches: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'api' } }] },
          scopeSpans: [{ spans: [{ spanId: 'a', name: 'GET /', startTimeUnixNano: '1000000000', endTimeUnixNano: '1500000000', attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }] }] }],
        }],
      },
      '/api/search/tag/service.name/values': { tagValues: ['api', 'web'] },
    }));
  });

  it('traces_search synthesizes TraceQL from `service`', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_search', arguments: { service: 'api' } }));
    expect(out.count).toBe(1);
    expect(out.traces[0]).toMatchObject({ traceId: 't1', rootService: 'api', durationMs: 500 });
  });

  it('trace_get decodes OTLP', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'trace_get', arguments: { trace_id: 'abc' } }));
    expect(out.spanCount).toBe(1);
    expect(out.services).toEqual(['api']);
    expect(out.spans[0]).toMatchObject({ spanId: 'a', name: 'GET /', service: 'api', duration_ms: 500 });
    expect(out.spans[0].attributes['http.method']).toBe('GET');
  });

  it('traces_services derives services from the service.name tag values', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_services', arguments: {} }));
    expect(out.services).toEqual(['api', 'web']);
  });

  it('traces_dependencies is reported as unsupported (Tempo has no API for it)', async () => {
    const { client } = await createTestClient(['traces']);
    const out = await client.callTool({ name: 'traces_dependencies', arguments: { lookback: '1h' } });
    expect(out.isError).toBe(true);
    expect((out.content as any)[0].text).toMatch(/not supported by provider "tempo"/);
  });
});

// ─── Zipkin provider ─────────────────────────────────────────────────────────

describe('traces layer → zipkin provider', () => {
  beforeEach(() => {
    process.env.TRACES_PROVIDER = 'zipkin';
    process.env.ZIPKIN_URL = 'http://zipkin-test:9411';
    vi.stubGlobal('fetch', mockFetch({
      '/api/v2/traces': [[
        { traceId: 't1', id: 's1', name: 'GET /', timestamp: 1_000_000, duration: 500_000, localEndpoint: { serviceName: 'svc' }, tags: {} },
        { traceId: 't1', id: 's2', parentId: 's1', name: 'db', timestamp: 1_100_000, duration: 100_000, localEndpoint: { serviceName: 'db' }, tags: { error: '1' } },
      ]],
      '/api/v2/services': ['svc', 'db'],
      '/api/v2/spans': ['GET /', 'POST /'],
      '/api/v2/dependencies': [{ parent: 'svc', child: 'db', callCount: 7 }],
    }));
  });

  it('traces_search summarizes with duration and error flag', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_search', arguments: { service: 'svc' } }));
    expect(out.count).toBe(1);
    expect(out.traces[0]).toMatchObject({ traceId: 't1', rootOperation: 'GET /', spanCount: 2, duration_ms: 500, hasErrors: true });
  });

  it('traces_operations lists span names', async () => {
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_operations', arguments: { service: 'svc' } }));
    expect(out.operations).toEqual(['GET /', 'POST /']);
  });
});

// ─── SkyWalking provider ─────────────────────────────────────────────────────

describe('traces layer → skywalking provider', () => {
  beforeEach(() => {
    process.env.TRACES_PROVIDER = 'skywalking';
    process.env.SKYWALKING_URL = 'http://sw-test:12800';
  });

  it('traces_services lists services via GraphQL', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/graphql': { data: { services: [{ id: '1', name: 'svc', group: 'g' }] } },
    }));
    const { client } = await createTestClient(['traces']);
    const out = parse(await client.callTool({ name: 'traces_services', arguments: { lookback: '1h' } }));
    expect(out.count).toBe(1);
    expect(out.services[0]).toMatchObject({ name: 'svc' });
  });

  it('surfaces GraphQL errors clearly', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/graphql': { errors: [{ message: 'bad query' }] } }));
    const { client } = await createTestClient(['traces']);
    const out = await client.callTool({ name: 'traces_services', arguments: { lookback: '1h' } });
    expect(out.isError).toBe(true);
  });
});
