import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

/**
 * Behavioral tests for the skills added during the integration-breadth cycle.
 * Same approach as new-tools.test.ts: a real MCP server + client over an
 * in-memory transport, with `fetch` stubbed to return canned backend payloads.
 *
 * Note: the `kubernetes` skill uses node:https (not global fetch) so only its
 * registration is covered here; its request path needs an https mock (follow-up).
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

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

const originalEnv = process.env;
beforeEach(() => { process.env = { ...originalEnv }; });
afterEach(() => { process.env = originalEnv; vi.unstubAllGlobals(); });

// ─── Registration: each new skill registers its declared tools when configured ─

describe('new skill registration', () => {
  const cases: Array<[string, string, number]> = [
    ['cilium', 'CILIUM_URL', 6],
    ['beyla', 'BEYLA_PROMETHEUS_URL', 4],
    ['kubernetes', 'KUBERNETES_URL', 5],
    ['clickhouse', 'CLICKHOUSE_URL', 5],
    ['pyroscope', 'PYROSCOPE_URL', 4],
    ['opa', 'OPA_URL', 4],
    ['envoy', 'ENVOY_ADMIN_URL', 4],
    ['consul', 'CONSUL_URL', 5],
    ['kong', 'KONG_ADMIN_URL', 4],
    ['traefik', 'TRAEFIK_URL', 4],
    ['influx', 'INFLUX_URL', 3],
    ['opentsdb', 'OPENTSDB_URL', 3],
    ['graylog', 'GRAYLOG_URL', 3],
    ['pinpoint', 'PINPOINT_URL', 3],
    ['pipeline', 'FLUENTBIT_URL', 4],
  ];

  for (const [id, env, count] of cases) {
    it(`${id} registers ${count} tools when ${env} is set`, async () => {
      process.env[env] = 'http://backend-test:9999';
      const { client } = await createTestClient([id]);
      const result = await client.listTools();
      expect(result.tools.length).toBe(count);
    });
  }

  it('does not register a skill when its backend is unconfigured', async () => {
    delete process.env.CILIUM_URL;
    // pair with an always-on skill so tools/list is still advertised
    const { client } = await createTestClient(['cilium', 'system']);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith('cilium_'))).toBe(false);
    expect(names.length).toBeGreaterThan(0);
  });
});

// ─── Cilium ───────────────────────────────────────────────────────────────────

describe('cilium', () => {
  beforeEach(() => {
    process.env.CILIUM_URL = 'http://cilium-test:9234';
    vi.stubGlobal('fetch', mockFetch({
      '/v1/endpoint': [{
        id: 1,
        status: {
          'external-identifiers': { 'pod-name': 'p1', 'k8s-namespace': 'ns' },
          identity: { id: 100, labels: ['k8s:app=web'] },
          state: 'ready',
          networking: { addressing: [{ ipv4: '1.1.1.1' }] },
        },
      }],
    }));
  });

  it('curates endpoints', async () => {
    const { client } = await createTestClient(['cilium']);
    const out = parse(await client.callTool({ name: 'cilium_endpoints', arguments: {} }));
    expect(out.count).toBe(1);
    expect(out.endpoints[0]).toMatchObject({ podName: 'p1', namespace: 'ns', identity: 100, ipv4: '1.1.1.1', state: 'ready' });
  });
});

// ─── ClickHouse ─────────────────────────────────────────────────────────────

describe('clickhouse', () => {
  beforeEach(() => {
    process.env.CLICKHOUSE_URL = 'http://ch-test:8123';
    vi.stubGlobal('fetch', mockFetch({
      'ch-test': { meta: [{ name: 'count()', type: 'UInt64' }], data: [{ 'count()': '42' }], rows: 1, statistics: { elapsed: 0.01 } },
    }));
  });

  it('returns columns and rows', async () => {
    const { client } = await createTestClient(['clickhouse']);
    const out = parse(await client.callTool({ name: 'clickhouse_query', arguments: { sql: 'SELECT count() FROM logs' } }));
    expect(out.columns[0]).toMatchObject({ name: 'count()', type: 'UInt64' });
    expect(out.rows).toBe(1);
    expect(out.data[0]['count()']).toBe('42');
  });

  it('rejects invalid identifiers in logs_search', async () => {
    const { client } = await createTestClient(['clickhouse']);
    const out = await client.callTool({ name: 'clickhouse_logs_search', arguments: { table: 'logs; DROP TABLE x' } });
    expect(out.isError).toBe(true);
  });
});

// ─── Pyroscope (flamebearer decode) ───────────────────────────────────────────

describe('pyroscope', () => {
  beforeEach(() => {
    process.env.PYROSCOPE_URL = 'http://pyro-test:4040';
    vi.stubGlobal('fetch', mockFetch({
      '/render': {
        flamebearer: { names: ['total', 'funcA', 'funcB'], levels: [[0, 100, 0, 0], [0, 100, 90, 1], [0, 40, 40, 2]], numTicks: 100 },
        metadata: { units: 'samples' },
      },
    }));
  });

  it('decodes top functions by self time', async () => {
    const { client } = await createTestClient(['pyroscope']);
    const out = parse(await client.callTool({ name: 'pyroscope_render', arguments: { query: 'app.cpu{}' } }));
    expect(out.units).toBe('samples');
    expect(out.totalSamples).toBe(100);
    expect(out.topFunctions[0]).toMatchObject({ name: 'funcA', self: 90, selfPct: 90 });
    expect(out.topFunctions[1]).toMatchObject({ name: 'funcB', self: 40 });
  });
});

// ─── Beyla (RED metrics + network flows over PromQL) ────────────────────────

describe('beyla', () => {
  beforeEach(() => {
    process.env.BEYLA_PROMETHEUS_URL = 'http://prom-test:9090';
    vi.stubGlobal('fetch', mockFetch({
      '/api/v1/query': {
        data: { result: [{ metric: { service_name: 'checkout' }, value: [0, '12.5'] }] },
      },
    }));
  });

  it('discovers instrumented services with their request rate', async () => {
    const { client } = await createTestClient(['beyla']);
    const out = parse(await client.callTool({ name: 'beyla_services', arguments: {} }));
    expect(out.count).toBe(1);
    expect(out.services[0]).toMatchObject({ service: 'checkout', requestRate: 12.5 });
  });

  it('computes RED metrics for a service', async () => {
    const { client } = await createTestClient(['beyla']);
    const out = parse(await client.callTool({
      name: 'beyla_red_metrics', arguments: { service: 'checkout' },
    }));
    expect(out.service).toBe('checkout');
    expect(out.requestRate).toBe(12.5);
    // error count == request count in the canned response → 100%
    expect(out.errorPct).toBe(100);
    expect(out.latencySeconds.p95).toBe(12.5);
  });
});

// ─── Zipkin / Tempo / SkyWalking are now providers under the traces layer.
//     See tests/traces-layer.test.ts for their behavioral coverage.

// ─── Envoy (cluster health derivation) ──────────────────────────────────────

describe('envoy', () => {
  beforeEach(() => {
    process.env.ENVOY_ADMIN_URL = 'http://envoy-test:9901';
    vi.stubGlobal('fetch', mockFetch({
      '/clusters': { cluster_statuses: [{ name: 'c1', host_statuses: [
        { address: { socket_address: { address: '1.2.3.4', port_value: 80 } }, health_status: { eds_health_status: 'HEALTHY' } },
        { address: { socket_address: { address: '5.6.7.8', port_value: 80 } }, health_status: { eds_health_status: 'HEALTHY', failed_active_health_check: true } },
      ] }] },
    }));
  });

  it('derives endpoint health', async () => {
    const { client } = await createTestClient(['envoy']);
    const out = parse(await client.callTool({ name: 'envoy_clusters', arguments: {} }));
    expect(out.clusters[0].hosts[0]).toMatchObject({ address: '1.2.3.4:80', healthy: true });
    expect(out.clusters[0].hosts[1].healthy).toBe(false);
  });
});

// ─── Consul (instance health aggregation) ───────────────────────────────────

describe('consul', () => {
  beforeEach(() => {
    process.env.CONSUL_URL = 'http://consul-test:8500';
    vi.stubGlobal('fetch', mockFetch({
      '/v1/health/service/svc': [{
        Node: { Node: 'n1', Address: '10.0.0.1' },
        Service: { Service: 'svc', Address: '', Port: 8080, Tags: ['v1'] },
        Checks: [{ Status: 'passing' }, { Status: 'passing' }],
      }],
    }));
  });

  it('aggregates instance health and falls back to node address', async () => {
    const { client } = await createTestClient(['consul']);
    const out = parse(await client.callTool({ name: 'consul_service_instances', arguments: { service: 'svc' } }));
    expect(out.instances[0]).toMatchObject({ node: 'n1', address: '10.0.0.1', port: 8080, health: 'passing' });
  });
});

// ─── InfluxDB ───────────────────────────────────────────────────────────────

describe('influx', () => {
  beforeEach(() => {
    process.env.INFLUX_URL = 'http://influx-test:8086';
    vi.stubGlobal('fetch', mockFetch({
      '/query': { results: [{ series: [{ name: 'cpu', columns: ['time', 'mean'], values: [[0, 1.5]] }] }] },
    }));
  });

  it('curates InfluxQL series', async () => {
    const { client } = await createTestClient(['influx']);
    const out = parse(await client.callTool({ name: 'influx_query', arguments: { query: 'SELECT mean(v) FROM cpu' } }));
    expect(out.series[0]).toMatchObject({ name: 'cpu', rowCount: 1 });
    expect(out.series[0].columns).toEqual(['time', 'mean']);
  });
});

// ─── OpenTSDB (dps sorting) ──────────────────────────────────────────────────

describe('opentsdb', () => {
  beforeEach(() => {
    process.env.OPENTSDB_URL = 'http://otsdb-test:4242';
    vi.stubGlobal('fetch', mockFetch({
      '/api/query': [{ metric: 'sys.cpu', tags: { host: 'h1' }, dps: { '100': 5, '50': 3 } }],
    }));
  });

  it('returns sorted data points', async () => {
    const { client } = await createTestClient(['opentsdb']);
    const out = parse(await client.callTool({ name: 'opentsdb_query', arguments: { metric: 'sys.cpu' } }));
    expect(out.series[0].dpCount).toBe(2);
    expect(out.series[0].dps).toEqual([[50, 3], [100, 5]]);
  });
});

// ─── Graylog ──────────────────────────────────────────────────────────────

describe('graylog', () => {
  beforeEach(() => {
    process.env.GRAYLOG_URL = 'http://graylog-test:9000';
    vi.stubGlobal('fetch', mockFetch({
      '/api/search/universal/relative': { total_results: 2, messages: [{ message: { timestamp: 't', source: 's', message: 'boom' } }] },
    }));
  });

  it('extracts messages', async () => {
    const { client } = await createTestClient(['graylog']);
    const out = parse(await client.callTool({ name: 'graylog_search', arguments: { query: '*' } }));
    expect(out.totalResults).toBe(2);
    expect(out.messages[0].message).toBe('boom');
  });
});

// ─── OPA ──────────────────────────────────────────────────────────────────

describe('opa', () => {
  beforeEach(() => {
    process.env.OPA_URL = 'http://opa-test:8181';
    vi.stubGlobal('fetch', mockFetch({
      '/v1/query': { result: [{ x: 'deny: not allowed' }] },
    }));
  });

  it('returns query bindings', async () => {
    const { client } = await createTestClient(['opa']);
    const out = parse(await client.callTool({ name: 'opa_query', arguments: { q: 'data.x.deny[x]' } }));
    expect(out.result).toHaveLength(1);
  });
});

// ─── Pipeline (Fluent Bit) ──────────────────────────────────────────────────

describe('pipeline', () => {
  beforeEach(() => {
    process.env.FLUENTBIT_URL = 'http://fluentbit-test:2020';
    vi.stubGlobal('fetch', mockFetch({
      '/api/v1/metrics': { input: { 'tail.0': { records: 10, bytes: 100 } }, output: { 'es.0': { proc_records: 8, errors: 1, retries: 2, dropped_records: 0 } } },
      '/api/v1/uptime': { uptime_sec: 123 },
    }));
  });

  it('curates Fluent Bit input/output metrics', async () => {
    const { client } = await createTestClient(['pipeline']);
    const out = parse(await client.callTool({ name: 'pipeline_fluentbit', arguments: {} }));
    expect(out.uptimeSec).toBe(123);
    expect(out.inputs[0]).toMatchObject({ name: 'tail.0', records: 10 });
    expect(out.outputs[0]).toMatchObject({ name: 'es.0', errors: 1, retries: 2 });
  });

  it('errors clearly when a pipeline agent is not configured', async () => {
    const { client } = await createTestClient(['pipeline']);
    const out = await client.callTool({ name: 'pipeline_beats', arguments: {} });
    expect(out.isError).toBe(true);
  });
});

// ─── Kong / Traefik / SkyWalking / Pinpoint (lighter behavioral) ─────────────

describe('kong', () => {
  beforeEach(() => {
    process.env.KONG_ADMIN_URL = 'http://kong-test:8001';
    vi.stubGlobal('fetch', mockFetch({
      '/services': { data: [{ name: 's1', host: 'h', port: 80, protocol: 'http', enabled: true }] },
    }));
  });

  it('lists services', async () => {
    const { client } = await createTestClient(['kong']);
    const out = parse(await client.callTool({ name: 'kong_services', arguments: {} }));
    expect(out.services[0]).toMatchObject({ name: 's1', host: 'h', port: 80 });
  });
});

describe('traefik', () => {
  beforeEach(() => {
    process.env.TRAEFIK_URL = 'http://traefik-test:8080';
    vi.stubGlobal('fetch', mockFetch({
      '/api/http/routers': [{ name: 'r1@docker', rule: 'Host(`x`)', service: 'svc1', status: 'enabled', entryPoints: ['web'], provider: 'docker' }],
    }));
  });

  it('lists routers', async () => {
    const { client } = await createTestClient(['traefik']);
    const out = parse(await client.callTool({ name: 'traefik_routers', arguments: {} }));
    expect(out.routers[0]).toMatchObject({ name: 'r1@docker', service: 'svc1', status: 'enabled' });
  });
});

describe('skywalking', () => {
  beforeEach(() => {
    process.env.SKYWALKING_URL = 'http://sw-test:12800';
    vi.stubGlobal('fetch', mockFetch({}));
  });

  it('is no longer registered as a standalone skill (now a traces provider)', async () => {
    const { client } = await createTestClient(['skywalking', 'system']);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith('skywalking_'))).toBe(false);
  });
});

describe('pinpoint', () => {
  beforeEach(() => {
    process.env.PINPOINT_URL = 'http://pinpoint-test:8080';
    vi.stubGlobal('fetch', mockFetch({
      '/api/applications': [{ applicationName: 'app', serviceType: 'TOMCAT', code: 1010 }],
    }));
  });

  it('lists applications', async () => {
    const { client } = await createTestClient(['pinpoint']);
    const out = parse(await client.callTool({ name: 'pinpoint_applications', arguments: {} }));
    expect(out.applications[0]).toMatchObject({ applicationName: 'app', serviceType: 'TOMCAT' });
  });

  it('rejects passthrough paths that do not start with /', async () => {
    const { client } = await createTestClient(['pinpoint']);
    const out = await client.callTool({ name: 'pinpoint_get', arguments: { path: 'api/x' } });
    expect(out.isError).toBe(true);
  });
});
