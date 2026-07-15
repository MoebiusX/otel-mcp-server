import { describe, it, expect } from 'vitest';
import {
  getJitMode,
  readJitConfig,
  looksLikeJitToken,
  jitPrincipal,
  JitError,
  JitTokenService,
  JIT_ROTATION_GRACE_MS,
  type JitConfig,
} from '../src/jit.js';

// ─── Test rig ────────────────────────────────────────────────────────────────

const BASE_CONFIG: JitConfig = {
  mode: 'enabled',
  ttlSeconds: 900,
  maxLifetimeSeconds: 3_600,
  maxActiveTokens: 5,
};

function rig(overrides: Partial<JitConfig> = {}) {
  const clock = { now: 1_000_000_000 };
  const service = new JitTokenService(
    { ...BASE_CONFIG, ...overrides },
    { now: () => clock.now },
  );
  return { clock, service };
}

const ISSUE_DEFAULTS = {
  parentKeyId: 'ci-agent',
  grantableScopes: ['traces', 'metrics', 'logs'] as string[] | null,
  enabledSkillIds: ['traces', 'metrics', 'logs', 'grafana'],
};

// ─── Config ──────────────────────────────────────────────────────────────────

describe('getJitMode / readJitConfig', () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k];

  it('defaults to off', () => {
    expect(getJitMode(env({}))).toBe('off');
  });

  it('parses enabled and required, case-insensitively', () => {
    expect(getJitMode(env({ MCP_JIT_MODE: 'enabled' }))).toBe('enabled');
    expect(getJitMode(env({ MCP_JIT_MODE: 'REQUIRED' }))).toBe('required');
  });

  it('falls back to off for unrecognized values', () => {
    expect(getJitMode(env({ MCP_JIT_MODE: 'yes-please' }))).toBe('off');
  });

  it('applies defaults', () => {
    const cfg = readJitConfig(env({}));
    expect(cfg).toEqual({
      mode: 'off',
      ttlSeconds: 900,
      maxLifetimeSeconds: 28_800,
      maxActiveTokens: 1_000,
    });
  });

  it('clamps TTL to [60, 3600] and lifetime to [ttl, 86400]', () => {
    const low = readJitConfig(env({ MCP_JIT_TTL_SECONDS: '5', MCP_JIT_MAX_LIFETIME_SECONDS: '10' }));
    expect(low.ttlSeconds).toBe(60);
    expect(low.maxLifetimeSeconds).toBe(60);

    const high = readJitConfig(env({ MCP_JIT_TTL_SECONDS: '99999', MCP_JIT_MAX_LIFETIME_SECONDS: '999999' }));
    expect(high.ttlSeconds).toBe(3_600);
    expect(high.maxLifetimeSeconds).toBe(86_400);
  });

  it('ignores garbage numbers', () => {
    const cfg = readJitConfig(env({ MCP_JIT_TTL_SECONDS: 'soon', MCP_JIT_MAX_ACTIVE_TOKENS: '-3' }));
    expect(cfg.ttlSeconds).toBe(900);
    expect(cfg.maxActiveTokens).toBe(1_000);
  });
});

// ─── Issuance ────────────────────────────────────────────────────────────────

describe('JitTokenService.issue', () => {
  it('mints a well-formed token and never stores the secret', () => {
    const { service } = rig();
    const { token, record } = service.issue(ISSUE_DEFAULTS);

    expect(token).toMatch(/^mcpj_[A-Za-z0-9_-]{8,24}\.[A-Za-z0-9_-]{32,64}$/);
    expect(looksLikeJitToken(token)).toBe(true);
    expect(record.tokenHash).not.toContain(token.split('.')[1]);
    expect(JSON.stringify(record)).not.toContain(token.split('.')[1]!);
    expect(record.generation).toBe(0);
    expect(record.rootId).toBe(record.id);
    expect(record.parentKeyId).toBe('ci-agent');
  });

  it('inherits the full grantable scope set by default', () => {
    const { service } = rig();
    const { record } = service.issue(ISSUE_DEFAULTS);
    expect(record.scopes).toEqual(['logs', 'metrics', 'traces']);
  });

  it('unrestricted parents (null grantable) default to all enabled skills', () => {
    const { service } = rig();
    const { record } = service.issue({ ...ISSUE_DEFAULTS, grantableScopes: null });
    expect(record.scopes).toEqual(['grafana', 'logs', 'metrics', 'traces']);
  });

  it('allows narrowing to a subset', () => {
    const { service } = rig();
    const { record } = service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['traces'] });
    expect(record.scopes).toEqual(['traces']);
  });

  it('rejects scope escalation beyond the parent key', () => {
    const { service } = rig();
    expect(() =>
      service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['traces', 'grafana'] }),
    ).toThrowError(JitError);
    try {
      service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['grafana'] });
      expect.unreachable('scope violation must throw');
    } catch (err) {
      expect((err as JitError).code).toBe('scope_violation');
      expect((err as JitError).status).toBe(403);
      expect((err as JitError).message).toContain('grafana');
    }
  });

  it('honours a shorter requested TTL but caps at the configured TTL', () => {
    const { clock, service } = rig();
    const short = service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 120 });
    expect(short.record.expiresAt).toBe(clock.now + 120_000);

    const greedy = service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 999_999 });
    expect(greedy.record.expiresAt).toBe(clock.now + 900_000);

    const tiny = service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 1 });
    expect(tiny.record.expiresAt).toBe(clock.now + 60_000); // floor 60s
  });

  it('caps the lineage at maxLifetimeSeconds', () => {
    const { clock, service } = rig();
    const { record } = service.issue(ISSUE_DEFAULTS);
    expect(record.notAfter).toBe(clock.now + 3_600_000);
  });

  it('enforces the active-token capacity', () => {
    const { service } = rig({ maxActiveTokens: 2 });
    service.issue(ISSUE_DEFAULTS);
    service.issue(ISSUE_DEFAULTS);
    try {
      service.issue(ISSUE_DEFAULTS);
      expect.unreachable('capacity must throw');
    } catch (err) {
      expect((err as JitError).code).toBe('capacity');
      expect((err as JitError).status).toBe(429);
    }
  });

  it('frees capacity when tokens expire', () => {
    const { clock, service } = rig({ maxActiveTokens: 1 });
    service.issue(ISSUE_DEFAULTS);
    clock.now += 900_001; // past expiry
    expect(() => service.issue(ISSUE_DEFAULTS)).not.toThrow();
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe('JitTokenService.validate', () => {
  it('round-trips a freshly minted token', () => {
    const { service } = rig();
    const { token, record } = service.issue(ISSUE_DEFAULTS);
    const v = service.validate(token);
    expect(v).toEqual({ ok: true, record });
  });

  it('rejects malformed strings', () => {
    const { service } = rig();
    expect(service.validate('nonsense')).toEqual({ ok: false, reason: 'malformed' });
    expect(service.validate('mcpj_short.x')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects unknown ids and tampered secrets', () => {
    const { service } = rig();
    const { token } = service.issue(ISSUE_DEFAULTS);
    const [head, secret] = token.split('.');
    const tampered = `${head}.${secret!.slice(0, -1)}${secret!.at(-1) === 'A' ? 'B' : 'A'}`;
    expect(service.validate(tampered)).toEqual({ ok: false, reason: 'unknown' });
    expect(service.validate(`mcpj_AAAAAAAAAAAA.${secret}`)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects expired tokens', () => {
    const { clock, service } = rig();
    const { token } = service.issue(ISSUE_DEFAULTS);
    clock.now += 900_000;
    expect(service.validate(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects revoked tokens', () => {
    const { service } = rig();
    const { token } = service.issue(ISSUE_DEFAULTS);
    service.revoke(token);
    expect(service.validate(token)).toEqual({ ok: false, reason: 'revoked' });
  });
});

// ─── Rotation ────────────────────────────────────────────────────────────────

describe('JitTokenService.refresh', () => {
  it('issues the next generation with the same scopes, lineage, and cap', () => {
    const { clock, service } = rig();
    const first = service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['traces'] });
    clock.now += 600_000;

    const second = service.refresh(first.token);
    expect(second.record.generation).toBe(1);
    expect(second.record.rootId).toBe(first.record.id);
    expect(second.record.scopes).toEqual(['traces']);
    expect(second.record.notAfter).toBe(first.record.notAfter);
    expect(second.record.parentKeyId).toBe('ci-agent');
    expect(service.validate(second.token).ok).toBe(true);
    expect(jitPrincipal(second.record)).toBe(jitPrincipal(first.record));
  });

  it('keeps the old token alive only for the grace window', () => {
    const { clock, service } = rig();
    const first = service.issue(ISSUE_DEFAULTS);
    clock.now += 60_000;
    service.refresh(first.token);

    expect(service.validate(first.token).ok).toBe(true); // within grace
    clock.now += JIT_ROTATION_GRACE_MS;
    expect(service.validate(first.token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('cannot extend past the lineage cap and eventually exhausts', () => {
    const { clock, service } = rig({ ttlSeconds: 900, maxLifetimeSeconds: 1_000 });
    const first = service.issue(ISSUE_DEFAULTS);

    clock.now += 900_000 - 1; // just before expiry
    const second = service.refresh(first.token);
    expect(second.record.expiresAt).toBe(first.record.notAfter); // clamped

    clock.now = first.record.notAfter;
    try {
      service.refresh(second.token);
      expect.unreachable('exhausted lineage must throw');
    } catch (err) {
      // At the cap the token is already expired — either way, no extension.
      expect(['lifetime_exhausted', 'expired']).toContain((err as JitError).code);
    }
  });

  it('rejects refresh of expired, revoked, or unknown tokens', () => {
    const { clock, service } = rig();
    const { token } = service.issue(ISSUE_DEFAULTS);
    clock.now += 900_000;
    expect(() => service.refresh(token)).toThrowError(/expired/);
    expect(() => service.refresh('mcpj_AAAAAAAAAAAA.' + 'B'.repeat(43))).toThrowError(/unknown/);
  });

  it('is exempt from the capacity limit', () => {
    const { service } = rig({ maxActiveTokens: 1 });
    const first = service.issue(ISSUE_DEFAULTS);
    expect(() => service.refresh(first.token)).not.toThrow();
  });

  it('rejects re-refreshing an already-rotated token (no lineage branching)', () => {
    const { service } = rig();
    const first = service.issue(ISSUE_DEFAULTS);
    service.refresh(first.token);
    try {
      service.refresh(first.token);
      expect.unreachable('re-refresh of a rotated token must throw');
    } catch (err) {
      expect((err as JitError).code).toBe('rotated');
      expect((err as JitError).status).toBe(409);
    }
  });

  it('bounds a lineage across a rapid refresh loop (no unbounded accumulation)', () => {
    // Regression: refresh() previously skipped the capacity guard AND left every
    // rotated token in the store for its grace window, so a refresh loop grew
    // the token map without bound. The lineage must stay at {current, 1 grace}.
    const { clock, service } = rig({ maxActiveTokens: 1000 });
    let token = service.issue(ISSUE_DEFAULTS).token;
    for (let i = 0; i < 200; i++) {
      clock.now += 1_000; // 1s between refreshes — grace corpses would pile up
      token = service.refresh(token).token;
    }
    // Only the current token + at most one in-grace predecessor remain live.
    expect(service.activeCount()).toBeLessThanOrEqual(2);
    // And the surviving token still works.
    expect(service.validate(token).ok).toBe(true);
  });

  it('bounds the lineage even when refreshed at a frozen clock', () => {
    const { service } = rig();
    let token = service.issue(ISSUE_DEFAULTS).token;
    for (let i = 0; i < 100; i++) token = service.refresh(token).token;
    expect(service.activeCount()).toBeLessThanOrEqual(2);
  });
});

// ─── Revocation & sweep ──────────────────────────────────────────────────────

describe('revocation and sweep', () => {
  it('self-revocation kills the token immediately', () => {
    const { service } = rig();
    const { token, record } = service.issue(ISSUE_DEFAULTS);
    const killed = service.revoke(token);
    expect(killed.id).toBe(record.id);
    expect(killed.revoked).toBe(true);
    expect(service.activeCount()).toBe(0);
  });

  it('admin revocation works by public id and is idempotent-ish', () => {
    const { service } = rig();
    const { record } = service.issue(ISSUE_DEFAULTS);
    expect(service.revokeById(record.id)?.revoked).toBe(true);
    expect(service.revokeById(record.id)?.revoked).toBe(true); // still resolvable until swept
    expect(service.revokeById('does-not-exist')).toBeUndefined();
  });

  it('sweep removes expired and revoked records, keeps live ones', () => {
    const { clock, service } = rig();
    const dead = service.issue(ISSUE_DEFAULTS);
    service.revoke(dead.token);
    const shortLived = service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 60 });
    const live = service.issue(ISSUE_DEFAULTS);

    clock.now += 61_000;
    expect(service.sweep()).toBe(2);
    expect(service.get(dead.record.id)).toBeUndefined();
    expect(service.get(shortLived.record.id)).toBeUndefined();
    expect(service.get(live.record.id)).toBeDefined();
    expect(service.activeCount()).toBe(1);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('looksLikeJitToken routes on the prefix only', () => {
    expect(looksLikeJitToken('mcpj_anything')).toBe(true);
    expect(looksLikeJitToken('sk-static-key')).toBe(false);
  });

  it('jitPrincipal is stable across rotation (rootId-based)', () => {
    const { service } = rig();
    const { record } = service.issue(ISSUE_DEFAULTS);
    expect(jitPrincipal(record)).toBe(`jit:${record.id}`);
  });
});
