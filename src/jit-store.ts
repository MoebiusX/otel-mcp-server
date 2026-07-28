/**
 * Pluggable state stores for the JIT privileged-identity subsystem (jit.ts)
 * and the enterprise-auth single-use denylist (enterprise-auth.ts).
 *
 * Roadmap Phase 1 (docs/enterprise-auth-roadmap.md): tokens and single-use
 * replay state must survive restarts and work correctly across replicas behind
 * a load balancer. The service keeps all crypto and policy; the store owns
 * *state* behind **atomic compound primitives** — never get/set — so that a
 * networked backend can implement them transactionally and no check-then-act
 * sequence in the service becomes a cross-replica TOCTOU race:
 *
 *   - `insert`  — unique-id check + capacity check + insert as one operation
 *                 (replaces the old `activeCount()`-then-`mint()` gate).
 *   - `rotate`  — compare-and-set on `rotated === false`: marks the old
 *                 generation rotated (shortened to its grace window), inserts
 *                 the next generation, and prunes earlier grace corpses, all
 *                 atomically. Concurrent refreshes of one token: exactly one wins.
 *   - `revoke` / `revokeLineage` / `get` / `count` / `sweep`.
 *
 * `MemoryJitTokenStore` is the unconditional zero-dependency default and
 * preserves the pre-Phase-1 semantics exactly, including "a restart
 * invalidates all outstanding tokens" — the desired failure mode for
 * ephemeral credentials on a single instance. External adapters (Redis,
 * SQL, …) are operator-supplied modules loaded via dynamic `import()` from
 * `MCP_JIT_STORE`; they never enter `package.json` dependencies.
 *
 * The {@link BoundedDenylist} is the shared single-use abstraction: ID-JAG
 * `jti` replay protection today; DPoP / `private_key_jwt` `jti` sets and
 * rate-limit counters later (Phases 3–4). Entries self-expire at their
 * `expiresAt`, so the structure is naturally bounded by issuance volume ×
 * assertion TTL rather than an arbitrary cap that fails closed as a DoS.
 */

import type { JitTokenRecord } from './jit.js';

// ─── Token store contract ────────────────────────────────────────────────────

export type InsertResult = 'inserted' | 'capacity' | 'duplicate';

export type RotateResult =
  | { ok: true }
  /** CAS failed; `current` is the record as the store saw it (undefined = gone). */
  | { ok: false; current?: JitTokenRecord; reason: 'missing' | 'revoked' | 'rotated' | 'expired' | 'duplicate' };

/**
 * Async state backend for {@link JitTokenService}. Implementations must make
 * each method atomic with respect to the others (single-threaded for the
 * memory adapter; MULTI/Lua/transactions for networked backends).
 *
 * Records returned by a store are snapshots; only the memory adapter happens
 * to return live references. Callers must not rely on mutation visibility.
 */
export interface JitTokenStore {
  /**
   * Insert a freshly minted generation-0 record iff its id is unused and the
   * number of active (unrevoked, unexpired at `now`) records is below `cap`.
   */
  insert(record: JitTokenRecord, opts: { cap: number; now: number }): Promise<InsertResult>;

  /**
   * Atomically rotate `oldId` to `newRecord`: succeeds iff the old record
   * exists, is not revoked, not already rotated, and not expired at `now`.
   * On success the old record is marked rotated with `expiresAt` clamped to
   * `graceUntil`, the new record is inserted, and any lineage members other
   * than {old, new} are dropped (grace corpses from earlier rotations).
   */
  rotate(
    oldId: string,
    newRecord: JitTokenRecord,
    opts: { graceUntil: number; now: number },
  ): Promise<RotateResult>;

  /** Snapshot lookup by public token id. */
  get(id: string): Promise<JitTokenRecord | undefined>;

  /** Mark one record revoked (expiry clamped to `now`). Undefined = unknown id. */
  revoke(id: string, now: number): Promise<JitTokenRecord | undefined>;

  /**
   * Revoke every record in a rotation lineage (kill-switch for a stolen
   * credential whose current generation id the operator may not know).
   * Returns the records that were live before revocation.
   */
  revokeLineage(rootId: string, now: number): Promise<JitTokenRecord[]>;

  /** Number of active (unrevoked, unexpired at `now`) records. */
  count(now: number): Promise<number>;

  /** Drop revoked/expired records. Returns how many were removed. */
  sweep(now: number): Promise<number>;
}

// ─── Single-use denylist contract ────────────────────────────────────────────

export type DenylistAddResult = 'added' | 'exists' | 'full';

/**
 * Shared bounded single-use denylist. `addIfAbsent` is the atomic
 * check-and-record primitive replacing every has()-then-set() sequence.
 * Entries expire at their `expiresAt` and never count as present afterwards.
 */
export interface BoundedDenylist {
  /**
   * Record `key` iff it is not already present (and, when `cap` is set, the
   * live entry count is below it — a memory-adapter safety bound; TTL-native
   * backends may ignore `cap` and always self-bound by expiry).
   */
  addIfAbsent(
    key: string,
    expiresAt: number,
    opts: { cap: number | null; now: number },
  ): Promise<DenylistAddResult>;

  /**
   * Remove a key before its expiry — used to un-burn a single-use credential
   * when the action it authorized failed after verification (e.g. an ID-JAG
   * redeemed but token issuance hit the capacity guard).
   */
  remove(key: string): Promise<void>;

  /** Live (unexpired) entry count. */
  size(now: number): Promise<number>;

  /** Drop expired entries. No-op (0) for TTL-native backends. */
  sweep(now: number): Promise<number>;
}

// ─── In-memory adapters (default; behaviourally identical to pre-Phase-1) ────

export class MemoryJitTokenStore implements JitTokenStore {
  private readonly tokens = new Map<string, JitTokenRecord>();
  /** rootId → live record ids in that lineage (bounds refresh accumulation). */
  private readonly lineageMembers = new Map<string, Set<string>>();

  async insert(record: JitTokenRecord, opts: { cap: number; now: number }): Promise<InsertResult> {
    if (this.tokens.has(record.id)) return 'duplicate';
    if (this.activeCount(opts.now) >= opts.cap) return 'capacity';
    this.put(record);
    return 'inserted';
  }

  async rotate(
    oldId: string,
    newRecord: JitTokenRecord,
    opts: { graceUntil: number; now: number },
  ): Promise<RotateResult> {
    const old = this.tokens.get(oldId);
    if (!old) return { ok: false, reason: 'missing' };
    if (old.revoked) return { ok: false, current: old, reason: 'revoked' };
    if (old.rotated) return { ok: false, current: old, reason: 'rotated' };
    if (opts.now >= old.expiresAt) return { ok: false, current: old, reason: 'expired' };
    if (this.tokens.has(newRecord.id)) return { ok: false, current: old, reason: 'duplicate' };

    old.rotated = true;
    old.expiresAt = Math.min(old.expiresAt, opts.graceUntil);
    this.put(newRecord);

    // Keep the lineage to {current, single grace token}: hard-drop earlier
    // grace corpses so a rapid refresh loop cannot accumulate records past
    // the capacity guard. Safe because a rotated token can no longer refresh.
    const members = this.lineageMembers.get(old.rootId);
    if (members) {
      for (const memberId of [...members]) {
        if (memberId === old.id || memberId === newRecord.id) continue;
        this.tokens.delete(memberId);
        members.delete(memberId);
      }
    }
    return { ok: true };
  }

  async get(id: string): Promise<JitTokenRecord | undefined> {
    return this.tokens.get(id);
  }

  async revoke(id: string, now: number): Promise<JitTokenRecord | undefined> {
    const record = this.tokens.get(id);
    if (!record) return undefined;
    record.revoked = true;
    record.expiresAt = Math.min(record.expiresAt, now);
    return record;
  }

  async revokeLineage(rootId: string, now: number): Promise<JitTokenRecord[]> {
    const members = this.lineageMembers.get(rootId);
    if (!members) return [];
    const killed: JitTokenRecord[] = [];
    for (const id of members) {
      const record = this.tokens.get(id);
      if (!record || record.revoked || now >= record.expiresAt) continue;
      record.revoked = true;
      record.expiresAt = Math.min(record.expiresAt, now);
      killed.push(record);
    }
    return killed;
  }

  async count(now: number): Promise<number> {
    return this.activeCount(now);
  }

  async sweep(now: number): Promise<number> {
    let removed = 0;
    for (const [id, rec] of this.tokens) {
      if (rec.revoked || now >= rec.expiresAt) {
        this.tokens.delete(id);
        this.dropFromLineage(rec);
        removed++;
      }
    }
    return removed;
  }

  private activeCount(now: number): number {
    let count = 0;
    for (const rec of this.tokens.values()) {
      if (!rec.revoked && now < rec.expiresAt) count++;
    }
    return count;
  }

  private put(record: JitTokenRecord): void {
    this.tokens.set(record.id, record);
    let members = this.lineageMembers.get(record.rootId);
    if (!members) {
      members = new Set();
      this.lineageMembers.set(record.rootId, members);
    }
    members.add(record.id);
  }

  private dropFromLineage(rec: JitTokenRecord): void {
    const members = this.lineageMembers.get(rec.rootId);
    if (!members) return;
    members.delete(rec.id);
    if (members.size === 0) this.lineageMembers.delete(rec.rootId);
  }
}

export class MemoryDenylist implements BoundedDenylist {
  /** key → expiresAt (epoch ms). */
  private readonly entries = new Map<string, number>();

  async addIfAbsent(
    key: string,
    expiresAt: number,
    opts: { cap: number | null; now: number },
  ): Promise<DenylistAddResult> {
    const existing = this.entries.get(key);
    if (existing !== undefined && opts.now < existing) return 'exists';
    if (existing !== undefined) this.entries.delete(key); // expired corpse

    if (opts.cap !== null && this.entries.size >= opts.cap) {
      // Only sweep when the cap is actually reached — keeps the O(n) scan off
      // the per-request hot path at normal volume.
      await this.sweep(opts.now);
      if (this.entries.size >= opts.cap) return 'full';
    }
    this.entries.set(key, expiresAt);
    return 'added';
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async size(now: number): Promise<number> {
    let live = 0;
    for (const exp of this.entries.values()) if (now < exp) live++;
    return live;
  }

  async sweep(now: number): Promise<number> {
    let removed = 0;
    for (const [key, exp] of this.entries) {
      if (now >= exp) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

// ─── Store selection ─────────────────────────────────────────────────────────

export interface JitStoreBundle {
  tokens: JitTokenStore;
  denylist: BoundedDenylist;
  /** Human-readable origin for the startup banner (`memory` or the module id). */
  description: string;
}

/**
 * Resolve the JIT state backend from `MCP_JIT_STORE`.
 *
 *   - unset / `memory` — in-process adapters (default; zero dependencies).
 *   - anything else    — a module specifier dynamically imported at startup.
 *     The module must export `createJitStore(): JitStoreBundle | Promise<…>`
 *     (or a default export with that shape). External adapters are
 *     operator-supplied precisely so no network client ever enters this
 *     package's dependency tree.
 *
 * Misconfiguration throws (fail closed): silently degrading to per-replica
 * memory when the operator asked for a shared store would reintroduce the
 * exact HA auth bypass this module exists to prevent.
 */
export async function createJitStores(
  env: (k: string) => string | undefined = (k) => process.env[k],
): Promise<JitStoreBundle> {
  const raw = (env('MCP_JIT_STORE') || 'memory').trim();
  if (raw === '' || raw === 'memory') {
    return {
      tokens: new MemoryJitTokenStore(),
      denylist: new MemoryDenylist(),
      description: 'memory',
    };
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(raw)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `MCP_JIT_STORE: cannot load store adapter module "${raw}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const factory = (mod['createJitStore'] ?? mod['default']) as unknown;
  if (typeof factory !== 'function') {
    throw new Error(
      `MCP_JIT_STORE: adapter module "${raw}" must export a createJitStore() factory`,
    );
  }
  const bundle = (await factory()) as Partial<JitStoreBundle> | null | undefined;
  if (!bundle || typeof bundle !== 'object' || !bundle.tokens || !bundle.denylist) {
    throw new Error(
      `MCP_JIT_STORE: adapter module "${raw}" returned an invalid bundle — expected { tokens: JitTokenStore, denylist: BoundedDenylist }`,
    );
  }
  return { tokens: bundle.tokens, denylist: bundle.denylist, description: raw };
}
