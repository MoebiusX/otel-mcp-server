/**
 * Enterprise-Managed Authorization — MCP extension
 * `io.modelcontextprotocol/enterprise-managed-authorization`.
 *
 * Lets an organization's identity provider (Okta, Entra ID, corporate SSO…)
 * decide who may use this MCP server, instead of locally provisioned API keys.
 * The MCP client logs the employee in with corporate SSO, asks the IdP for an
 * **Identity Assertion JWT Authorization Grant (ID-JAG)**, and presents it to
 * this server's token endpoint (`POST /auth/token`) with
 * `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`. After validating
 * the assertion against the IdP's JWKS, the server answers with one of its
 * scoped, ephemeral JIT session tokens (see jit.ts) — so enterprise identities
 * and static keys share the same least-privilege, rotation, and audit rails.
 *
 * Validation follows draft-ietf-oauth-identity-assertion-authz-grant §4.4.1:
 *   - JOSE header: `typ` MUST be `oauth-id-jag+jwt`; `alg` RS256/384/512 or
 *     ES256/384 (asymmetric only — `none`/HMAC are rejected outright).
 *   - Signature verifies against the enterprise IdP's JWKS (cached, kid-aware).
 *   - `iss` MUST equal the configured trusted IdP issuer.
 *   - `aud` MUST contain this server's issuer identifier
 *     (`MCP_ENTERPRISE_AUTH_AUDIENCE`).
 *   - `resource`, when present, MUST equal this server's resource identifier
 *     (`MCP_ENTERPRISE_AUTH_RESOURCE`, defaults to the audience).
 *   - `exp`/`iat`/`nbf` are enforced with a small clock-skew allowance.
 *   - `jti` is single-use: successfully redeemed ids are remembered until they
 *     expire, so a captured assertion cannot be replayed.
 *   - `client_id` in the claim, when present, must match the request's.
 *
 * Discovery: when configured, the server advertises
 * `urn:ietf:params:oauth:grant-profile:id-jag` in
 * `authorization_grant_profiles_supported` of its RFC 8414 authorization
 * server metadata (`/.well-known/oauth-authorization-server`), and publishes
 * RFC 9728 protected-resource metadata for clients that walk the MCP core
 * authorization discovery chain.
 *
 * Zero runtime dependencies: JWTs are verified with `node:crypto`
 * (`createPublicKey({ format: 'jwk' })` + `crypto.verify`).
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface EnterpriseAuthConfig {
  /** Trusted enterprise IdP issuer (the ID-JAG `iss`). */
  issuer: string;
  /** This server's issuer identifier — what the ID-JAG `aud` must contain. */
  audience: string;
  /** This MCP server's resource identifier — what `resource` must equal. */
  resource: string;
  /** JWKS endpoint. Explicit, or discovered from the issuer's OIDC metadata. */
  jwksUrl?: string;
  /**
   * Scopes granted when the ID-JAG carries no `scope` claim. Empty = grant all
   * skills enabled on this instance (the IdP authorized the server as a whole).
   */
  defaultScopes: string[];
}

/**
 * Read enterprise-managed-authorization config from the environment.
 * Returns `null` unless both ISSUER and AUDIENCE are set (explicit audience
 * binding is mandatory — there is no safe default).
 *
 * Env vars:
 *   MCP_ENTERPRISE_AUTH_ISSUER          — trusted IdP issuer URL (required)
 *   MCP_ENTERPRISE_AUTH_AUDIENCE        — this server's issuer id (required)
 *   MCP_ENTERPRISE_AUTH_RESOURCE        — resource id (default: audience)
 *   MCP_ENTERPRISE_AUTH_JWKS_URL        — explicit JWKS (default: OIDC discovery)
 *   MCP_ENTERPRISE_AUTH_DEFAULT_SCOPES  — comma/space-separated fallback scopes
 */
export function readEnterpriseAuthConfig(
  env: (k: string) => string | undefined = (k) => process.env[k],
): EnterpriseAuthConfig | null {
  const issuer = env('MCP_ENTERPRISE_AUTH_ISSUER')?.trim();
  const audience = env('MCP_ENTERPRISE_AUTH_AUDIENCE')?.trim();
  if (!issuer || !audience) return null;

  const resource = env('MCP_ENTERPRISE_AUTH_RESOURCE')?.trim() || audience;
  const jwksUrl = env('MCP_ENTERPRISE_AUTH_JWKS_URL')?.trim() || undefined;
  const defaultScopes = (env('MCP_ENTERPRISE_AUTH_DEFAULT_SCOPES') || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return { issuer, audience, resource, jwksUrl, defaultScopes };
}

// ─── Grant / profile identifiers (normative values from the extension spec) ──

export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const ID_JAG_GRANT_PROFILE = 'urn:ietf:params:oauth:grant-profile:id-jag';
export const ID_JAG_TYP = 'oauth-id-jag+jwt';
export const ENTERPRISE_AUTH_EXTENSION_ID =
  'io.modelcontextprotocol/enterprise-managed-authorization';

/** Accepted asymmetric JWS algorithms and their node:crypto parameters. */
const ALGS: Record<string, { hash: string; kty: 'RSA' | 'EC'; dsaEncoding?: 'ieee-p1363'; curve?: string }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  ES256: { hash: 'sha256', kty: 'EC', dsaEncoding: 'ieee-p1363', curve: 'P-256' },
  ES384: { hash: 'sha384', kty: 'EC', dsaEncoding: 'ieee-p1363', curve: 'P-384' },
};

/** Allowed clock skew when checking exp / iat / nbf. */
const CLOCK_SKEW_MS = 60_000;
/** JWKS cache lifetime; unknown `kid`s trigger one early refetch. */
const JWKS_TTL_MS = 5 * 60_000;
/** Minimum interval between JWKS refetches (negative-cache for unknown kids). */
const JWKS_MIN_FETCH_INTERVAL_MS = 30_000;
/** Redeemed-jti replay cache hard cap (entries expire with their assertion). */
const MAX_REDEEMED_JTIS = 50_000;

// ─── Result types ────────────────────────────────────────────────────────────

/** OAuth 2.0 token error (RFC 6749 §5.2) with an audit-friendly detail. */
export class OAuthTokenError extends Error {
  constructor(
    /** RFC 6749 error code, e.g. `invalid_grant`. */
    readonly code: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'invalid_scope' | 'unsupported_grant_type' | 'server_error',
    /** Short machine-friendly reason for logs/metrics (never secret-bearing). */
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthTokenError';
  }

  get status(): number {
    return this.code === 'invalid_client' ? 401 : this.code === 'server_error' ? 500 : 400;
  }
}

/** Verified identity extracted from a valid ID-JAG. */
export interface VerifiedAssertion {
  /** Stable subject identifier from the IdP (primary account-linking key). */
  sub: string;
  /** IdP issuer the assertion was verified against. */
  iss: string;
  /** Client the IdP issued the grant to, when claimed. */
  clientId?: string;
  /** Email claim, when present (secondary account-linking hint). */
  email?: string;
  /** Space-separated scope claim parsed into a list (empty = none claimed). */
  scopes: string[];
  /** The assertion's jti (already recorded as redeemed). */
  jti: string;
  /** Assertion expiry (epoch ms) — informational; the access token has its own TTL. */
  expiresAt: number;
}

// ─── JWKS handling ───────────────────────────────────────────────────────────

interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  crv?: string;
  [k: string]: unknown;
}

export interface EnterpriseAuthServiceOptions {
  now?: () => number;
  /** Injectable JWKS document fetcher for tests: url → { keys: [...] }. */
  fetchJson?: (url: string) => Promise<unknown>;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

function b64urlJson(segment: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JWT segment is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class EnterpriseAuthService {
  private readonly now: () => number;
  private readonly fetchJson: (url: string) => Promise<unknown>;

  private keys = new Map<string, KeyObject>(); // kid → key
  private keysFetchedAt = 0;
  private jwksUrlResolved?: string;
  /** jti → assertion exp (epoch ms); entries removed once expired. */
  private redeemedJtis = new Map<string, number>();

  constructor(
    readonly config: EnterpriseAuthConfig,
    options: EnterpriseAuthServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
  }

  /** Number of redeemed (unexpired) assertion ids currently remembered. */
  redeemedCount(): number {
    return this.redeemedJtis.size;
  }

  /** Drop expired entries from the replay cache. Returns how many were removed. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [jti, exp] of this.redeemedJtis) {
      if (now >= exp) {
        this.redeemedJtis.delete(jti);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Validate an ID-JAG assertion string and mark its `jti` as redeemed.
   * Throws {@link OAuthTokenError} (always `invalid_grant` for content
   * failures) with an audit `reason`; never echoes the assertion itself.
   */
  async verifyIdJag(assertion: string, requestClientId?: string): Promise<VerifiedAssertion> {
    const parts = assertion.split('.');
    if (parts.length !== 3) {
      throw new OAuthTokenError('invalid_grant', 'idjag_malformed', 'Assertion is not a compact JWS');
    }

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      header = b64urlJson(parts[0]!);
      payload = b64urlJson(parts[1]!);
    } catch {
      throw new OAuthTokenError('invalid_grant', 'idjag_malformed', 'Assertion header/payload is not valid base64url JSON');
    }

    // ── JOSE header ────────────────────────────────────────────────────────
    const typ = typeof header.typ === 'string' ? header.typ.toLowerCase() : '';
    if (typ !== ID_JAG_TYP && typ !== `application/${ID_JAG_TYP}`) {
      throw new OAuthTokenError('invalid_grant', 'idjag_wrong_typ', `Assertion "typ" must be ${ID_JAG_TYP}`);
    }
    const alg = typeof header.alg === 'string' ? header.alg : '';
    const algSpec = ALGS[alg];
    if (!algSpec) {
      throw new OAuthTokenError('invalid_grant', 'idjag_bad_alg', `Unsupported assertion algorithm "${alg || 'none'}"`);
    }

    // ── Signature ──────────────────────────────────────────────────────────
    const kid = typeof header.kid === 'string' ? header.kid : undefined;
    const key = await this.keyFor(kid, algSpec.kty);
    if (!key) {
      throw new OAuthTokenError('invalid_grant', 'idjag_unknown_key', 'No JWKS key matches the assertion');
    }
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf-8');
    const signature = Buffer.from(parts[2]!, 'base64url');
    const ok = cryptoVerify(
      algSpec.hash,
      signed,
      algSpec.dsaEncoding ? { key, dsaEncoding: algSpec.dsaEncoding } : key,
      signature,
    );
    if (!ok) {
      throw new OAuthTokenError('invalid_grant', 'idjag_bad_signature', 'Assertion signature verification failed');
    }

    // ── Claims ─────────────────────────────────────────────────────────────
    const now = this.now();

    if (payload.iss !== this.config.issuer) {
      throw new OAuthTokenError('invalid_grant', 'idjag_wrong_issuer', 'Assertion issuer is not the trusted enterprise IdP');
    }

    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(this.config.audience)) {
      throw new OAuthTokenError('invalid_grant', 'idjag_wrong_audience', `Assertion audience does not include ${this.config.audience}`);
    }

    if (payload.resource !== undefined && payload.resource !== this.config.resource) {
      throw new OAuthTokenError('invalid_grant', 'idjag_wrong_resource', `Assertion resource does not match ${this.config.resource}`);
    }

    const exp = typeof payload.exp === 'number' ? payload.exp * 1_000 : 0;
    if (!exp || now - CLOCK_SKEW_MS >= exp) {
      throw new OAuthTokenError('invalid_grant', 'idjag_expired', 'Assertion is expired (or has no exp)');
    }
    const iat = typeof payload.iat === 'number' ? payload.iat * 1_000 : undefined;
    if (iat !== undefined && iat > now + CLOCK_SKEW_MS) {
      throw new OAuthTokenError('invalid_grant', 'idjag_not_yet_valid', 'Assertion iat is in the future');
    }
    const nbf = typeof payload.nbf === 'number' ? payload.nbf * 1_000 : undefined;
    if (nbf !== undefined && nbf > now + CLOCK_SKEW_MS) {
      throw new OAuthTokenError('invalid_grant', 'idjag_not_yet_valid', 'Assertion nbf is in the future');
    }

    const sub = typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
    if (!sub) {
      throw new OAuthTokenError('invalid_grant', 'idjag_no_subject', 'Assertion has no subject');
    }

    const jti = typeof payload.jti === 'string' && payload.jti ? payload.jti : undefined;
    if (!jti) {
      throw new OAuthTokenError('invalid_grant', 'idjag_no_jti', 'Assertion has no jti');
    }

    const claimedClientId = typeof payload.client_id === 'string' ? payload.client_id : undefined;
    if (claimedClientId && requestClientId && claimedClientId !== requestClientId) {
      throw new OAuthTokenError('invalid_grant', 'idjag_client_mismatch', 'Assertion client_id does not match the requesting client');
    }

    // ── Replay protection (record only after everything else passed) ──────
    this.sweep();
    if (this.redeemedJtis.has(jti)) {
      throw new OAuthTokenError('invalid_grant', 'idjag_replayed', 'Assertion has already been redeemed');
    }
    if (this.redeemedJtis.size >= MAX_REDEEMED_JTIS) {
      // Only successfully validated assertions are remembered, so hitting the
      // cap means an extraordinary volume of legitimate grants. Fail closed.
      throw new OAuthTokenError('server_error', 'idjag_replay_cache_full', 'Assertion replay cache is full');
    }
    this.redeemedJtis.set(jti, exp);

    const scopes =
      typeof payload.scope === 'string'
        ? payload.scope.split(/\s+/).map((s) => s.trim()).filter(Boolean)
        : [];

    return {
      sub,
      iss: this.config.issuer,
      clientId: claimedClientId ?? requestClientId,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      scopes,
      jti,
      expiresAt: exp,
    };
  }

  /**
   * Resolve the granted skill scopes for a verified assertion: the `scope`
   * claim intersected with this instance's enabled skills; with no claim, the
   * configured defaults (or every enabled skill). Empty grant → invalid_scope.
   */
  grantedScopes(assertion: VerifiedAssertion, enabledSkillIds: string[]): string[] {
    const requested = assertion.scopes.length
      ? assertion.scopes
      : this.config.defaultScopes.length
        ? this.config.defaultScopes
        : enabledSkillIds;
    const granted = [...new Set(requested)].filter((s) => enabledSkillIds.includes(s)).sort();
    if (granted.length === 0) {
      throw new OAuthTokenError(
        'invalid_scope',
        'idjag_no_usable_scope',
        `No requested scope matches an enabled skill (requested: ${requested.join(' ') || 'none'})`,
      );
    }
    return granted;
  }

  /** Fetch (or re-use cached) JWKS and return the key for `kid`. */
  private async keyFor(kid: string | undefined, kty: 'RSA' | 'EC'): Promise<KeyObject | undefined> {
    const now = this.now();
    const fresh = now - this.keysFetchedAt < JWKS_TTL_MS;

    const lookup = (): KeyObject | undefined => {
      if (kid) return this.keys.get(kid);
      // No kid: only unambiguous when exactly one key of the right type exists.
      const candidates = [...this.keys.values()].filter(
        (k) => k.asymmetricKeyType === (kty === 'RSA' ? 'rsa' : 'ec'),
      );
      return candidates.length === 1 ? candidates[0] : undefined;
    };

    if (fresh) {
      const hit = lookup();
      // Unknown kid on a fresh-but-not-just-fetched cache → one early refetch
      // (key rotation at the IdP), rate-limited by JWKS_MIN_FETCH_INTERVAL_MS.
      if (hit || now - this.keysFetchedAt < JWKS_MIN_FETCH_INTERVAL_MS) return hit;
    }

    try {
      await this.refreshJwks();
    } catch (err) {
      // Keep serving from the stale cache if we have one; a transient JWKS
      // outage must not take down auth for known keys.
      if (this.keys.size === 0) {
        throw new OAuthTokenError(
          'server_error',
          'jwks_unavailable',
          `Could not fetch enterprise IdP JWKS: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return lookup();
  }

  private async refreshJwks(): Promise<void> {
    if (!this.jwksUrlResolved) {
      if (this.config.jwksUrl) {
        this.jwksUrlResolved = this.config.jwksUrl;
      } else {
        const discoveryUrl = `${this.config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
        const doc = (await this.fetchJson(discoveryUrl)) as { jwks_uri?: string };
        if (!doc?.jwks_uri) throw new Error(`No jwks_uri in ${discoveryUrl}`);
        this.jwksUrlResolved = doc.jwks_uri;
      }
    }

    const jwks = (await this.fetchJson(this.jwksUrlResolved)) as { keys?: Jwk[] };
    if (!Array.isArray(jwks?.keys)) throw new Error('JWKS document has no "keys" array');

    const next = new Map<string, KeyObject>();
    for (const jwk of jwks.keys) {
      if (jwk.use && jwk.use !== 'sig') continue;
      if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') continue;
      try {
        const key = createPublicKey({ key: jwk as never, format: 'jwk' });
        next.set(jwk.kid ?? `__nokid_${next.size}`, key);
      } catch {
        // Skip malformed keys; a bad entry must not poison the whole set.
      }
    }
    this.keys = next;
    this.keysFetchedAt = this.now();
  }
}

// ─── Discovery metadata builders ─────────────────────────────────────────────

/**
 * RFC 8414 authorization server metadata declaring ID-JAG support
 * (`/.well-known/oauth-authorization-server`). The MCP client checks
 * `authorization_grant_profiles_supported` for the id-jag profile.
 */
export function authorizationServerMetadata(
  cfg: EnterpriseAuthConfig,
  scopesSupported: string[],
): Record<string, unknown> {
  return {
    issuer: cfg.audience,
    token_endpoint: `${cfg.audience.replace(/\/$/, '')}/auth/token`,
    grant_types_supported: [JWT_BEARER_GRANT],
    authorization_grant_profiles_supported: [ID_JAG_GRANT_PROFILE],
    response_types_supported: [],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: scopesSupported,
  };
}

/**
 * RFC 9728 protected resource metadata
 * (`/.well-known/oauth-protected-resource`) pointing clients at this server's
 * authorization server (itself — the JIT token endpoint).
 */
export function protectedResourceMetadata(
  cfg: EnterpriseAuthConfig,
  scopesSupported: string[],
): Record<string, unknown> {
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.audience],
    scopes_supported: scopesSupported,
    bearer_methods_supported: ['header'],
  };
}
