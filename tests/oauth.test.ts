import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readOAuthConfig,
  buildOAuthAuth,
  clearOAuthCaches,
} from '../src/oauth.js';
import { buildAuth, resolveAuthHeaders } from '../src/auth.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** A fetch mock that records calls and returns a queued sequence of responses. */
function tokenFetch(responses: Array<{ ok?: boolean; status?: number; body: any }>) {
  const calls: Array<{ url: string; body: string }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init?: any) => {
    calls.push({ url, body: String(init?.body ?? '') });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.status === 401 ? 'Unauthorized' : 'OK',
      json: async () => r.body,
    } as any;
  });
  return { fn, calls };
}

const OAUTH_KEYS = [
  'CLIENT_ID', 'CLIENT_SECRET', 'TOKEN_URL', 'ISSUER',
  'SCOPE', 'AUDIENCE', 'PROVIDER', 'TENANT',
];

function clearPrefix(prefix: string) {
  for (const k of OAUTH_KEYS) delete process.env[`${prefix}_AUTH_OAUTH_${k}`];
}

// ─── readOAuthConfig ─────────────────────────────────────────────────────────

describe('readOAuthConfig', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('returns null when not configured', () => {
    expect(readOAuthConfig('PROM')).toBeNull();
  });

  it('returns null when client id/secret missing', () => {
    process.env.PROM_AUTH_OAUTH_TOKEN_URL = 'https://idp/token';
    expect(readOAuthConfig('PROM')).toBeNull();
  });

  it('reads explicit token-url config', () => {
    process.env.PROM_AUTH_OAUTH_TOKEN_URL = 'https://idp/token';
    process.env.PROM_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.PROM_AUTH_OAUTH_CLIENT_SECRET = 'sec';
    process.env.PROM_AUTH_OAUTH_SCOPE = 'metrics:read';
    const cfg = readOAuthConfig('PROM');
    expect(cfg).toEqual({
      tokenUrl: 'https://idp/token',
      issuer: undefined,
      clientId: 'cid',
      clientSecret: 'sec',
      scope: 'metrics:read',
      audience: undefined,
    });
  });

  it('derives Entra token URL + .default scope from tenant + audience', () => {
    process.env.LOKI_AUTH_OAUTH_PROVIDER = 'entra';
    process.env.LOKI_AUTH_OAUTH_TENANT = 'tenant-123';
    process.env.LOKI_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.LOKI_AUTH_OAUTH_CLIENT_SECRET = 'sec';
    process.env.LOKI_AUTH_OAUTH_AUDIENCE = 'api://my-resource';
    const cfg = readOAuthConfig('LOKI')!;
    expect(cfg.tokenUrl).toBe('https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token');
    expect(cfg.scope).toBe('api://my-resource/.default');
  });

  it('uses Google token endpoint preset', () => {
    process.env.X_AUTH_OAUTH_PROVIDER = 'google';
    process.env.X_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.X_AUTH_OAUTH_CLIENT_SECRET = 'sec';
    const cfg = readOAuthConfig('X')!;
    expect(cfg.tokenUrl).toBe('https://oauth2.googleapis.com/token');
  });

  it('accepts issuer for OIDC discovery', () => {
    process.env.Y_AUTH_OAUTH_ISSUER = 'https://issuer.example.com';
    process.env.Y_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.Y_AUTH_OAUTH_CLIENT_SECRET = 'sec';
    const cfg = readOAuthConfig('Y')!;
    expect(cfg.issuer).toBe('https://issuer.example.com');
    expect(cfg.tokenUrl).toBeUndefined();
  });
});

// ─── token acquisition / caching / refresh ──────────────────────────────────

describe('buildOAuthAuth — token acquisition', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    clearPrefix('PROM');
    clearOAuthCaches();
    vi.useRealTimers();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function configurePrefix(prefix = 'PROM') {
    process.env[`${prefix}_AUTH_OAUTH_TOKEN_URL`] = 'https://idp/token';
    process.env[`${prefix}_AUTH_OAUTH_CLIENT_ID`] = 'cid';
    process.env[`${prefix}_AUTH_OAUTH_CLIENT_SECRET`] = 'sec';
    process.env[`${prefix}_AUTH_OAUTH_SCOPE`] = 'metrics:read';
  }

  it('fetches a bearer token via client-credentials grant', async () => {
    configurePrefix();
    const { fn, calls } = tokenFetch([{ body: { access_token: 'tok-1', expires_in: 3600 } }]);
    vi.stubGlobal('fetch', fn);

    const auth = buildOAuthAuth('PROM')!;
    const header = await auth.getAuthorization!();

    expect(header).toBe('Bearer tok-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://idp/token');
    expect(calls[0].body).toContain('grant_type=client_credentials');
    expect(calls[0].body).toContain('client_id=cid');
    expect(calls[0].body).toContain('scope=metrics%3Aread');
  });

  it('caches the token across calls (no second fetch)', async () => {
    configurePrefix();
    const { fn, calls } = tokenFetch([{ body: { access_token: 'tok-cache', expires_in: 3600 } }]);
    vi.stubGlobal('fetch', fn);

    const auth = buildOAuthAuth('PROM')!;
    await auth.getAuthorization!();
    await auth.getAuthorization!();
    await auth.getAuthorization!();

    expect(calls).toHaveLength(1);
  });

  it('refreshes when the cached token is within the safety window', async () => {
    configurePrefix();
    // First token expires almost immediately (10s < 60s safety window) → refetch.
    const { fn, calls } = tokenFetch([
      { body: { access_token: 'tok-old', expires_in: 10 } },
      { body: { access_token: 'tok-new', expires_in: 3600 } },
    ]);
    vi.stubGlobal('fetch', fn);

    const auth = buildOAuthAuth('PROM')!;
    const first = await auth.getAuthorization!();
    const second = await auth.getAuthorization!();

    expect(first).toBe('Bearer tok-old');
    expect(second).toBe('Bearer tok-new');
    expect(calls).toHaveLength(2);
  });

  it('de-dupes concurrent token fetches', async () => {
    configurePrefix();
    const { fn, calls } = tokenFetch([{ body: { access_token: 'tok-concurrent', expires_in: 3600 } }]);
    vi.stubGlobal('fetch', fn);

    const auth = buildOAuthAuth('PROM')!;
    const [a, b, c] = await Promise.all([
      auth.getAuthorization!(),
      auth.getAuthorization!(),
      auth.getAuthorization!(),
    ]);

    expect([a, b, c]).toEqual(['Bearer tok-concurrent', 'Bearer tok-concurrent', 'Bearer tok-concurrent']);
    expect(calls).toHaveLength(1);
  });

  it('throws a secret-free error on token endpoint failure', async () => {
    configurePrefix();
    const { fn } = tokenFetch([{ ok: false, status: 401, body: { error: 'invalid_client' } }]);
    vi.stubGlobal('fetch', fn);

    const auth = buildOAuthAuth('PROM')!;
    await expect(auth.getAuthorization!()).rejects.toThrow(/OAuth token request failed: HTTP 401/);
    await expect(auth.getAuthorization!()).rejects.not.toThrow(/sec/); // no secret in message
  });

  it('throws when access_token is missing', async () => {
    configurePrefix();
    const { fn } = tokenFetch([{ body: { token_type: 'Bearer' } }]);
    vi.stubGlobal('fetch', fn);

    const auth = buildOAuthAuth('PROM')!;
    await expect(auth.getAuthorization!()).rejects.toThrow(/missing access_token/);
  });
});

// ─── OIDC discovery ──────────────────────────────────────────────────────────

describe('buildOAuthAuth — OIDC discovery', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    clearPrefix('DISCO');
    clearOAuthCaches();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('discovers the token endpoint from the issuer, then fetches a token', async () => {
    process.env.DISCO_AUTH_OAUTH_ISSUER = 'https://issuer.example.com';
    process.env.DISCO_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.DISCO_AUTH_OAUTH_CLIENT_SECRET = 'sec';

    const calls: string[] = [];
    const fn = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ token_endpoint: 'https://issuer.example.com/oauth/token' }) } as any;
      }
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ access_token: 'disco-tok', expires_in: 3600 }) } as any;
    });
    vi.stubGlobal('fetch', fn);

    const auth = buildOAuthAuth('DISCO')!;
    const header = await auth.getAuthorization!();

    expect(header).toBe('Bearer disco-tok');
    expect(calls[0]).toBe('https://issuer.example.com/.well-known/openid-configuration');
    expect(calls[1]).toBe('https://issuer.example.com/oauth/token');
  });
});

// ─── integration with buildAuth / resolveAuthHeaders ─────────────────────────

describe('buildAuth integration', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    clearPrefix('PROM');
    clearOAuthCaches();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('static _AUTH_TOKEN takes precedence over OAuth config', () => {
    process.env.PROM_AUTH_TOKEN = 'static-token';
    process.env.PROM_AUTH_OAUTH_TOKEN_URL = 'https://idp/token';
    process.env.PROM_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.PROM_AUTH_OAUTH_CLIENT_SECRET = 'sec';
    const auth = buildAuth('PROM');
    expect(auth.authorization).toBe('Bearer static-token');
    expect(auth.getAuthorization).toBeUndefined();
  });

  it('falls back to OAuth when no static vars are set', () => {
    process.env.PROM_AUTH_OAUTH_TOKEN_URL = 'https://idp/token';
    process.env.PROM_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.PROM_AUTH_OAUTH_CLIENT_SECRET = 'sec';
    const auth = buildAuth('PROM');
    expect(auth.authorization).toBeUndefined();
    expect(typeof auth.getAuthorization).toBe('function');
  });

  it('resolveAuthHeaders awaits the OAuth token and merges extra headers', async () => {
    process.env.PROM_AUTH_OAUTH_TOKEN_URL = 'https://idp/token';
    process.env.PROM_AUTH_OAUTH_CLIENT_ID = 'cid';
    process.env.PROM_AUTH_OAUTH_CLIENT_SECRET = 'sec';
    const { fn } = tokenFetch([{ body: { access_token: 'merged-tok', expires_in: 3600 } }]);
    vi.stubGlobal('fetch', fn);

    const auth = buildAuth('PROM');
    auth.extraHeaders = { 'X-Scope-OrgID': 'tenant-9' };
    const headers = await resolveAuthHeaders(auth);

    expect(headers).toEqual({
      Authorization: 'Bearer merged-tok',
      'X-Scope-OrgID': 'tenant-9',
    });
  });
});
