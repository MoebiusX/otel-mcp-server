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

async function expectJitError(
  promise: Promise<unknown>,
  code: string,
  status?: number,
): Promise<JitError> {
  try {
    await promise;
    expect.unreachable(`expected JitError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(JitError);
    expect((err as JitError).code).toBe(code);
    if (status !== undefined) expect((err as JitError).status).toBe(status);
    return err as JitError;
  }
  throw new Error('unreachable');
}

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
  it('mints a well-formed token and never stores the secret', async () => {
    const { service } = rig();
    const { token, record } = await service.issue(ISSUE_DEFAULTS);

    expect(token).toMatch(/^mcpj_[A-Za-z0-9_-]{8,24}\.[A-Za-z0-9_-]{32,64}$/);
    expect(looksLikeJitToken(token)).toBe(true);
    expect(record.tokenHash).not.toContain(token.split('.')[1]);
    expect(JSON.stringify(record)).not.toContain(token.split('.')[1]!);
    expect(record.generation).toBe(0);
    expect(record.rootId).toBe(record.id);
    expect(record.parentKeyId).toBe('ci-agent');
  });

  it('inherits the full grantable scope set by default', async () => {
    const { service } = rig();
    const { record } = await service.issue(ISSUE_DEFAULTS);
    expect(record.scopes).toEqual(['logs', 'metrics', 'traces']);
  });

  it('unrestricted parents (null grantable) default to all enabled skills', async () => {
    const { service } = rig();
    const { record } = await service.issue({ ...ISSUE_DEFAULTS, grantableScopes: null });
    expect(record.scopes).toEqual(['grafana', 'logs', 'metrics', 'traces']);
  });

  it('allows narrowing to a subset', async () => {
    const { service } = rig();
    const { record } = await service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['traces'] });
    expect(record.scopes).toEqual(['traces']);
  });

  it('rejects scope escalation beyond the parent key', async () => {
    const { service } = rig();
    await expectJitError(
      service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['traces', 'grafana'] }),
      'scope_violation',
    );
    const err = await expectJitError(
      service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['grafana'] }),
      'scope_violation',
      403,
    );
    expect(err.message).toContain('grafana');
  });

  it('honours a shorter requested TTL but caps at the configured TTL', async () => {
    const { clock, service } = rig();
    const short = await service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 120 });
    expect(short.record.expiresAt).toBe(clock.now + 120_000);

    const greedy = await service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 999_999 });
    expect(greedy.record.expiresAt).toBe(clock.now + 900_000);

    const tiny = await service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 1 });
    expect(tiny.record.expiresAt).toBe(clock.now + 60_000); // floor 60s
  });

  it('caps the lineage at maxLifetimeSeconds', async () => {
    const { clock, service } = rig();
    const { record } = await service.issue(ISSUE_DEFAULTS);
    expect(record.notAfter).toBe(clock.now + 3_600_000);
  });

  it('enforces the active-token capacity', async () => {
    const { service } = rig({ maxActiveTokens: 2 });
    await service.issue(ISSUE_DEFAULTS);
    await service.issue(ISSUE_DEFAULTS);
    await expectJitError(service.issue(ISSUE_DEFAULTS), 'capacity', 429);
  });

  it('frees capacity when tokens expire', async () => {
    const { clock, service } = rig({ maxActiveTokens: 1 });
    await service.issue(ISSUE_DEFAULTS);
    clock.now += 900_001; // past expiry
    await expect(service.issue(ISSUE_DEFAULTS)).resolves.toBeDefined();
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe('JitTokenService.validate', () => {
  it('round-trips a freshly minted token', async () => {
    const { service } = rig();
    const { token, record } = await service.issue(ISSUE_DEFAULTS);
    const v = await service.validate(token);
    expect(v).toEqual({ ok: true, record });
  });

  it('rejects malformed strings', async () => {
    const { service } = rig();
    expect(await service.validate('nonsense')).toEqual({ ok: false, reason: 'malformed' });
    expect(await service.validate('mcpj_short.x')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects unknown ids and tampered secrets', async () => {
    const { service } = rig();
    const { token } = await service.issue(ISSUE_DEFAULTS);
    const [head, secret] = token.split('.');
    const tampered = `${head}.${secret!.slice(0, -1)}${secret!.at(-1) === 'A' ? 'B' : 'A'}`;
    expect(await service.validate(tampered)).toEqual({ ok: false, reason: 'unknown' });
    expect(await service.validate(`mcpj_AAAAAAAAAAAA.${secret}`)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects expired tokens', async () => {
    const { clock, service } = rig();
    const { token } = await service.issue(ISSUE_DEFAULTS);
    clock.now += 900_000;
    expect(await service.validate(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects revoked tokens', async () => {
    const { service } = rig();
    const { token } = await service.issue(ISSUE_DEFAULTS);
    await service.revoke(token);
    expect(await service.validate(token)).toEqual({ ok: false, reason: 'revoked' });
  });
});

// ─── Rotation ────────────────────────────────────────────────────────────────

describe('JitTokenService.refresh', () => {
  it('issues the next generation with the same scopes, lineage, and cap', async () => {
    const { clock, service } = rig();
    const first = await service.issue({ ...ISSUE_DEFAULTS, requestedScopes: ['traces'] });
    clock.now += 600_000;

    const second = await service.refresh(first.token);
    expect(second.record.generation).toBe(1);
    expect(second.record.rootId).toBe(first.record.id);
    expect(second.record.scopes).toEqual(['traces']);
    expect(second.record.notAfter).toBe(first.record.notAfter);
    expect(second.record.parentKeyId).toBe('ci-agent');
    expect((await service.validate(second.token)).ok).toBe(true);
    expect(jitPrincipal(second.record)).toBe(jitPrincipal(first.record));
  });

  it('keeps the old token alive only for the grace window', async () => {
    const { clock, service } = rig();
    const first = await service.issue(ISSUE_DEFAULTS);
    clock.now += 60_000;
    await service.refresh(first.token);

    expect((await service.validate(first.token)).ok).toBe(true); // within grace
    clock.now += JIT_ROTATION_GRACE_MS;
    expect(await service.validate(first.token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('cannot extend past the lineage cap and eventually exhausts', async () => {
    const { clock, service } = rig({ ttlSeconds: 900, maxLifetimeSeconds: 1_000 });
    const first = await service.issue(ISSUE_DEFAULTS);

    clock.now += 900_000 - 1; // just before expiry
    const second = await service.refresh(first.token);
    expect(second.record.expiresAt).toBe(first.record.notAfter); // clamped

    clock.now = first.record.notAfter;
    try {
      await service.refresh(second.token);
      expect.unreachable('exhausted lineage must throw');
    } catch (err) {
      // At the cap the token is already expired — either way, no extension.
      expect(['lifetime_exhausted', 'expired']).toContain((err as JitError).code);
    }
  });

  it('rejects refresh of expired, revoked, or unknown tokens', async () => {
    const { clock, service } = rig();
    const { token } = await service.issue(ISSUE_DEFAULTS);
    clock.now += 900_000;
    await expect(service.refresh(token)).rejects.toThrowError(/expired/);
    await expect(service.refresh('mcpj_AAAAAAAAAAAA.' + 'B'.repeat(43))).rejects.toThrowError(/unknown/);
  });

  it('is exempt from the capacity limit', async () => {
    const { service } = rig({ maxActiveTokens: 1 });
    const first = await service.issue(ISSUE_DEFAULTS);
    await expect(service.refresh(first.token)).resolves.toBeDefined();
  });

  it('rejects re-refreshing an already-rotated token (no lineage branching)', async () => {
    const { service } = rig();
    const first = await service.issue(ISSUE_DEFAULTS);
    await service.refresh(first.token);
    await expectJitError(service.refresh(first.token), 'rotated', 409);
  });

  it('bounds a lineage across a rapid refresh loop (no unbounded accumulation)', async () => {
    // Regression: refresh() previously skipped the capacity guard AND left every
    // rotated token in the store for its grace window, so a refresh loop grew
    // the token map without bound. The lineage must stay at {current, 1 grace}.
    const { clock, service } = rig({ maxActiveTokens: 1000 });
    let token = (await service.issue(ISSUE_DEFAULTS)).token;
    for (let i = 0; i < 200; i++) {
      clock.now += 1_000; // 1s between refreshes — grace corpses would pile up
      token = (await service.refresh(token)).token;
    }
    // Only the current token + at most one in-grace predecessor remain live.
    expect(await service.activeCount()).toBeLessThanOrEqual(2);
    // And the surviving token still works.
    expect((await service.validate(token)).ok).toBe(true);
  });

  it('bounds the lineage even when refreshed at a frozen clock', async () => {
    const { service } = rig();
    let token = (await service.issue(ISSUE_DEFAULTS)).token;
    for (let i = 0; i < 100; i++) token = (await service.refresh(token)).token;
    expect(await service.activeCount()).toBeLessThanOrEqual(2);
  });
});

// ─── Revocation & sweep ──────────────────────────────────────────────────────

describe('revocation and sweep', () => {
  it('self-revocation kills the token immediately', async () => {
    const { service } = rig();
    const { token, record } = await service.issue(ISSUE_DEFAULTS);
    const killed = await service.revoke(token);
    expect(killed.id).toBe(record.id);
    expect(killed.revoked).toBe(true);
    expect(await service.activeCount()).toBe(0);
  });

  it('admin revocation works by public id and is idempotent-ish', async () => {
    const { service } = rig();
    const { record } = await service.issue(ISSUE_DEFAULTS);
    expect((await service.revokeById(record.id))?.revoked).toBe(true);
    expect((await service.revokeById(record.id))?.revoked).toBe(true); // still resolvable until swept
    expect(await service.revokeById('does-not-exist')).toBeUndefined();
  });

  it('lineage revocation kills the current and in-grace generations', async () => {
    const { clock, service } = rig();
    const first = await service.issue(ISSUE_DEFAULTS);
    clock.now += 60_000;
    const second = await service.refresh(first.token); // first is in grace, second live

    const killed = await service.revokeLineage(first.record.id);
    const killedIds = killed.map((r) => r.id).sort();
    expect(killedIds).toEqual([first.record.id, second.record.id].sort());
    expect(await service.validate(second.token)).toEqual({ ok: false, reason: 'revoked' });
    expect(await service.activeCount()).toBe(0);
    // Unknown lineage → empty result, not an error.
    expect(await service.revokeLineage('nope')).toEqual([]);
  });

  it('sweep removes expired and revoked records, keeps live ones', async () => {
    const { clock, service } = rig();
    const dead = await service.issue(ISSUE_DEFAULTS);
    await service.revoke(dead.token);
    const shortLived = await service.issue({ ...ISSUE_DEFAULTS, requestedTtlSeconds: 60 });
    const live = await service.issue(ISSUE_DEFAULTS);

    clock.now += 61_000;
    expect(await service.sweep()).toBe(2);
    expect(await service.get(dead.record.id)).toBeUndefined();
    expect(await service.get(shortLived.record.id)).toBeUndefined();
    expect(await service.get(live.record.id)).toBeDefined();
    expect(await service.activeCount()).toBe(1);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('looksLikeJitToken routes on the prefix only', () => {
    expect(looksLikeJitToken('mcpj_anything')).toBe(true);
    expect(looksLikeJitToken('sk-static-key')).toBe(false);
  });

  it('jitPrincipal is stable across rotation (rootId-based)', async () => {
    const { service } = rig();
    const { record } = await service.issue(ISSUE_DEFAULTS);
    expect(jitPrincipal(record)).toBe(`jit:${record.id}`);
  });
});
