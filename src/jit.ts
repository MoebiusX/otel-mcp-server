/**
 * Just-in-Time (JIT) privileged identity for MCP clients.
 *
 * Static client API keys (auth.ts) are long-lived and, historically,
 * all-or-nothing: an agent holding one holds it forever, with whatever access
 * the key grants. This module lets a static key act as a *role definition*
 * instead of a standing credential — at runtime the key is exchanged for a
 * short-lived, scoped, rotatable session token, so the agent never possesses
 * broad, permanent system access. Treat the AI like a human employee: the
 * static key is the role, the JIT token is the badge issued at shift start —
 * narrowly scoped, expiring on its own, renewable during the shift up to a
 * hard cap, and revocable centrally.
 *
 * Aligned with the OWASP MCP Top 10 (2025):
 *   - MCP01 Token Mismanagement & Secret Exposure — tokens are short-lived and
 *     stored only as SHA-256 hashes; secrets never appear in logs or errors.
 *   - MCP02 Privilege Escalation via Scope Creep — tokens carry an explicit
 *     scope (a subset of the parent key's `allowedTools`) enforced at session
 *     creation, and scopes expire automatically with the token.
 *   - MCP07 Insufficient Authentication & Authorization — MCP sessions are
 *     bound to the token lineage (or key) that created them; a different
 *     principal cannot reuse the session.
 *   - MCP08 Lack of Audit and Telemetry — every issuance, rotation, denial,
 *     and revocation is logged (token id, never the secret) and exported via
 *     /metrics.
 *
 * Modes (`MCP_JIT_MODE`):
 *   - `off`      — legacy behaviour; static keys call tools directly (default).
 *   - `enabled`  — POST /auth/token is live; static keys still work directly
 *                  (migration mode).
 *   - `required` — zero standing privilege: static keys can ONLY mint tokens;
 *                  MCP endpoints accept JIT tokens exclusively.
 *
 * State lives behind the async {@link JitTokenStore} abstraction (jit-store.ts).
 * The default `MemoryJitTokenStore` keeps the original semantics — a restart
 * invalidates all outstanding tokens, the desired failure mode for ephemeral
 * credentials on a single instance. A shared adapter (`MCP_JIT_STORE`) makes
 * tokens, revocation, and the capacity guard correct across replicas behind a
 * load balancer. All check-then-act sequences (capacity gate, once-only
 * rotation) are delegated to the store's atomic primitives so they hold under
 * concurrency and across replicas — the service keeps crypto and policy only.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MemoryJitTokenStore, type JitTokenStore } from './jit-store.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export type JitMode = 'off' | 'enabled' | 'required';

export interface JitConfig {
  mode: JitMode;
  /**
   * Per-token lifetime in seconds. Also the *cap* for a caller-requested
   * `ttlSeconds` (callers may mint shorter-lived tokens, never longer).
   */
  ttlSeconds: number;
  /**
   * Absolute lifetime cap for a token lineage in seconds. Rotation
   * (`/auth/token/refresh`) can never extend access past `issuedAt` of the
   * first generation plus this value — the end of the badge's "shift".
   */
  maxLifetimeSeconds: number;
  /** Upper bound on concurrently active tokens (DoS / leak guard). */
  maxActiveTokens: number;
}

/** Hard bounds for the per-token TTL (1 minute … 1 hour). */
export const JIT_TTL_MIN_S = 60;
export const JIT_TTL_MAX_S = 3_600;
/** Hard upper bound for the lineage lifetime cap (24 hours). */
export const JIT_LIFETIME_MAX_S = 86_400;
/** A rotated-out token stays valid this long so in-flight requests finish. */
export const JIT_ROTATION_GRACE_MS = 30_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Resolve the JIT mode from the environment. Defaults to `'off'` (opt-in);
 * unrecognized values fall back to the default, mirroring `getGatingMode`.
 */
export function getJitMode(
  env: (k: string) => string | undefined = (k) => process.env[k],
): JitMode {
  const raw = (env('MCP_JIT_MODE') || 'off').trim().toLowerCase();
  return raw === 'enabled' || raw === 'required' ? raw : 'off';
}

/**
 * Read JIT configuration from the environment.
 *
 * Env vars:
 *   MCP_JIT_MODE                  — off | enabled | required   (default off)
 *   MCP_JIT_TTL_SECONDS           — token TTL, 60..3600        (default 900)
 *   MCP_JIT_MAX_LIFETIME_SECONDS  — lineage cap, ttl..86400    (default 28800)
 *   MCP_JIT_MAX_ACTIVE_TOKENS     — store capacity, ≥1         (default 1000)
 *   MCP_JIT_STORE                 — memory | <adapter module>  (default memory;
 *                                   resolved by jit-store.ts, not here)
 */
export function readJitConfig(
  env: (k: string) => string | undefined = (k) => process.env[k],
): JitConfig {
  const ttlSeconds = clamp(
    readPositiveInt(env('MCP_JIT_TTL_SECONDS'), 900),
    JIT_TTL_MIN_S,
    JIT_TTL_MAX_S,
  );
  const maxLifetimeSeconds = clamp(
    readPositiveInt(env('MCP_JIT_MAX_LIFETIME_SECONDS'), 28_800),
    ttlSeconds,
    JIT_LIFETIME_MAX_S,
  );
  const maxActiveTokens = Math.max(
    1,
    readPositiveInt(env('MCP_JIT_MAX_ACTIVE_TOKENS'), 1_000),
  );
  return { mode: getJitMode(env), ttlSeconds, maxLifetimeSeconds, maxActiveTokens };
}

// ─── Token model ─────────────────────────────────────────────────────────────

/** Everything the server retains about a token. The secret itself is never stored. */
export interface JitTokenRecord {
  /** Public token id (safe to log / audit). */
  id: string;
  /** SHA-256 hex of the full token string. */
  tokenHash: string;
  /** Static client key id this token was minted from. */
  parentKeyId: string;
  /** First token id in the rotation chain — the stable session-binding principal. */
  rootId: string;
  /** Skill ids this token may activate (least-privilege scope). */
  scopes: string[];
  /** Epoch ms. */
  issuedAt: number;
  /** Epoch ms; shortened to the rotation grace window when superseded. */
  expiresAt: number;
  /** Epoch ms; hard cap — no rotation extends the lineage past this. */
  notAfter: number;
  /** 0 for a freshly minted token, +1 per rotation. */
  generation: number;
  revoked: boolean;
  /** True when superseded by a newer generation via refresh. */
  rotated: boolean;
}

export interface IssuedToken {
  /** Full bearer token — returned to the caller once, never stored or logged. */
  token: string;
  record: JitTokenRecord;
}

export type JitDenialReason =
  | 'malformed'
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'rotated'
  | 'scope_violation'
  | 'capacity'
  | 'lifetime_exhausted'
  | 'static_key_blocked'
  | 'token_minting_with_token'
  | 'session_principal_mismatch'
  | 'parent_key_revoked';

export type JitValidation =
  | { ok: true; record: JitTokenRecord }
  | { ok: false; reason: Extract<JitDenialReason, 'malformed' | 'unknown' | 'expired' | 'revoked'> };

/** Typed failure for issue/refresh/revoke, carrying the HTTP status to emit. */
export class JitError extends Error {
  constructor(
    readonly code: JitDenialReason,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'JitError';
  }
}

export interface IssueRequest {
  /** Static client key id minting the token (audit trail). */
  parentKeyId: string;
  /**
   * Scopes the parent key may grant — its `allowedTools`, or `null` when the
   * key is unrestricted (may grant any enabled skill).
   */
  grantableScopes: string[] | null;
  /** Skill ids enabled on this server instance. */
  enabledSkillIds: string[];
  /** Requested narrowing; defaults to everything grantable. */
  requestedScopes?: string[];
  /** Requested TTL; clamped to [60s, configured TTL]. */
  requestedTtlSeconds?: number;
}

// ─── Token string format ─────────────────────────────────────────────────────
//
//   mcpj_<id>.<secret>
//
// `id` and `secret` are base64url; '.' separates them because it is not in the
// base64url alphabet. The id is public (audit); only sha256(full string) is kept.

const TOKEN_PREFIX = 'mcpj_';
const TOKEN_RE = /^mcpj_([A-Za-z0-9_-]{8,24})\.([A-Za-z0-9_-]{32,64})$/;

/** Cheap syntactic check — routes a bearer credential to JIT vs static-key auth. */
export function looksLikeJitToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashesEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Stable session-binding principal for a JIT credential (rotation-proof). */
export function jitPrincipal(record: JitTokenRecord): string {
  return `jit:${record.rootId}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export interface JitTokenServiceOptions {
  /** Injectable clock for tests. */
  now?: () => number;
  /** State backend; defaults to the in-process store (see jit-store.ts). */
  store?: JitTokenStore;
}

/** Random-id collisions are ~2^-72 per attempt; retries beyond this indicate a broken store. */
const MAX_ID_ATTEMPTS = 4;

export class JitTokenService {
  private readonly store: JitTokenStore;
  private readonly now: () => number;

  constructor(
    readonly config: JitConfig,
    options: JitTokenServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.store = options.store ?? new MemoryJitTokenStore();
  }

  /** Tokens that are neither revoked nor expired. */
  activeCount(): Promise<number> {
    return this.store.count(this.now());
  }

  /** Lookup by public token id (no secret involved). */
  get(id: string): Promise<JitTokenRecord | undefined> {
    return this.store.get(id);
  }

  /**
   * Mint a fresh scoped, ephemeral token from a static client key.
   *
   * Scope rule (RFC 8693 spirit): the token's scopes must be a subset of what
   * the parent key may grant. Requesting nothing inherits the full grantable
   * set — narrowing is encouraged, escalation is impossible.
   */
  async issue(req: IssueRequest): Promise<IssuedToken> {
    const grantable = req.grantableScopes ?? req.enabledSkillIds;
    const requested = req.requestedScopes?.length
      ? [...new Set(req.requestedScopes)]
      : [...new Set(grantable)];

    const outOfScope = requested.filter((s) => !grantable.includes(s));
    if (outOfScope.length > 0) {
      throw new JitError(
        'scope_violation',
        403,
        `Requested scope(s) exceed what key "${req.parentKeyId}" may grant: ${outOfScope.join(', ')}`,
      );
    }

    const ttlS = clamp(
      req.requestedTtlSeconds ?? this.config.ttlSeconds,
      JIT_TTL_MIN_S,
      this.config.ttlSeconds,
    );

    const now = this.now();
    const notAfter = now + this.config.maxLifetimeSeconds * 1_000;

    // Capacity check + unique-id check + insert are one atomic store operation
    // — under a shared store, concurrent mints across replicas cannot exceed
    // the cap, and an (astronomically unlikely) id collision just re-rolls.
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const issued = this.buildToken({
        parentKeyId: req.parentKeyId,
        rootId: null,
        scopes: requested.sort(),
        generation: 0,
        ttlMs: ttlS * 1_000,
        notAfter,
        now,
      });
      const result = await this.store.insert(issued.record, {
        cap: this.config.maxActiveTokens,
        now,
      });
      if (result === 'inserted') return issued;
      if (result === 'capacity') {
        throw new JitError(
          'capacity',
          429,
          `Active token limit reached (${this.config.maxActiveTokens}); revoke tokens or raise MCP_JIT_MAX_ACTIVE_TOKENS`,
        );
      }
      // 'duplicate' → regenerate the id and try again.
    }
    throw new JitError('capacity', 500, 'Token id generation failed repeatedly — store misbehaving');
  }

  /** Validate a presented bearer token string against the store. */
  async validate(tokenString: string): Promise<JitValidation> {
    const match = TOKEN_RE.exec(tokenString);
    if (!match) return { ok: false, reason: 'malformed' };

    const record = await this.store.get(match[1]!);
    if (!record || !hashesEqual(record.tokenHash, sha256Hex(tokenString))) {
      return { ok: false, reason: 'unknown' };
    }
    if (record.revoked) return { ok: false, reason: 'revoked' };
    if (this.now() >= record.expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true, record };
  }

  /**
   * Rotate a live token: mint the next generation (same scopes, same lineage,
   * same hard cap) and shorten the old one to a small grace window so in-flight
   * requests complete. Refuses once the lineage cap (`notAfter`) is reached —
   * the agent must re-authenticate with its static key, which is the point.
   *
   * Only the current generation may refresh; the once-only guarantee is a
   * store-level compare-and-set, so concurrent refreshes of the same token
   * (including on different replicas) mint exactly one successor and every
   * loser gets `rotated` — a lineage can never branch.
   */
  async refresh(tokenString: string): Promise<IssuedToken> {
    const v = await this.validate(tokenString);
    if (!v.ok) {
      throw new JitError(v.reason, 401, `Cannot refresh: token is ${v.reason}`);
    }
    const old = v.record;
    if (old.rotated) {
      throw new JitError(
        'rotated',
        409,
        'Token already rotated; use the current token returned by the latest refresh',
      );
    }

    const now = this.now();
    const expiresAt = Math.min(now + this.config.ttlSeconds * 1_000, old.notAfter);
    if (expiresAt <= now) {
      throw new JitError(
        'lifetime_exhausted',
        403,
        `Token lineage reached its maximum lifetime (${new Date(old.notAfter).toISOString()}); mint a new token via POST /auth/token`,
      );
    }

    // Rotation is exempt from the capacity check: it replaces a live token, so
    // hitting the cap must not brick every existing session's renewal.
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const issued = this.buildToken({
        parentKeyId: old.parentKeyId,
        rootId: old.rootId,
        scopes: [...old.scopes],
        generation: old.generation + 1,
        ttlMs: expiresAt - now,
        notAfter: old.notAfter,
        now,
      });
      const result = await this.store.rotate(old.id, issued.record, {
        graceUntil: now + JIT_ROTATION_GRACE_MS,
        now,
      });
      if (result.ok) return issued;
      if (result.reason === 'duplicate') continue; // re-roll the id
      if (result.reason === 'rotated') {
        throw new JitError(
          'rotated',
          409,
          'Token already rotated; use the current token returned by the latest refresh',
        );
      }
      if (result.reason === 'revoked') {
        throw new JitError('revoked', 401, 'Cannot refresh: token is revoked');
      }
      // 'missing' (swept mid-flight) or 'expired' (raced past expiry)
      const reason = result.reason === 'missing' ? 'unknown' : 'expired';
      throw new JitError(reason, 401, `Cannot refresh: token is ${reason}`);
    }
    throw new JitError('capacity', 500, 'Token id generation failed repeatedly — store misbehaving');
  }

  /** Self-revocation with the token string. Throws when the token is not live. */
  async revoke(tokenString: string): Promise<JitTokenRecord> {
    const v = await this.validate(tokenString);
    if (!v.ok) {
      throw new JitError(v.reason, 401, `Cannot revoke: token is ${v.reason}`);
    }
    const killed = await this.store.revoke(v.record.id, this.now());
    return killed ?? v.record;
  }

  /** Administrative revocation by public token id (kill-switch). */
  revokeById(id: string): Promise<JitTokenRecord | undefined> {
    return this.store.revoke(id, this.now());
  }

  /**
   * Records still tracked for a rotation lineage. Use this — not `get(rootId)`
   * — to answer "who owns this lineage": the generation-0 record whose id *is*
   * the rootId is pruned after the second rotation and swept after its grace
   * window, so a root-id lookup goes empty while the lineage is still live.
   */
  getLineage(rootId: string): Promise<JitTokenRecord[]> {
    return this.store.getLineage(rootId);
  }

  /**
   * Administrative revocation of an entire rotation lineage by its root id —
   * kills the current generation and any in-grace predecessor without the
   * operator needing to chase the latest token id through the audit log.
   */
  revokeLineage(rootId: string): Promise<JitTokenRecord[]> {
    return this.store.revokeLineage(rootId, this.now());
  }

  /** Drop expired and revoked records. Returns how many were removed. */
  sweep(): Promise<number> {
    return this.store.sweep(this.now());
  }

  /** Mint the token string + record pair. Pure — no store interaction. */
  private buildToken(args: {
    parentKeyId: string;
    rootId: string | null;
    scopes: string[];
    generation: number;
    ttlMs: number;
    notAfter: number;
    now: number;
  }): IssuedToken {
    const id = randomBytes(9).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const token = `${TOKEN_PREFIX}${id}.${secret}`;

    const record: JitTokenRecord = {
      id,
      tokenHash: sha256Hex(token),
      parentKeyId: args.parentKeyId,
      rootId: args.rootId ?? id,
      scopes: args.scopes,
      issuedAt: args.now,
      expiresAt: Math.min(args.now + args.ttlMs, args.notAfter),
      notAfter: args.notAfter,
      generation: args.generation,
      revoked: false,
      rotated: false,
    };
    return { token, record };
  }
}
