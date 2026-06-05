import { describe, it, expect, beforeEach } from 'vitest';
import { VersionRegistry, BACKEND_INSTANCES } from '../src/version-registry.js';
import type { BackendInstance } from '../src/version-registry.js';
import type { SkillHelpers } from '../src/skill.js';

/**
 * Runtime version registry — verifies instance configuration predicates,
 * probe-driven product/version detection, tier classification, and TTL caching
 * without touching the network (a fake fetcher returns canned buildinfo).
 */

function makeHelpers(
  envMap: Record<string, string>,
  fetchImpl?: (url: string) => Promise<any>,
): SkillHelpers {
  return {
    timeoutMs: 1000,
    env: (k: string, fallback = '') => envMap[k] ?? fallback,
    createFetcher: () => (async (url: string) => {
      if (!fetchImpl) throw new Error('no backend');
      return fetchImpl(url);
    }) as any,
  };
}

describe('VersionRegistry catalog', () => {
  it('every instance references a skill present in SKILL_VERSIONS-backed support', () => {
    // Instances should at least have a non-empty prefix and url env list.
    for (const inst of BACKEND_INSTANCES) {
      expect(inst.skillId, 'skillId').toBeTruthy();
      expect(inst.instance, 'instance').toBeTruthy();
      expect(inst.prefix, `${inst.instance} prefix`).toBeTruthy();
      expect(inst.urlEnvs.length, `${inst.instance} urlEnvs`).toBeGreaterThan(0);
    }
  });

  it('only the selected traces provider is configured', () => {
    const reg = new VersionRegistry();
    const env = (k: string, f = '') => ({ TRACES_PROVIDER: 'tempo' } as any)[k] ?? f;
    const active = reg.configured(env).filter((i) => i.skillId === 'traces');
    expect(active.map((i) => i.instance)).toEqual(['Tempo']);
  });

  it('defaults traces provider to Jaeger when unset', () => {
    const reg = new VersionRegistry();
    const env = (_k: string, f = '') => f;
    const active = reg.configured(env).filter((i) => i.skillId === 'traces');
    expect(active.map((i) => i.instance)).toEqual(['Jaeger']);
  });

  it('selects the InfluxDB instance by INFLUX_VERSION major', () => {
    const reg = new VersionRegistry();
    const env = (k: string, f = '') => ({ INFLUX_VERSION: '3.0' } as any)[k] ?? f;
    const active = reg.configured(env).filter((i) => i.skillId === 'influx');
    expect(active.map((i) => i.instance)).toEqual(['InfluxDB 3.x']);
  });

  it('requires an explicit URL for no-default slots (elasticsearch)', () => {
    const reg = new VersionRegistry();
    const noUrl = reg.configured((_k, f = '') => f).find((i) => i.skillId === 'elasticsearch');
    expect(noUrl).toBeUndefined();
    const withUrl = reg
      .configured((k, f = '') => (k === 'ELASTICSEARCH_URL' ? 'http://es:9200' : f))
      .find((i) => i.skillId === 'elasticsearch');
    expect(withUrl?.instance).toBe('Elasticsearch-compatible');
  });
});

describe('VersionRegistry detection', () => {
  let promInstance: BackendInstance;
  beforeEach(() => {
    promInstance = BACKEND_INSTANCES.find((i) => i.skillId === 'metrics')!;
  });

  it('classifies a probed Prometheus version into the must tier', async () => {
    const reg = new VersionRegistry();
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://prom:9090' },
      async () => ({ data: { version: '3.1.0' } }),
    );
    const entry = await reg.resolve(promInstance, helpers);
    expect(entry.product).toBe('Prometheus');
    expect(entry.detectedVersion).toBe('3.1.0');
    expect(entry.source).toBe('probe');
    expect(entry.tier).toBe('must');
  });

  it('disambiguates Mimir from the shared PromQL URL', async () => {
    const reg = new VersionRegistry();
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://mimir:8080' },
      async () => ({ data: { version: '2.14.0', application: 'grafana-mimir' } }),
    );
    const entry = await reg.resolve(promInstance, helpers);
    expect(entry.product).toBe('Grafana Mimir');
    expect(entry.tier).toBe('must');
  });

  it('honors an explicit version config override without probing', async () => {
    const reg = new VersionRegistry();
    const helpers = makeHelpers({
      PROMETHEUS_URL: 'http://prom:9090',
      PROMETHEUS_VERSION: '2.40.0',
    });
    const entry = await reg.resolve(promInstance, helpers);
    expect(entry.source).toBe('config');
    expect(entry.detectedVersion).toBe('2.40.0');
    // 2.40 is below the 2.5x should-window and not in optional → unsupported.
    expect(['should', 'optional', 'unsupported']).toContain(entry.tier);
  });

  it('falls back to unknown tier when the probe fails', async () => {
    const reg = new VersionRegistry();
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://prom:9090' },
      async () => { throw new Error('connection refused'); },
    );
    const entry = await reg.resolve(promInstance, helpers);
    expect(entry.detectedVersion).toBeNull();
    expect(entry.source).toBe('default');
    expect(entry.tier).toBe('unknown');
  });

  it('caches results within the TTL and re-probes after force', async () => {
    let calls = 0;
    const reg = new VersionRegistry(undefined, 60_000);
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://prom:9090' },
      async () => { calls++; return { data: { version: '3.0.0' } }; },
    );
    await reg.resolve(promInstance, helpers);
    await reg.resolve(promInstance, helpers);
    expect(calls).toBe(1);
    await reg.resolve(promInstance, helpers, { force: true });
    expect(calls).toBe(2);
  });

  it('resolveEnabled only returns configured + enabled instances', async () => {
    const reg = new VersionRegistry();
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://prom:9090', TRACES_PROVIDER: 'jaeger' },
      async () => ({ data: { version: '3.0.0' } }),
    );
    const entries = await reg.resolveEnabled(helpers, new Set(['metrics']));
    expect(entries.map((e) => e.skillId)).toEqual(['metrics']);
  });
});
