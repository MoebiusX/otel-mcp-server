import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, sign as cryptoSign, randomUUID } from 'node:crypto';
import { handleJitRequest, ENTERPRISE_PARENT_KEY } from '../src/transports/jit-endpoints.js';
import { JitTokenService, type JitConfig } from '../src/jit.js';
import { EnterpriseAuthService, type EnterpriseAuthConfig } from '../src/enterprise-auth.js';
import type { ClientKey } from '../src/auth.js';

// ─── Mock req / res ──────────────────────────────────────────────────────────

/** Minimal IncomingMessage stand-in that streams an optional body. */
function mockReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): any {
  const req = new EventEmitter() as any;
  req.method = opts.method ?? 'POST';
  req.url = opts.url ?? '/auth/token';
  req.headers = opts.headers ?? {};
  req.destroy = () => {};
  // Emit the body on the next tick so listeners attached in readBody() fire.
  queueMicrotask(() => {
    if (opts.body) req.emit('data', Buffer.from(opts.body, 'utf-8'));
    req.emit('end');
  });
  return req;
}

interface CapturedRes {
  status: number;
  headers: Record<string, string>;
  body: string;
  json(): any;
}

function mockRes(): { res: any; captured: CapturedRes } {
  const captured: CapturedRes = {
    status: 0,
    headers: {},
    body: '',
    json() {
      return JSON.parse(this.body);
    },
  };
  const res: any = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) Object.assign(captured.headers, headers);
      return res;
    },
    end(chunk?: string) {
      if (chunk) captured.body += chunk;
    },
  };
  return { res, captured };
}

// ─── Enterprise key material ─────────────────────────────────────────────────

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_KID = 'k1';
const JWKS = { keys: [{ ...(rsa.publicKey.export({ format: 'jwk' }) as object), kid: RSA_KID, use: 'sig' }] };
const ISSUER = 'https://idp.example.com';
const AUDIENCE = 'https://mcp.example.com';
const T0 = 1_700_000_000_000;

function b64u(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

function makeJag(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(T0 / 1000);
  const header = { alg: 'RS256', typ: 'oauth-id-jag+jwt', kid: RSA_KID };
  const payload = {
    iss: ISSUER,
    sub: 'employee-7',
    aud: AUDIENCE,
    resource: AUDIENCE,
    client_id: 'mcp-client',
    jti: randomUUID(),
    iat: now,
    exp: now + 300,
    scope: 'traces metrics',
    ...overrides,
  };
  for (const k of Object.keys(payload)) if ((payload as any)[k] === null) delete (payload as any)[k];
  const input = `${b64u(header)}.${b64u(payload)}`;
  const sig = cryptoSign('sha256', Buffer.from(input), rsa.privateKey).toString('base64url');
  return `${input}.${sig}`;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const JIT_CONFIG: JitConfig = {
  mode: 'enabled',
  ttlSeconds: 900,
  maxLifetimeSeconds: 3_600,
  maxActiveTokens: 100,
};

const CLIENT_KEYS: ClientKey[] = [
  { id: 'admin', key: 'sk-admin' },
  { id: 'ci', key: 'sk-ci', allowedTools: ['traces', 'metrics'] },
];

const ENABLED = ['traces', 'metrics', 'logs', 'grafana'];

const ENTERPRISE_CONFIG: EnterpriseAuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  resource: AUDIENCE,
  jwksUrl: `${ISSUER}/jwks`,
  defaultScopes: [],
  maxRedeemedJtis: 50_000,
};

function ctx(overrides: { withEnterprise?: boolean; noService?: boolean; clock?: { now: number } } = {}) {
  const clock = overrides.clock ?? { now: T0 };
  const service = overrides.noService ? null : new JitTokenService(JIT_CONFIG, { now: () => clock.now });
  const enterprise = overrides.withEnterprise
    ? new EnterpriseAuthService(ENTERPRISE_CONFIG, {
        now: () => clock.now,
        fetchJson: async () => JWKS,
      })
    : null;
  return {
    ctx: { service, enterprise, clientKeys: CLIENT_KEYS, enabledSkillIds: ENABLED },
    service,
    enterprise,
    clock,
  };
}

async function call(reqOpts: Parameters<typeof mockReq>[0], c: any) {
  const req = mockReq(reqOpts);
  const { res, captured } = mockRes();
  const handled = await handleJitRequest(req, res, c);
  return { handled, ...captured };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Routing ─────────────────────────────────────────────────────────────────

describe('handleJitRequest routing', () => {
  it('ignores non-/auth paths', async () => {
    const { ctx: c } = ctx();
    const r = await call({ url: '/mcp' }, c);
    expect(r.handled).toBe(false);
  });

  it('answers /auth/* with 404 when JIT is disabled', async () => {
    const { ctx: c } = ctx({ noService: true });
    const r = await call({ url: '/auth/token' }, c);
    expect(r.handled).toBe(true);
    expect(r.status).toBe(404);
    expect(r.json().message).toMatch(/disabled/i);
  });

  it('rejects non-POST methods with 405', async () => {
    const { ctx: c } = ctx();
    const r = await call({ method: 'GET', url: '/auth/token' }, c);
    expect(r.status).toBe(405);
  });

  it('returns 404 for an unknown /auth subpath', async () => {
    const { ctx: c } = ctx();
    const r = await call({ url: '/auth/token/bogus', headers: { authorization: 'Bearer sk-admin' }, body: '{}' }, c);
    expect(r.status).toBe(404);
  });

  it('strips the query string before matching', async () => {
    const { ctx: c } = ctx();
    const r = await call({ url: '/auth/token?foo=1', headers: { authorization: 'Bearer sk-admin' }, body: '{}' }, c);
    expect(r.status).toBe(201);
  });
});

// ─── Mint (static key) ───────────────────────────────────────────────────────

describe('POST /auth/token (static key)', () => {
  it('mints a scoped token for a valid key', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-ci' }, body: JSON.stringify({ scopes: ['traces'] }) }, c);
    expect(r.status).toBe(201);
    const b = r.json();
    expect(b.token).toMatch(/^mcpj_/);
    expect(b.scopes).toEqual(['traces']);
    expect(b.token_type).toBe('Bearer');
    expect(b.parent_key).toBe('ci');
  });

  it('accepts the X-API-Key header', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { 'x-api-key': 'sk-admin' }, body: '{}' }, c);
    expect(r.status).toBe(201);
  });

  it('rejects an invalid key with 401', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-nope' }, body: '{}' }, c);
    expect(r.status).toBe(401);
    expect(r.json().reason).toBe('invalid_parent_key');
  });

  it('rejects scope escalation with 403', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-ci' }, body: JSON.stringify({ scopes: ['grafana'] }) }, c);
    expect(r.status).toBe(403);
    expect(r.json().reason).toBe('scope_violation');
  });

  it('forbids a JIT token minting another token', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    const r = await call({ headers: { authorization: `Bearer ${issued.token}` }, body: '{}' }, c);
    expect(r.status).toBe(403);
    expect(r.json().reason).toBe('token_minting_with_token');
  });

  it('rejects a non-array scopes field with 400', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-admin' }, body: JSON.stringify({ scopes: 'traces' }) }, c);
    expect(r.status).toBe(400);
  });

  it('rejects a non-number ttlSeconds with 400', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-admin' }, body: JSON.stringify({ ttlSeconds: 'soon' }) }, c);
    expect(r.status).toBe(400);
  });

  it('honours a requested ttl within the cap', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-admin' }, body: JSON.stringify({ ttlSeconds: 120 }) }, c);
    expect(r.json().expires_in).toBe(120);
  });

  it('surfaces capacity exhaustion as 429', async () => {
    const clock = { now: T0 };
    const service = new JitTokenService({ ...JIT_CONFIG, maxActiveTokens: 1 }, { now: () => clock.now });
    const c = { service, enterprise: null, clientKeys: CLIENT_KEYS, enabledSkillIds: ENABLED };
    await call({ headers: { authorization: 'Bearer sk-admin' }, body: '{}' }, c);
    const r = await call({ headers: { authorization: 'Bearer sk-admin' }, body: '{}' }, c);
    expect(r.status).toBe(429);
  });
});

// ─── Body parsing ────────────────────────────────────────────────────────────

describe('request body parsing', () => {
  it('treats an empty body as {}', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-admin' } }, c);
    expect(r.status).toBe(201);
  });

  it('rejects invalid JSON with 400', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-admin' }, body: '{not json' }, c);
    expect(r.status).toBe(400);
  });

  it('rejects a JSON array body with 400', async () => {
    const { ctx: c } = ctx();
    const r = await call({ headers: { authorization: 'Bearer sk-admin' }, body: '[1,2,3]' }, c);
    expect(r.status).toBe(400);
  });

  it('parses application/x-www-form-urlencoded bodies', async () => {
    const { ctx: c, enterprise } = ctx({ withEnterprise: true });
    void enterprise;
    const jag = makeJag();
    const r = await call(
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jag)}`,
      },
      c,
    );
    expect(r.status).toBe(200);
  });

  it('rejects an oversized body with 413', async () => {
    const { ctx: c } = ctx();
    const big = 'x'.repeat(20_000);
    const r = await call({ headers: { authorization: 'Bearer sk-admin' }, body: JSON.stringify({ scopes: [big] }) }, c);
    expect(r.status).toBe(413);
  });
});

// ─── Enterprise grant (ID-JAG) ───────────────────────────────────────────────

describe('POST /auth/token (jwt-bearer / ID-JAG)', () => {
  const GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

  it('exchanges a valid ID-JAG for an access token (RFC 6749 shape)', async () => {
    const { ctx: c } = ctx({ withEnterprise: true });
    const r = await call(
      { body: JSON.stringify({ grant_type: GRANT, assertion: makeJag(), client_id: 'mcp-client' }) },
      c,
    );
    expect(r.status).toBe(200);
    expect(r.headers['Cache-Control']).toBe('no-store');
    const b = r.json();
    expect(b.access_token).toMatch(/^mcpj_/);
    expect(b.token_type).toBe('Bearer');
    expect(b.scope).toBe('metrics traces');
    expect(b.expires_in).toBe(900);
  });

  it('mints under the enterprise parent-key label', async () => {
    const { ctx: c, service } = ctx({ withEnterprise: true });
    const r = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: makeJag() }) }, c);
    const tokenId = r.json().token_id;
    expect((await service!.get(tokenId))!.parentKeyId).toBe(ENTERPRISE_PARENT_KEY);
  });

  it('returns unsupported_grant_type when enterprise auth is not configured', async () => {
    const { ctx: c } = ctx(); // no enterprise
    const r = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: makeJag() }) }, c);
    expect(r.status).toBe(400);
    expect(r.json().error).toBe('unsupported_grant_type');
  });

  it('returns unsupported_grant_type for an unknown grant', async () => {
    const { ctx: c } = ctx({ withEnterprise: true });
    const r = await call({ body: JSON.stringify({ grant_type: 'authorization_code', code: 'x' }) }, c);
    expect(r.status).toBe(400);
    expect(r.json().error).toBe('unsupported_grant_type');
  });

  it('returns invalid_request when the assertion is missing', async () => {
    const { ctx: c } = ctx({ withEnterprise: true });
    const r = await call({ body: JSON.stringify({ grant_type: GRANT }) }, c);
    expect(r.status).toBe(400);
    expect(r.json().error).toBe('invalid_request');
  });

  it('returns invalid_grant for a tampered assertion', async () => {
    const { ctx: c } = ctx({ withEnterprise: true });
    const r = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: makeJag() + 'x' }) }, c);
    expect(r.status).toBe(400);
    expect(r.json().error).toBe('invalid_grant');
  });

  it('returns invalid_grant on assertion replay', async () => {
    const { ctx: c } = ctx({ withEnterprise: true });
    const jag = makeJag();
    await call({ body: JSON.stringify({ grant_type: GRANT, assertion: jag }) }, c);
    const r = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: jag }) }, c);
    expect(r.status).toBe(400);
    expect(r.json().error_description).toMatch(/redeemed/i);
  });

  it('returns invalid_scope when the assertion scope matches no enabled skill', async () => {
    const { ctx: c } = ctx({ withEnterprise: true });
    const r = await call(
      { body: JSON.stringify({ grant_type: GRANT, assertion: makeJag({ scope: 'kubernetes clickhouse' }) }) },
      c,
    );
    expect(r.status).toBe(400);
    expect(r.json().error).toBe('invalid_scope');
  });

  it('maps a JIT capacity error to an OAuth server_error', async () => {
    const clock = { now: T0 };
    const service = new JitTokenService({ ...JIT_CONFIG, maxActiveTokens: 1 }, { now: () => clock.now });
    const enterprise = new EnterpriseAuthService(ENTERPRISE_CONFIG, {
      now: () => clock.now,
      fetchJson: async () => JWKS,
    });
    const c = { service, enterprise, clientKeys: CLIENT_KEYS, enabledSkillIds: ENABLED };
    await call({ body: JSON.stringify({ grant_type: GRANT, assertion: makeJag() }) }, c);
    const r = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: makeJag() }) }, c);
    expect(r.status).toBe(500);
    expect(r.json().error).toBe('server_error');
  });
});

// ─── Refresh ─────────────────────────────────────────────────────────────────

describe('POST /auth/token/refresh', () => {
  it('rotates a live token', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    const r = await call({ url: '/auth/token/refresh', headers: { authorization: `Bearer ${issued.token}` } }, c);
    expect(r.status).toBe(201);
    expect(r.json().generation).toBe(1);
  });

  it('rejects a non-token credential with 401', async () => {
    const { ctx: c } = ctx();
    const r = await call({ url: '/auth/token/refresh', headers: { authorization: 'Bearer sk-admin' } }, c);
    expect(r.status).toBe(401);
  });

  it('rejects a missing credential with 401', async () => {
    const { ctx: c } = ctx();
    const r = await call({ url: '/auth/token/refresh' }, c);
    expect(r.status).toBe(401);
  });

  it('maps a revoked-token refresh to its JitError status', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    await service!.revoke(issued.token);
    const r = await call({ url: '/auth/token/refresh', headers: { authorization: `Bearer ${issued.token}` } }, c);
    expect(r.status).toBe(401);
  });

  it('returns 409 Conflict when re-refreshing an already-rotated token', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    await service!.refresh(issued.token); // first rotation
    const r = await call({ url: '/auth/token/refresh', headers: { authorization: `Bearer ${issued.token}` } }, c);
    expect(r.status).toBe(409);
    expect(r.json().error).toBe('Conflict');
    expect(r.json().reason).toBe('rotated');
  });

  it('denies refresh once the parent key has been removed (access-review cascade)', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    const withoutCi = { ...c, clientKeys: c.clientKeys.filter((k: ClientKey) => k.id !== 'ci') };
    const r = await call({ url: '/auth/token/refresh', headers: { authorization: `Bearer ${issued.token}` } }, withoutCi);
    expect(r.status).toBe(403);
    expect(r.json().reason).toBe('parent_key_revoked');
  });

  it('denies refresh once the parent key no longer grants the token scopes', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces', 'metrics'], enabledSkillIds: ENABLED });
    const narrowed = {
      ...c,
      clientKeys: c.clientKeys.map((k: ClientKey) => (k.id === 'ci' ? { ...k, allowedTools: ['logs'] } : k)),
    };
    const r = await call({ url: '/auth/token/refresh', headers: { authorization: `Bearer ${issued.token}` } }, narrowed);
    expect(r.status).toBe(403);
    expect(r.json().reason).toBe('scope_violation');
  });

  it('enterprise-minted tokens refresh without a local parent key', async () => {
    const { ctx: c, service } = ctx({ withEnterprise: true });
    const grant = await call(
      { body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: makeJag() }) },
      c,
    );
    const token = grant.json().access_token;
    void service;
    const r = await call({ url: '/auth/token/refresh', headers: { authorization: `Bearer ${token}` } }, c);
    expect(r.status).toBe(201);
  });
});

// ─── Revoke ──────────────────────────────────────────────────────────────────

describe('POST /auth/token/revoke', () => {
  it('self-revokes with the token', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    const r = await call({ url: '/auth/token/revoke', headers: { authorization: `Bearer ${issued.token}` } }, c);
    expect(r.status).toBe(200);
    expect(r.json().revoked).toBe(true);
    expect((await service!.validate(issued.token)).ok).toBe(false);
  });

  it('admin-revokes by token_id with a static key', async () => {
    const { ctx: c, service } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    const r = await call(
      {
        url: '/auth/token/revoke',
        headers: { authorization: 'Bearer sk-admin' },
        body: JSON.stringify({ token_id: issued.record.id }),
      },
      c,
    );
    expect(r.status).toBe(200);
    expect(r.json().token_id).toBe(issued.record.id);
  });

  it('returns 404 revoking an unknown token_id', async () => {
    const { ctx: c } = ctx();
    const r = await call(
      { url: '/auth/token/revoke', headers: { authorization: 'Bearer sk-admin' }, body: JSON.stringify({ token_id: 'ghost' }) },
      c,
    );
    expect(r.status).toBe(404);
  });

  it('rejects admin revoke without a token_id (400)', async () => {
    const { ctx: c } = ctx();
    const r = await call({ url: '/auth/token/revoke', headers: { authorization: 'Bearer sk-admin' }, body: '{}' }, c);
    expect(r.status).toBe(400);
  });

  it('rejects revoke with no credential at all (401)', async () => {
    const { ctx: c } = ctx();
    const r = await call({ url: '/auth/token/revoke', body: '{}' }, c);
    expect(r.status).toBe(401);
  });

  it('a restricted key may not revoke another key\'s token (403)', async () => {
    const { ctx: c, service } = ctx();
    const adminToken = await service!.issue({ parentKeyId: 'admin', grantableScopes: null, enabledSkillIds: ENABLED });
    const r = await call(
      {
        url: '/auth/token/revoke',
        headers: { authorization: 'Bearer sk-ci' }, // 'ci' is scope-restricted
        body: JSON.stringify({ token_id: adminToken.record.id }),
      },
      c,
    );
    expect(r.status).toBe(403);
    // The admin token is untouched.
    expect((await service!.validate(adminToken.token)).ok).toBe(true);
  });

  it('a restricted key may revoke its own tokens', async () => {
    const { ctx: c, service } = ctx();
    const own = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    const r = await call(
      {
        url: '/auth/token/revoke',
        headers: { authorization: 'Bearer sk-ci' },
        body: JSON.stringify({ token_id: own.record.id }),
      },
      c,
    );
    expect(r.status).toBe(200);
  });

  it('admin-revokes a whole lineage by root_id', async () => {
    const { ctx: c, service, clock } = ctx();
    const issued = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    clock.now += 60_000;
    const rotated = await service!.refresh(issued.token);

    const r = await call(
      {
        url: '/auth/token/revoke',
        headers: { authorization: 'Bearer sk-admin' },
        body: JSON.stringify({ root_id: issued.record.id }),
      },
      c,
    );
    expect(r.status).toBe(200);
    expect(r.json().root_id).toBe(issued.record.id);
    expect(r.json().token_ids).toContain(rotated.record.id);
    expect((await service!.validate(rotated.token)).ok).toBe(false);
  });

  it('returns 404 for a lineage with no live tokens', async () => {
    const { ctx: c } = ctx();
    const r = await call(
      { url: '/auth/token/revoke', headers: { authorization: 'Bearer sk-admin' }, body: JSON.stringify({ root_id: 'ghost' }) },
      c,
    );
    expect(r.status).toBe(404);
  });

  it('a restricted key cannot kill another key\'s lineage AFTER it has rotated', async () => {
    // Regression (auth bypass): ownership was resolved with get(rootId), but
    // the generation-0 record whose id IS the rootId is pruned on the second
    // rotation. The `target &&` guard then short-circuited to "allowed" while
    // revokeLineage still worked off the lineage index — so any restricted key
    // could kill any other key's live session once it had rotated twice, which
    // is the steady state for every refresh-using client.
    const { ctx: c, service, clock } = ctx();
    const victim = await service!.issue({ parentKeyId: 'admin', grantableScopes: null, enabledSkillIds: ENABLED });

    clock.now += 60_000;
    const gen1 = await service!.refresh(victim.token);
    clock.now += 60_000;
    const gen2 = await service!.refresh(gen1.token);

    // The gen-0 record is gone; only the lineage index still knows the owner.
    expect(await service!.get(victim.record.id)).toBeUndefined();

    const attack = await call(
      {
        url: '/auth/token/revoke',
        headers: { authorization: 'Bearer sk-ci' }, // scope-restricted key
        body: JSON.stringify({ root_id: victim.record.id }),
      },
      c,
    );
    expect(attack.status).toBe(403);
    expect(attack.json().reason).toBe('scope_violation');
    // The victim's live token must be untouched.
    expect((await service!.validate(gen2.token)).ok).toBe(true);
  });

  it('a restricted key can still kill its OWN rotated lineage', async () => {
    const { ctx: c, service, clock } = ctx();
    const own = await service!.issue({ parentKeyId: 'ci', grantableScopes: ['traces'], enabledSkillIds: ENABLED });
    clock.now += 60_000;
    const gen1 = await service!.refresh(own.token);
    clock.now += 60_000;
    await service!.refresh(gen1.token);

    const r = await call(
      {
        url: '/auth/token/revoke',
        headers: { authorization: 'Bearer sk-ci' },
        body: JSON.stringify({ root_id: own.record.id }),
      },
      c,
    );
    expect(r.status).toBe(200);
    expect(await service!.activeCount()).toBe(0);
  });
});

// ─── Single-use un-burn on issuance failure ──────────────────────────────────

describe('ID-JAG un-redeem on downstream failure', () => {
  const GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

  it('a capacity failure does not burn the assertion — retry succeeds after space frees', async () => {
    const clock = { now: T0 };
    const service = new JitTokenService({ ...JIT_CONFIG, maxActiveTokens: 1 }, { now: () => clock.now });
    const enterprise = new EnterpriseAuthService(ENTERPRISE_CONFIG, {
      now: () => clock.now,
      fetchJson: async () => JWKS,
    });
    const c = { service, enterprise, clientKeys: CLIENT_KEYS, enabledSkillIds: ENABLED };

    const filler = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: makeJag() }) }, c);
    expect(filler.status).toBe(200);

    const jag = makeJag();
    const denied = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: jag }) }, c);
    expect(denied.status).toBe(500); // capacity → server_error

    // Free capacity, then retry the SAME assertion: it must not be 'replayed'.
    await service.revokeById(filler.json().token_id);
    const retry = await call({ body: JSON.stringify({ grant_type: GRANT, assertion: jag }) }, c);
    expect(retry.status).toBe(200);
  });
});
