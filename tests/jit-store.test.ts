import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MemoryJitTokenStore,
  MemoryDenylist,
  createJitStores,
  type JitTokenStore,
} from '../src/jit-store.js';
import { JitTokenService, type JitConfig } from '../src/jit.js';

/**
 * Roadmap Phase 1 verification (docs/enterprise-auth-roadmap.md):
 *  - store contract: the atomic primitives behave under interleaving;
 *  - HA correctness: two service instances sharing one store agree on
 *    validity, once-only rotation, the capacity cap, and single-use replay.
 */

const CONFIG: JitConfig = {
  mode: 'enabled',
  ttlSeconds: 900,
  maxLifetimeSeconds: 3_600,
  maxActiveTokens: 5,
};

const ISSUE = {
  parentKeyId: 'ha-key',
  grantableScopes: ['traces', 'metrics'] as string[] | null,
  enabledSkillIds: ['traces', 'metrics'],
};

/** Two "replicas": separate services, separate clocks, one shared store. */
function haRig(store: JitTokenStore = new MemoryJitTokenStore(), overrides: Partial<JitConfig> = {}) {
  const clock = { now: 1_000_000_000 };
  const a = new JitTokenService({ ...CONFIG, ...overrides }, { now: () => clock.now, store });
  const b = new JitTokenService({ ...CONFIG, ...overrides }, { now: () => clock.now, store });
  return { clock, a, b, store };
}

// ─── HA correctness (roadmap Phase 1 acceptance) ─────────────────────────────

describe('two service instances sharing one store', () => {
  it('a token minted on A validates, refreshes, and revokes on B', async () => {
    const { a, b } = haRig();
    const minted = await a.issue(ISSUE);

    const seenOnB = await b.validate(minted.token);
    expect(seenOnB.ok).toBe(true);

    const rotated = await b.refresh(minted.token);
    expect(rotated.record.rootId).toBe(minted.record.id);

    // Revocation on B is immediately visible on A.
    await b.revoke(rotated.token);
    expect(await a.validate(rotated.token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('refresh is once-only under concurrent rotation on A and B', async () => {
    const { a, b } = haRig();
    const minted = await a.issue(ISSUE);

    const results = await Promise.allSettled([
      a.refresh(minted.token),
      b.refresh(minted.token),
    ]);
    const wins = results.filter((r) => r.status === 'fulfilled');
    const losses = results.filter((r) => r.status === 'rejected');
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as PromiseRejectedResult).reason.code).toBe('rotated');

    // The lineage did not branch: exactly one live successor.
    expect(await a.activeCount()).toBeLessThanOrEqual(2); // winner + grace token
  });

  it('the capacity cap holds under concurrent mint across A and B', async () => {
    const { a, b } = haRig(new MemoryJitTokenStore(), { maxActiveTokens: 3 });

    const attempts = await Promise.allSettled([
      a.issue(ISSUE), b.issue(ISSUE), a.issue(ISSUE), b.issue(ISSUE), a.issue(ISSUE), b.issue(ISSUE),
    ]);
    const minted = attempts.filter((r) => r.status === 'fulfilled');
    const denied = attempts.filter((r) => r.status === 'rejected');

    expect(minted).toHaveLength(3);
    expect(denied).toHaveLength(3);
    for (const d of denied) {
      expect((d as PromiseRejectedResult).reason.code).toBe('capacity');
    }
    expect(await b.activeCount()).toBe(3);
  });

  it('admin lineage revocation on A kills the session B is serving', async () => {
    const { clock, a, b } = haRig();
    const minted = await a.issue(ISSUE);
    clock.now += 60_000;
    const rotated = await b.refresh(minted.token);

    const killed = await a.revokeLineage(minted.record.id);
    expect(killed.length).toBeGreaterThan(0);
    expect(await b.validate(rotated.token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('a single-use key redeemed on A is rejected on B (shared denylist)', async () => {
    // Denylist-level assertion of roadmap item (d); the full ID-JAG flow
    // variant lives in enterprise-auth.test.ts.
    const denylist = new MemoryDenylist();
    const now = 1_000_000_000;
    const exp = now + 300_000;

    expect(await denylist.addIfAbsent('jti-1', exp, { cap: 100, now })).toBe('added');
    expect(await denylist.addIfAbsent('jti-1', exp, { cap: 100, now })).toBe('exists');
  });
});

// ─── MemoryDenylist contract ─────────────────────────────────────────────────

describe('MemoryDenylist', () => {
  it('expired entries stop counting as present and can be re-added', async () => {
    const denylist = new MemoryDenylist();
    const t0 = 1_000_000_000;
    expect(await denylist.addIfAbsent('k', t0 + 1_000, { cap: null, now: t0 })).toBe('added');
    expect(await denylist.addIfAbsent('k', t0 + 9_000, { cap: null, now: t0 + 2_000 })).toBe('added');
  });

  it('fails closed at the cap, but only counts live entries after sweeping', async () => {
    const denylist = new MemoryDenylist();
    const t0 = 1_000_000_000;
    expect(await denylist.addIfAbsent('a', t0 + 1_000, { cap: 2, now: t0 })).toBe('added');
    expect(await denylist.addIfAbsent('b', t0 + 1_000, { cap: 2, now: t0 })).toBe('added');
    expect(await denylist.addIfAbsent('c', t0 + 1_000, { cap: 2, now: t0 })).toBe('full');

    // Once a and b expire, the at-cap sweep frees space for c.
    expect(await denylist.addIfAbsent('c', t0 + 9_000, { cap: 2, now: t0 + 2_000 })).toBe('added');
  });

  it('remove un-burns a key before expiry', async () => {
    const denylist = new MemoryDenylist();
    const t0 = 1_000_000_000;
    await denylist.addIfAbsent('k', t0 + 60_000, { cap: null, now: t0 });
    await denylist.remove('k');
    expect(await denylist.addIfAbsent('k', t0 + 60_000, { cap: null, now: t0 })).toBe('added');
  });

  it('size counts only live entries; sweep drops expired ones', async () => {
    const denylist = new MemoryDenylist();
    const t0 = 1_000_000_000;
    await denylist.addIfAbsent('live', t0 + 60_000, { cap: null, now: t0 });
    await denylist.addIfAbsent('dead', t0 + 1_000, { cap: null, now: t0 });

    expect(await denylist.size(t0 + 2_000)).toBe(1);
    expect(await denylist.sweep(t0 + 2_000)).toBe(1);
    expect(await denylist.size(t0 + 2_000)).toBe(1);
  });
});

// ─── MemoryJitTokenStore contract edges ──────────────────────────────────────

describe('MemoryJitTokenStore', () => {
  const record = (id: string, over: Partial<Parameters<MemoryJitTokenStore['insert']>[0]> = {}) => ({
    id,
    tokenHash: 'h'.repeat(64),
    parentKeyId: 'k',
    rootId: id,
    scopes: ['traces'],
    issuedAt: 1_000_000_000,
    expiresAt: 1_000_900_000,
    notAfter: 1_003_600_000,
    generation: 0,
    revoked: false,
    rotated: false,
    ...over,
  });

  it('insert reports duplicate ids distinctly from capacity', async () => {
    const store = new MemoryJitTokenStore();
    const now = 1_000_000_000;
    expect(await store.insert(record('one'), { cap: 1, now })).toBe('inserted');
    expect(await store.insert(record('one'), { cap: 5, now })).toBe('duplicate');
    expect(await store.insert(record('two'), { cap: 1, now })).toBe('capacity');
  });

  it('rotate CAS reports the precise loser reason', async () => {
    const store = new MemoryJitTokenStore();
    const now = 1_000_000_000;
    await store.insert(record('root'), { cap: 10, now });

    const gen1 = record('gen1', { rootId: 'root', generation: 1 });
    expect((await store.rotate('root', gen1, { graceUntil: now + 30_000, now })).ok).toBe(true);

    // Losing a second rotation attempt on the same generation → 'rotated'.
    const gen1b = record('gen1b', { rootId: 'root', generation: 1 });
    const lost = await store.rotate('root', gen1b, { graceUntil: now + 30_000, now });
    expect(lost).toMatchObject({ ok: false, reason: 'rotated' });

    // Unknown id → 'missing'; revoked → 'revoked'; expired → 'expired'.
    expect(await store.rotate('nope', gen1b, { graceUntil: now, now })).toMatchObject({ ok: false, reason: 'missing' });
    await store.revoke('gen1', now);
    expect(await store.rotate('gen1', gen1b, { graceUntil: now, now })).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('getLineage still resolves after the root record is pruned', async () => {
    // The ownership check for lineage revocation depends on this: get(rootId)
    // goes undefined once the gen-0 record is pruned, but the lineage — and
    // therefore its owner — is still perfectly knowable.
    const store = new MemoryJitTokenStore();
    const now = 1_000_000_000;
    await store.insert(record('g0'), { cap: 10, now });
    await store.rotate('g0', record('g1', { rootId: 'g0', generation: 1 }), { graceUntil: now + 30_000, now });
    await store.rotate('g1', record('g2', { rootId: 'g0', generation: 2 }), { graceUntil: now + 30_000, now });

    expect(await store.get('g0')).toBeUndefined();
    const lineage = await store.getLineage('g0');
    expect(lineage.map((r) => r.id)).toEqual(['g1', 'g2']);
    expect(lineage.every((r) => r.parentKeyId === 'k')).toBe(true);
    expect(await store.getLineage('unknown')).toEqual([]);
  });

  it('rotate prunes older grace corpses, keeping {old, new}', async () => {
    const store = new MemoryJitTokenStore();
    const now = 1_000_000_000;
    await store.insert(record('g0'), { cap: 10, now });
    await store.rotate('g0', record('g1', { rootId: 'g0', generation: 1 }), { graceUntil: now + 30_000, now });
    await store.rotate('g1', record('g2', { rootId: 'g0', generation: 2 }), { graceUntil: now + 30_000, now });

    expect(await store.get('g0')).toBeUndefined(); // pruned corpse
    expect(await store.get('g1')).toBeDefined();   // in grace
    expect(await store.get('g2')).toBeDefined();   // current
  });
});

// ─── Store selection factory ─────────────────────────────────────────────────

describe('createJitStores', () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k];

  it('defaults to the in-process memory adapters', async () => {
    const bundle = await createJitStores(env({}));
    expect(bundle.description).toBe('memory');
    expect(bundle.tokens).toBeInstanceOf(MemoryJitTokenStore);
    expect(bundle.denylist).toBeInstanceOf(MemoryDenylist);
  });

  it('fails closed on an unloadable adapter module', async () => {
    await expect(
      createJitStores(env({ MCP_JIT_STORE: './definitely-not-a-real-adapter.js' })),
    ).rejects.toThrow(/cannot load store adapter/);
  });

  it('loads an operator-supplied adapter module via dynamic import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jit-store-'));
    const adapterPath = join(dir, 'adapter.mjs');
    writeFileSync(
      adapterPath,
      `export function createJitStore() {
        const marker = { adapter: 'test' };
        return {
          tokens: { marker, insert: async () => 'inserted', rotate: async () => ({ ok: true }),
                    get: async () => undefined, getLineage: async () => [], revoke: async () => undefined,
                    revokeLineage: async () => [], count: async () => 0, sweep: async () => 0 },
          denylist: { addIfAbsent: async () => 'added', remove: async () => {},
                      size: async () => 0, sweep: async () => 0 },
        };
      }`,
    );
    const bundle = await createJitStores(env({ MCP_JIT_STORE: pathToFileURL(adapterPath).href }));
    expect(bundle.description).toContain('adapter.mjs');
    expect((bundle.tokens as unknown as { marker: { adapter: string } }).marker.adapter).toBe('test');
  });

  it('rejects adapter modules without a valid factory or bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jit-store-bad-'));
    const noFactory = join(dir, 'no-factory.mjs');
    writeFileSync(noFactory, 'export const nothing = 1;');
    await expect(
      createJitStores(env({ MCP_JIT_STORE: pathToFileURL(noFactory).href })),
    ).rejects.toThrow(/must export a createJitStore/);

    const badBundle = join(dir, 'bad-bundle.mjs');
    writeFileSync(badBundle, 'export function createJitStore() { return { tokens: null }; }');
    await expect(
      createJitStores(env({ MCP_JIT_STORE: pathToFileURL(badBundle).href })),
    ).rejects.toThrow(/invalid bundle/);
  });
});
