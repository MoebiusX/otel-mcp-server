/**
 * Tests for the capability-gating engine (src/gating.ts).
 *
 * Covers mode resolution, pure feature evaluation, policy application
 * (off/warn/enforce + optimistic unknown handling), and the live,
 * registry-backed `requireFeature` guard.
 */

import { describe, it, expect } from 'vitest';
import {
  getGatingMode,
  evaluateFeature,
  applyGating,
  requireFeature,
  type GateDecision,
} from '../src/gating.js';
import { VersionRegistry, type BackendInstance } from '../src/version-registry.js';
import type { SkillHelpers } from '../src/skill.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeHelpers(
  envMap: Record<string, string>,
  fetchImpl?: (url: string) => Promise<any>,
): SkillHelpers {
  return {
    timeoutMs: 1000,
    env: (k: string, fallback = '') => envMap[k] ?? fallback,
    createFetcher: () => async (url: string) => {
      if (!fetchImpl) throw new Error('no fetch');
      return fetchImpl(url);
    },
  };
}

// ─── getGatingMode ───────────────────────────────────────────────────────────

describe('getGatingMode', () => {
  it('defaults to warn', () => {
    expect(getGatingMode(() => '')).toBe('warn');
  });

  it('reads off and enforce (case-insensitive, trimmed)', () => {
    expect(getGatingMode((k) => (k === 'MCP_VERSION_GATING' ? '  OFF ' : ''))).toBe('off');
    expect(getGatingMode((k) => (k === 'MCP_VERSION_GATING' ? 'Enforce' : ''))).toBe('enforce');
  });

  it('falls back to warn for unrecognized values', () => {
    expect(getGatingMode((k) => (k === 'MCP_VERSION_GATING' ? 'strict' : ''))).toBe('warn');
  });
});

// ─── evaluateFeature ─────────────────────────────────────────────────────────

describe('evaluateFeature', () => {
  it('treats baseline features as always available', () => {
    // `rate` is a promql baseline feature on the metrics skill.
    const d = evaluateFeature('metrics', 'rate', '2.40.0', 'Prometheus');
    expect(d.gate).toEqual({ available: true, reason: 'baseline' });
  });

  it('gates a versioned feature below its minimum', () => {
    const d = evaluateFeature('metrics', 'native_histograms', '2.40.0', 'Prometheus');
    expect(d.gate).toEqual({ available: false, reason: 'below-min', since: '3.0' });
  });

  it('allows a versioned feature at/above its minimum', () => {
    const d = evaluateFeature('metrics', 'native_histograms', '3.1.0', 'Prometheus');
    expect(d.gate).toEqual({ available: true, reason: 'versioned' });
  });

  it('uses per-product since maps (Mimir native_histograms since 2.10)', () => {
    const d = evaluateFeature('metrics', 'native_histograms', '2.12.0', 'Grafana Mimir');
    expect(d.gate).toEqual({ available: true, reason: 'versioned' });
  });

  it('reports unknown when version is undetected', () => {
    const d = evaluateFeature('metrics', 'native_histograms', null, 'Prometheus');
    expect(d.gate.available).toBe('unknown');
  });

  it('reports not-in-protocol for unmodeled skills/features', () => {
    expect(evaluateFeature('nope', 'whatever', '1.0.0').gate).toEqual({
      available: false,
      reason: 'not-in-protocol',
    });
  });
});

// ─── applyGating ─────────────────────────────────────────────────────────────

function decision(gate: GateDecision['gate'], extra: Partial<GateDecision> = {}): GateDecision {
  return {
    skillId: 'metrics',
    feature: 'native_histograms',
    product: 'Prometheus',
    detectedVersion: '2.40.0',
    gate,
    ...extra,
  };
}

describe('applyGating', () => {
  it('off mode never gates', () => {
    const r = applyGating(decision({ available: false, reason: 'below-min', since: '3.0' }), 'off');
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.warning).toBeUndefined();
  });

  it('available features proceed silently', () => {
    const r = applyGating(decision({ available: true, reason: 'versioned' }), 'enforce');
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it('warn mode warns but proceeds for below-min', () => {
    const r = applyGating(decision({ available: false, reason: 'below-min', since: '3.0' }), 'warn');
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.warning).toMatch(/requires Prometheus ≥ 3\.0/);
  });

  it('enforce mode blocks below-min with an error', () => {
    const r = applyGating(decision({ available: false, reason: 'below-min', since: '3.0' }), 'enforce');
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.error).toMatch(/Unsupported/);
  });

  it('unknown version passes optimistically with a warning even under enforce', () => {
    const r = applyGating(
      decision({ available: 'unknown', reason: 'version-undetected', since: '3.0' }, {
        detectedVersion: null,
      }),
      'enforce',
    );
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.warning).toMatch(/could not be detected/);
  });

  it('does not gate features it does not model', () => {
    const r = applyGating(decision({ available: false, reason: 'not-in-protocol' }), 'enforce');
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
  });
});

// ─── requireFeature (live, registry-backed) ──────────────────────────────────

const promInstance: BackendInstance = {
  skillId: 'metrics',
  instance: 'Prometheus-compatible',
  protocol: 'promql',
  prefix: 'PROMETHEUS',
  urlEnvs: ['PROMETHEUS_URL'],
  urlDefault: 'http://localhost:9090',
  isConfigured: () => true,
};

function buildinfo(version: string) {
  return async (url: string) => {
    if (url.includes('buildinfo')) {
      return { data: { version, application: 'prometheus' } };
    }
    throw new Error('not found');
  };
}

describe('requireFeature', () => {
  it('off mode short-circuits to proceed', async () => {
    const reg = new VersionRegistry([promInstance]);
    const r = await requireFeature('metrics', 'native_histograms', makeHelpers({ MCP_VERSION_GATING: 'off' }), {
      registry: reg,
    });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it('enforce blocks when the probed version is too old', async () => {
    const reg = new VersionRegistry([promInstance]);
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://prom:9090', MCP_VERSION_GATING: 'enforce' },
      buildinfo('2.40.0'),
    );
    const r = await requireFeature('metrics', 'native_histograms', helpers, { registry: reg });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.error).toMatch(/3\.0/);
  });

  it('enforce allows when the probed version is new enough', async () => {
    const reg = new VersionRegistry([promInstance]);
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://prom:9090', MCP_VERSION_GATING: 'enforce' },
      buildinfo('3.2.0'),
    );
    const r = await requireFeature('metrics', 'native_histograms', helpers, { registry: reg });
    expect(r.ok).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('warns optimistically when probing fails (unknown version)', async () => {
    const reg = new VersionRegistry([promInstance]);
    const helpers = makeHelpers(
      { PROMETHEUS_URL: 'http://prom:9090', MCP_VERSION_GATING: 'enforce' },
      async () => {
        throw new Error('connection refused');
      },
    );
    const r = await requireFeature('metrics', 'native_histograms', helpers, { registry: reg });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/could not be detected/);
  });

  it('evaluates declaratively when nothing is configured', async () => {
    const reg = new VersionRegistry([]); // no instances
    const r = await requireFeature('metrics', 'native_histograms', makeHelpers({}), { registry: reg });
    expect(r.ok).toBe(true); // unknown version → optimistic
    expect(r.warning).toMatch(/could not be detected/);
  });
});
