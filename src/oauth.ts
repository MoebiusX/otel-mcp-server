/**
 * OAuth 2.0 / OIDC backend authentication.
 *
 * Obtains short-lived bearer tokens for telemetry backends using the
 * **client credentials** grant (service-to-service), with transparent
 * caching and refresh-on-expiry. Configured per backend prefix via
 * `<PREFIX>_AUTH_OAUTH_*` environment variables, so it works for named
 * multi-backend instances (`<PREFIX>__<NAME>`) too.
 *
 * Design goals:
 *   - Zero runtime dependencies (built-in `fetch` + `URLSearchParams`).
 *   - Token acquisition is **lazy and async** — `buildOAuthAuth` only wires a
 *     resolver closure; the token is fetched on the first request and cached.
 *   - Secrets never appear in thrown errors or logs.
 *
 * Supported env vars (replace PREFIX with e.g. PROMETHEUS, LOKI, JAEGER):
 *   PREFIX_AUTH_OAUTH_TOKEN_URL      — token endpoint (explicit)
 *   PREFIX_AUTH_OAUTH_ISSUER         — OIDC issuer for discovery (alternative to TOKEN_URL)
 *   PREFIX_AUTH_OAUTH_CLIENT_ID
 *   PREFIX_AUTH_OAUTH_CLIENT_SECRET
 *   PREFIX_AUTH_OAUTH_SCOPE          — optional, space-separated scopes
 *   PREFIX_AUTH_OAUTH_AUDIENCE       — optional (Auth0/Google-style audience)
 *   PREFIX_AUTH_OAUTH_PROVIDER       — optional preset: google | entra | oidc
 *   PREFIX_AUTH_OAUTH_TENANT         — Entra ID tenant (preset=entra)
 */

import type { BackendAuth } from './auth.js';

/** Resolved client-credentials configuration for a backend prefix. */
export interface OAuthConfig {
  /** Explicit token endpoint. Mutually exclusive with `issuer` (token URL wins). */
  tokenUrl?: string;
  /** OIDC issuer for `.well-known/openid-configuration` discovery. */
  issuer?: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
}

interface CachedToken {
  accessToken: string;
  /** Absolute epoch-ms expiry (already includes the server's `expires_in`). */
  expiresAt: number;
}

/** Refresh this many ms before the real expiry to avoid edge-of-expiry races. */
const REFRESH_SAFETY_MS = 60_000;
/** Fallback lifetime when the token endpoint omits `expires_in`. */
const DEFAULT_LIFETIME_MS = 3_600_000;

const tokenCache = new Map<string, CachedToken>();
/** De-dupes concurrent token fetches for the same cache key. */
const inFlight = new Map<string, Promise<string>>();
/** Memoised OIDC discovery results (issuer → token_endpoint). */
const discoveryCache = new Map<string, string>();

/**
 * Read and normalise OAuth client-credentials config for a prefix.
 * Returns `null` when OAuth is not configured for this prefix.
 */
export function readOAuthConfig(prefix: string): OAuthConfig | null {
  const env = (suffix: string) => process.env[`${prefix}_AUTH_OAUTH_${suffix}`]?.trim() || undefined;

  const clientId = env('CLIENT_ID');
  const clientSecret = env('CLIENT_SECRET');
  let tokenUrl = env('TOKEN_URL');
  let issuer = env('ISSUER');
  let scope = env('SCOPE');
  const audience = env('AUDIENCE');
  const provider = env('PROVIDER')?.toLowerCase();

  // ── Provider presets ──────────────────────────────────────────────────
  if (provider === 'entra' || provider === 'azure' || provider === 'azuread') {
    const tenant = env('TENANT');
    if (tenant && !tokenUrl && !issuer) {
      tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    }
    // Entra client-credentials uses scope=<resource>/.default.
    if (!scope && audience) scope = `${audience.replace(/\/$/, '')}/.default`;
  } else if (provider === 'google') {
    if (!tokenUrl && !issuer) tokenUrl = 'https://oauth2.googleapis.com/token';
  } else if (provider === 'oidc') {
    // Discovery-based; issuer must be provided explicitly.
  }

  if (!clientId || !clientSecret) return null;
  if (!tokenUrl && !issuer) return null;

  return { tokenUrl, issuer, clientId, clientSecret, scope, audience };
}

/** Stable cache key for a config (no secrets beyond client id, which is not sensitive). */
function cacheKeyFor(prefix: string, cfg: OAuthConfig): string {
  return [prefix, cfg.tokenUrl ?? cfg.issuer, cfg.clientId, cfg.scope ?? '', cfg.audience ?? ''].join('::');
}

/** Resolve the token endpoint, performing OIDC discovery if only an issuer is set. */
async function resolveTokenEndpoint(cfg: OAuthConfig): Promise<string> {
  if (cfg.tokenUrl) return cfg.tokenUrl;
  const issuer = cfg.issuer!;
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;

  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${res.status} ${res.statusText} — ${discoveryUrl}`);
  }
  const doc = (await res.json()) as { token_endpoint?: string };
  if (!doc.token_endpoint) {
    throw new Error(`OIDC discovery document has no token_endpoint — ${discoveryUrl}`);
  }
  discoveryCache.set(issuer, doc.token_endpoint);
  return doc.token_endpoint;
}

/** Fetch a fresh access token via the client-credentials grant. */
async function requestToken(cfg: OAuthConfig, key: string): Promise<string> {
  const tokenUrl = await resolveTokenEndpoint(cfg);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (cfg.scope) body.set('scope', cfg.scope);
  if (cfg.audience) body.set('audience', cfg.audience);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    // Deliberately terse — never echo the request body (contains the secret).
    throw new Error(`OAuth token request failed: HTTP ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('OAuth token response missing access_token');
  }

  const lifetimeMs = typeof json.expires_in === 'number' ? json.expires_in * 1000 : DEFAULT_LIFETIME_MS;
  tokenCache.set(key, { accessToken: json.access_token, expiresAt: Date.now() + lifetimeMs });
  return json.access_token;
}

/** Return a cached token if still valid, otherwise fetch (de-duping concurrent calls). */
async function getToken(cfg: OAuthConfig, key: string): Promise<string> {
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - REFRESH_SAFETY_MS > Date.now()) {
    return cached.accessToken;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = requestToken(cfg, key).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * Build a lazy OAuth-backed {@link BackendAuth} for a prefix, or `null` if the
 * prefix has no OAuth configuration. The returned auth resolves (and caches /
 * refreshes) a bearer token on each request via `getAuthorization`.
 */
export function buildOAuthAuth(prefix: string): BackendAuth | null {
  const cfg = readOAuthConfig(prefix);
  if (!cfg) return null;
  const key = cacheKeyFor(prefix, cfg);
  return {
    getAuthorization: async () => `Bearer ${await getToken(cfg, key)}`,
  };
}

/** Test/diagnostic helper: clear all cached tokens and discovery results. */
export function clearOAuthCaches(): void {
  tokenCache.clear();
  inFlight.clear();
  discoveryCache.clear();
}
