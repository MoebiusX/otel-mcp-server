/**
 * Multi-backend registry & failover tests.
 *
 * Covers `splitUrls`, `BackendRegistry` instance resolution (default / named /
 * `MCP_BACKENDS` precedence / SSRF-safe target matching) and the failover
 * behaviour of `createFailoverFetcher`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendRegistry, splitUrls, type SkillBackendSpec } from '../src/backends.js';
import { createFailoverFetcher } from '../src/helpers.js';

const SPEC: SkillBackendSpec = {
  skillId: 'metrics',
  baseEnvVar: 'PROMETHEUS_URL',
  prefix: 'PROMETHEUS',
  defaultUrl: 'http://localhost:9090',
};

// ─── splitUrls ────────────────────────────────────────────────────────────────

describe('splitUrls', () => {
  it('returns [] for empty / undefined', () => {
    expect(splitUrls(undefined)).toEqual([]);
    expect(splitUrls('')).toEqual([]);
    expect(splitUrls('   ')).toEqual([]);
  });

  it('parses a single URL', () => {
    expect(splitUrls('http://a:9090')).toEqual(['http://a:9090']);
  });

  it('parses a comma-separated list, trimming blanks', () => {
    expect(splitUrls('http://a:9090, http://b:9090 ,'))
      .toEqual(['http://a:9090', 'http://b:9090']);
  });

  it('parses a JSON array', () => {
    expect(splitUrls('["http://a:9090","http://b:9090"]'))
      .toEqual(['http://a:9090', 'http://b:9090']);
  });

  it('falls back to comma-split on malformed JSON array', () => {
    expect(splitUrls('[http://a:9090')).toEqual(['[http://a:9090']);
  });
});

// ─── BackendRegistry ──────────────────────────────────────────────────────────

describe('BackendRegistry', () => {
  it('yields a single default instance from the base env var', () => {
    const reg = new BackendRegistry({ PROMETHEUS_URL: 'http://prom:9090' });
    const all = reg.instancesFor(SPEC);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      instance: 'default',
      urls: ['http://prom:9090'],
      authPrefix: 'PROMETHEUS',
    });
  });

  it('falls back to the spec defaultUrl when no env var is set', () => {
    const reg = new BackendRegistry({});
    expect(reg.names(SPEC)).toEqual(['default']);
    expect(reg.instancesFor(SPEC)[0]!.urls).toEqual(['http://localhost:9090']);
  });

  it('omits the default instance when no URL and no spec default', () => {
    const noDefault: SkillBackendSpec = {
      skillId: 'elasticsearch',
      baseEnvVar: 'ELASTICSEARCH_URL',
      prefix: 'ELASTICSEARCH',
    };
    const reg = new BackendRegistry({});
    expect(reg.names(noDefault)).toEqual([]);
  });

  it('discovers named instances via the `__<NAME>` suffix', () => {
    const reg = new BackendRegistry({
      PROMETHEUS_URL: 'http://prom:9090',
      PROMETHEUS_URL__PROD: 'http://prom-prod:9090',
    });
    const all = reg.instancesFor(SPEC);
    expect(all.map((i) => i.instance)).toEqual(['default', 'PROD']);
    const prod = all.find((i) => i.instance === 'PROD')!;
    expect(prod.urls).toEqual(['http://prom-prod:9090']);
    expect(prod.authPrefix).toBe('PROMETHEUS__PROD');
  });

  it('parses failover URL lists on named instances', () => {
    const reg = new BackendRegistry({
      PROMETHEUS_URL__HA: 'http://a:9090,http://b:9090',
    });
    const ha = reg.instancesFor(SPEC).find((i) => i.instance === 'HA')!;
    expect(ha.urls).toEqual(['http://a:9090', 'http://b:9090']);
  });

  it('orders the default instance first', () => {
    const reg = new BackendRegistry({
      PROMETHEUS_URL__PROD: 'http://prod:9090',
      PROMETHEUS_URL: 'http://prom:9090',
    });
    expect(reg.names(SPEC)[0]).toBe('default');
  });

  it('applies MCP_BACKENDS entries with highest precedence', () => {
    const reg = new BackendRegistry({
      PROMETHEUS_URL__PROD: 'http://from-env:9090',
      MCP_BACKENDS: JSON.stringify([
        {
          skill: 'metrics',
          instance: 'PROD',
          urls: ['http://a', 'http://b'],
          authPrefix: 'PROM_PROD',
          product: 'Grafana Mimir',
          extraHeaders: { 'X-Scope-OrgID': 'team-a' },
        },
      ]),
    });
    const prod = reg.instancesFor(SPEC).find((i) => i.instance === 'PROD')!;
    expect(prod.urls).toEqual(['http://a', 'http://b']);
    expect(prod.authPrefix).toBe('PROM_PROD');
    expect(prod.product).toBe('Grafana Mimir');
    expect(prod.extraHeaders).toEqual({ 'X-Scope-OrgID': 'team-a' });
  });

  it('ignores MCP_BACKENDS entries for other skills', () => {
    const reg = new BackendRegistry({
      PROMETHEUS_URL: 'http://prom:9090',
      MCP_BACKENDS: JSON.stringify([
        { skill: 'logs', instance: 'PROD', urls: ['http://loki'] },
      ]),
    });
    expect(reg.names(SPEC)).toEqual(['default']);
  });

  it('treats malformed MCP_BACKENDS as a no-op', () => {
    const reg = new BackendRegistry({
      PROMETHEUS_URL: 'http://prom:9090',
      MCP_BACKENDS: '{not json',
    });
    expect(reg.names(SPEC)).toEqual(['default']);
  });

  describe('resolve', () => {
    const reg = new BackendRegistry({
      PROMETHEUS_URL: 'http://prom:9090',
      PROMETHEUS_URL__PROD: 'http://prom-prod:9090',
    });

    it('returns the primary (default) when no target given', () => {
      expect(reg.resolve(SPEC)!.instance).toBe('default');
    });

    it('returns a matching named target', () => {
      expect(reg.resolve(SPEC, 'PROD')!.instance).toBe('PROD');
    });

    it('returns undefined for an unknown target (SSRF-safe)', () => {
      expect(reg.resolve(SPEC, 'http://evil')).toBeUndefined();
      expect(reg.resolve(SPEC, 'NOPE')).toBeUndefined();
    });
  });
});

// ─── createFailoverFetcher ─────────────────────────────────────────────────────

describe('createFailoverFetcher', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bases = ['http://a:9090', 'http://b:9090'];

  it('returns the primary response when it succeeds', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ from: 'a' }) });
    const f = createFailoverFetcher(5_000, {}, bases);
    const res = await f('http://a:9090/api/v1/query');
    expect(res).toEqual({ from: 'a' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('fails over to the next base on a 5xx, rewriting the URL prefix', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ from: 'b' }) });

    const f = createFailoverFetcher(5_000, {}, bases);
    const res = await f('http://a:9090/api/v1/query');
    expect(res).toEqual({ from: 'b' });
    expect((fetch as any).mock.calls[0][0]).toBe('http://a:9090/api/v1/query');
    expect((fetch as any).mock.calls[1][0]).toBe('http://b:9090/api/v1/query');
  });

  it('does NOT fail over on a 4xx', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' });
    const f = createFailoverFetcher(5_000, {}, bases);
    await expect(f('http://a:9090/api/v1/query')).rejects.toThrow('HTTP 400');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('throws the last error when every base fails', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway' });
    const f = createFailoverFetcher(5_000, {}, bases);
    await expect(f('http://a:9090/api/v1/query')).rejects.toThrow('HTTP 502');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
