import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import {
  readEnterpriseAuthConfig,
  EnterpriseAuthService,
  OAuthTokenError,
  authorizationServerMetadata,
  protectedResourceMetadata,
  ID_JAG_GRANT_PROFILE,
  JWT_BEARER_GRANT,
  type EnterpriseAuthConfig,
} from '../src/enterprise-auth.js';
import { MemoryDenylist } from '../src/jit-store.js';

// ─── Key material & assertion factory ────────────────────────────────────────

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsa2 = generateKeyPairSync('rsa', { modulusLength: 2048 }); // untrusted key
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ed = generateKeyPairSync('ed25519');

const RSA_KID = 'rsa-key-1';
const EC_KID = 'ec-key-1';
const ED_KID = 'ed-key-1';

const JWKS = {
  keys: [
    { ...(rsa.publicKey.export({ format: 'jwk' }) as object), kid: RSA_KID, use: 'sig' },
    { ...(ec.publicKey.export({ format: 'jwk' }) as object), kid: EC_KID, use: 'sig' },
    { ...(ed.publicKey.export({ format: 'jwk' }) as object), kid: ED_KID, use: 'sig' },
  ],
};

const ISSUER = 'https://idp.example.com';
const AUDIENCE = 'https://mcp.example.com';
const BASE_CONFIG: EnterpriseAuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  resource: AUDIENCE,
  jwksUrl: `${ISSUER}/jwks`,
  defaultScopes: [],
  maxRedeemedJtis: 50_000,
};

const T0 = 1_700_000_000_000;

function b64u(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

let jtiCounter = 0;

interface JagOptions {
  alg?: 'RS256' | 'ES256' | 'EdDSA' | 'HS256' | 'none';
  kid?: string | undefined;
  typ?: string;
  key?: KeyObject;
  payload?: Record<string, unknown>;
}

/** Build a signed ID-JAG with sane defaults; override any claim/header. */
function makeJag(opts: JagOptions = {}): string {
  const alg = opts.alg ?? 'RS256';
  const header: Record<string, unknown> = {
    alg,
    typ: opts.typ ?? 'oauth-id-jag+jwt',
  };
  // `'kid' in opts` (even = undefined) means the caller wants to control it;
  // passing `{ kid: undefined }` omits the kid header entirely.
  if ('kid' in opts) {
    if (opts.kid !== undefined) header.kid = opts.kid;
  } else if (alg === 'ES256') header.kid = EC_KID;
  else if (alg === 'EdDSA') header.kid = ED_KID;
  else header.kid = RSA_KID;

  const payload = {
    iss: ISSUER,
    sub: 'user-42',
    aud: AUDIENCE,
    resource: AUDIENCE,
    client_id: 'mcp-client-1',
    jti: `jag-${++jtiCounter}`,
    iat: Math.floor(T0 / 1000),
    exp: Math.floor(T0 / 1000) + 300,
    scope: 'traces metrics',
    ...opts.payload,
  };

  const signingInput = `${b64u(header)}.${b64u(payload)}`;
  if (alg === 'none') return `${signingInput}.`;
  const defaultKey = alg === 'ES256' ? ec.privateKey : alg === 'EdDSA' ? ed.privateKey : rsa.privateKey;
  const key = opts.key ?? defaultKey;
  let signature: Buffer;
  if (alg === 'ES256') {
    signature = cryptoSign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  } else if (alg === 'EdDSA') {
    // Ed25519: null algorithm, hash is intrinsic.
    signature = cryptoSign(null, Buffer.from(signingInput), key);
  } else {
    signature = cryptoSign('sha256', Buffer.from(signingInput), key);
  }
  return `${signingInput}.${signature.toString('base64url')}`;
}

function rig(configOverrides: Partial<EnterpriseAuthConfig> = {}) {
  const clock = { now: T0 };
  const fetches: string[] = [];
  let jwksDoc: unknown = JWKS;
  let failFetch = false;
  const service = new EnterpriseAuthService(
    { ...BASE_CONFIG, ...configOverrides },
    {
      now: () => clock.now,
      fetchJson: async (url: string) => {
        fetches.push(url);
        if (failFetch) throw new Error('jwks endpoint down');
        if (url.endsWith('/.well-known/openid-configuration')) {
          return { jwks_uri: `${ISSUER}/jwks` };
        }
        return jwksDoc;
      },
    },
  );
  return {
    clock,
    fetches,
    service,
    setJwks: (doc: unknown) => { jwksDoc = doc; },
    setFail: (v: boolean) => { failFetch = v; },
  };
}

async function expectOAuthError(p: Promise<unknown>, reason: string): Promise<OAuthTokenError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(OAuthTokenError);
    expect((err as OAuthTokenError).reason).toBe(reason);
    return err as OAuthTokenError;
  }
  return expect.unreachable(`expected OAuthTokenError(${reason})`) as never;
}

// ─── Config ──────────────────────────────────────────────────────────────────

describe('readEnterpriseAuthConfig', () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k];

  it('returns null unless issuer AND audience are set', () => {
    expect(readEnterpriseAuthConfig(env({}))).toBeNull();
    expect(readEnterpriseAuthConfig(env({ MCP_ENTERPRISE_AUTH_ISSUER: ISSUER }))).toBeNull();
    expect(readEnterpriseAuthConfig(env({ MCP_ENTERPRISE_AUTH_AUDIENCE: AUDIENCE }))).toBeNull();
  });

  it('defaults resource to the audience and parses default scopes', () => {
    const cfg = readEnterpriseAuthConfig(
      env({
        MCP_ENTERPRISE_AUTH_ISSUER: ISSUER,
        MCP_ENTERPRISE_AUTH_AUDIENCE: AUDIENCE,
        MCP_ENTERPRISE_AUTH_DEFAULT_SCOPES: 'traces, metrics logs',
      }),
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.resource).toBe(AUDIENCE);
    expect(cfg!.jwksUrl).toBeUndefined();
    expect(cfg!.defaultScopes).toEqual(['traces', 'metrics', 'logs']);
  });

  it('requires https for issuer and JWKS URLs (loopback http allowed)', () => {
    const base = { MCP_ENTERPRISE_AUTH_ISSUER: ISSUER, MCP_ENTERPRISE_AUTH_AUDIENCE: AUDIENCE };
    expect(() =>
      readEnterpriseAuthConfig(env({ ...base, MCP_ENTERPRISE_AUTH_ISSUER: 'http://idp.example.com' })),
    ).toThrow(/https/);
    expect(() =>
      readEnterpriseAuthConfig(env({ ...base, MCP_ENTERPRISE_AUTH_JWKS_URL: 'http://idp.example.com/jwks' })),
    ).toThrow(/https/);
    // Loopback http is fine for local IdP simulators.
    expect(
      readEnterpriseAuthConfig(env({ ...base, MCP_ENTERPRISE_AUTH_ISSUER: 'http://localhost:8080' })),
    ).not.toBeNull();
    expect(
      readEnterpriseAuthConfig(env({ ...base, MCP_ENTERPRISE_AUTH_JWKS_URL: 'http://127.0.0.1:8080/jwks' })),
    ).not.toBeNull();
  });

  it('defaults and env-drives the redeemed-jti cap', () => {
    const base = { MCP_ENTERPRISE_AUTH_ISSUER: ISSUER, MCP_ENTERPRISE_AUTH_AUDIENCE: AUDIENCE };
    expect(readEnterpriseAuthConfig(env(base))!.maxRedeemedJtis).toBe(50_000);
    expect(
      readEnterpriseAuthConfig(env({ ...base, MCP_ENTERPRISE_AUTH_MAX_REDEEMED_JTIS: '250' }))!.maxRedeemedJtis,
    ).toBe(250);
    // Garbage / out-of-range falls back to the default.
    expect(
      readEnterpriseAuthConfig(env({ ...base, MCP_ENTERPRISE_AUTH_MAX_REDEEMED_JTIS: '0' }))!.maxRedeemedJtis,
    ).toBe(50_000);
    expect(
      readEnterpriseAuthConfig(env({ ...base, MCP_ENTERPRISE_AUTH_MAX_REDEEMED_JTIS: 'lots' }))!.maxRedeemedJtis,
    ).toBe(50_000);
  });
});

// ─── Happy paths ─────────────────────────────────────────────────────────────

describe('EnterpriseAuthService.verifyIdJag', () => {
  it('accepts a valid RS256 assertion and extracts identity + scopes', async () => {
    const { service } = rig();
    const verified = await service.verifyIdJag(makeJag(), 'mcp-client-1');
    expect(verified.sub).toBe('user-42');
    expect(verified.iss).toBe(ISSUER);
    expect(verified.clientId).toBe('mcp-client-1');
    expect(verified.scopes).toEqual(['traces', 'metrics']);
    expect(await service.redeemedCount()).toBe(1);
  });

  it('accepts a valid ES256 assertion', async () => {
    const { service } = rig();
    const verified = await service.verifyIdJag(makeJag({ alg: 'ES256' }));
    expect(verified.sub).toBe('user-42');
  });

  it('accepts a valid EdDSA (Ed25519) assertion', async () => {
    const { service } = rig();
    const verified = await service.verifyIdJag(makeJag({ alg: 'EdDSA' }));
    expect(verified.sub).toBe('user-42');
    expect(verified.scopes).toEqual(['traces', 'metrics']);
  });

  it('verifies an EdDSA assertion with no kid against a single OKP key', async () => {
    const single = rig();
    single.setJwks({ keys: [{ ...(ed.publicKey.export({ format: 'jwk' }) as object), use: 'sig' }] });
    const verified = await single.service.verifyIdJag(makeJag({ alg: 'EdDSA', kid: undefined }));
    expect(verified.sub).toBe('user-42');
  });

  it('rejects an EdDSA assertion signed by an untrusted Ed25519 key', async () => {
    const other = generateKeyPairSync('ed25519');
    const { service } = rig();
    await expectOAuthError(
      service.verifyIdJag(makeJag({ alg: 'EdDSA', key: other.privateKey })),
      'idjag_bad_signature',
    );
  });

  it('accepts aud as an array containing the audience, and application/-prefixed typ', async () => {
    const { service } = rig();
    const jag = makeJag({
      typ: 'application/oauth-id-jag+jwt',
      payload: { aud: ['https://other.example.com', AUDIENCE] },
    });
    await expect(service.verifyIdJag(jag)).resolves.toBeTruthy();
  });

  it('accepts an assertion without a resource claim', async () => {
    const { service } = rig();
    const jag = makeJag({ payload: { resource: undefined } });
    await expect(service.verifyIdJag(jag)).resolves.toBeTruthy();
  });

  it('resolves the JWKS via OIDC discovery when no jwksUrl is configured', async () => {
    const { service, fetches } = rig({ jwksUrl: undefined });
    await expect(service.verifyIdJag(makeJag())).resolves.toBeTruthy();
    expect(fetches[0]).toBe(`${ISSUER}/.well-known/openid-configuration`);
    expect(fetches[1]).toBe(`${ISSUER}/jwks`);
  });

  it('verifies an assertion with no kid against a single unambiguous key', async () => {
    const single = rig();
    single.setJwks({ keys: [{ ...(rsa.publicKey.export({ format: 'jwk' }) as object), use: 'sig' }] });
    const verified = await single.service.verifyIdJag(makeJag({ kid: undefined }));
    expect(verified.sub).toBe('user-42');
  });

  it('extracts the email claim for account linking', async () => {
    const { service } = rig();
    const verified = await service.verifyIdJag(makeJag({ payload: { email: 'user@corp.example' } }));
    expect(verified.email).toBe('user@corp.example');
  });

  it('carries the request client_id through when the claim omits it', async () => {
    const { service } = rig();
    const verified = await service.verifyIdJag(makeJag({ payload: { client_id: undefined } }), 'req-client');
    expect(verified.clientId).toBe('req-client');
  });
});

// ─── Rejections ──────────────────────────────────────────────────────────────

describe('verifyIdJag rejections', () => {
  it('rejects non-JWS strings', async () => {
    const { service } = rig();
    await expectOAuthError(service.verifyIdJag('not-a-jwt'), 'idjag_malformed');
  });

  it('rejects a wrong typ header', async () => {
    const { service } = rig();
    await expectOAuthError(service.verifyIdJag(makeJag({ typ: 'JWT' })), 'idjag_wrong_typ');
  });

  it('rejects alg=none and HMAC algs outright', async () => {
    const { service } = rig();
    await expectOAuthError(service.verifyIdJag(makeJag({ alg: 'none' })), 'idjag_bad_alg');
    await expectOAuthError(service.verifyIdJag(makeJag({ alg: 'HS256', key: rsa.privateKey })), 'idjag_bad_alg');
  });

  it('rejects a signature from an untrusted key', async () => {
    const { service } = rig();
    await expectOAuthError(
      service.verifyIdJag(makeJag({ key: rsa2.privateKey })),
      'idjag_bad_signature',
    );
  });

  it('rejects a tampered payload', async () => {
    const { service } = rig();
    const jag = makeJag();
    const [h, , s] = jag.split('.');
    const tampered = `${h}.${b64u({ iss: ISSUER, sub: 'attacker', aud: AUDIENCE, jti: 'x', exp: Math.floor(T0 / 1000) + 300 })}.${s}`;
    await expectOAuthError(service.verifyIdJag(tampered), 'idjag_bad_signature');
  });

  it('rejects an unknown kid (after one refetch attempt)', async () => {
    const { service, fetches } = rig();
    await expectOAuthError(service.verifyIdJag(makeJag({ kid: 'ghost-key' })), 'idjag_unknown_key');
    expect(fetches.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects wrong issuer / audience / resource', async () => {
    const { service } = rig();
    await expectOAuthError(
      service.verifyIdJag(makeJag({ payload: { iss: 'https://evil.example.com' } })),
      'idjag_wrong_issuer',
    );
    await expectOAuthError(
      service.verifyIdJag(makeJag({ payload: { aud: 'https://other-rs.example.com' } })),
      'idjag_wrong_audience',
    );
    await expectOAuthError(
      service.verifyIdJag(makeJag({ payload: { resource: 'https://other-mcp.example.com' } })),
      'idjag_wrong_resource',
    );
  });

  it('rejects expired assertions and future iat/nbf', async () => {
    const { service, clock } = rig();
    const jag = makeJag();
    clock.now = T0 + 301_000 + 60_000; // past exp + skew
    await expectOAuthError(service.verifyIdJag(jag), 'idjag_expired');

    clock.now = T0;
    await expectOAuthError(
      service.verifyIdJag(makeJag({ payload: { iat: Math.floor(T0 / 1000) + 3600 } })),
      'idjag_not_yet_valid',
    );
    await expectOAuthError(
      service.verifyIdJag(makeJag({ payload: { nbf: Math.floor(T0 / 1000) + 3600 } })),
      'idjag_not_yet_valid',
    );
  });

  it('rejects missing sub / jti', async () => {
    const { service } = rig();
    await expectOAuthError(service.verifyIdJag(makeJag({ payload: { sub: undefined } })), 'idjag_no_subject');
    await expectOAuthError(service.verifyIdJag(makeJag({ payload: { jti: undefined } })), 'idjag_no_jti');
  });

  it('rejects a client_id mismatch between claim and request', async () => {
    const { service } = rig();
    await expectOAuthError(
      service.verifyIdJag(makeJag(), 'different-client'),
      'idjag_client_mismatch',
    );
  });

  it('rejects a replayed jti (single-use assertions)', async () => {
    const { service } = rig();
    const jag = makeJag();
    await service.verifyIdJag(jag);
    await expectOAuthError(service.verifyIdJag(jag), 'idjag_replayed');
  });

  it('still rejects replay in the clock-skew tail after exp (no single-use bypass)', async () => {
    // Regression: the jti was evicted at `exp`, but the assertion stays
    // acceptable until exp + skew — leaving a window to replay a redeemed
    // assertion. The redeemed entry must survive as long as the assertion can.
    const { service, clock } = rig();
    const jag = makeJag(); // exp = T0/1000 + 300 → T0 + 300_000
    await service.verifyIdJag(jag);
    clock.now = T0 + 300_000 + 30_000; // 30s past exp, within the 60s skew tail
    await expectOAuthError(service.verifyIdJag(jag), 'idjag_replayed');
  });

  it('rejects the assertion as expired once past exp + skew', async () => {
    const { service, clock } = rig();
    const jag = makeJag();
    await service.verifyIdJag(jag);
    clock.now = T0 + 300_000 + 61_000; // past exp + 60s skew
    await expectOAuthError(service.verifyIdJag(jag), 'idjag_expired');
  });

  it('fails closed (server_error) when the redeemed-jti cap is reached', async () => {
    const { service } = rig({ maxRedeemedJtis: 1 });
    await service.verifyIdJag(makeJag()); // fills the single slot
    const err = await expectOAuthError(service.verifyIdJag(makeJag()), 'idjag_replay_cache_full');
    expect(err.code).toBe('server_error');
    expect(err.status).toBe(500);
  });

  it('sweep drops redeemed jtis once their assertion expires', async () => {
    const { service, clock } = rig();
    await service.verifyIdJag(makeJag());
    expect(await service.redeemedCount()).toBe(1);
    clock.now = T0 + 400_000;
    expect(await service.sweep()).toBe(1);
    expect(await service.redeemedCount()).toBe(0);
  });

  it('unredeem un-burns a jti so a failed exchange can be retried', async () => {
    const { service } = rig();
    const jag = makeJag();
    const verified = await service.verifyIdJag(jag);
    await service.unredeem(verified.jti);
    await expect(service.verifyIdJag(jag)).resolves.toBeTruthy();
  });

  it('serves from the stale JWKS cache when the endpoint goes down', async () => {
    const { service, clock, setFail } = rig();
    await service.verifyIdJag(makeJag()); // warm the cache
    setFail(true);
    clock.now = T0 + 6 * 60_000; // past JWKS TTL
    await expect(service.verifyIdJag(makeJag({ payload: { exp: Math.floor(clock.now / 1000) + 300, iat: Math.floor(clock.now / 1000) } }))).resolves.toBeTruthy();
  });

  it('fails closed (server_error) when JWKS is unavailable and no cache exists', async () => {
    const { service, setFail } = rig();
    setFail(true);
    const err = await expectOAuthError(service.verifyIdJag(makeJag()), 'jwks_unavailable');
    expect(err.code).toBe('server_error');
    expect(err.status).toBe(500);
  });
});

// ─── HA: shared single-use denylist across instances ─────────────────────────

describe('cross-replica single-use semantics', () => {
  it('an ID-JAG redeemed on instance A is rejected as replayed on instance B', async () => {
    // Roadmap Phase 1 acceptance (d): two services (replicas) sharing one
    // denylist must enforce single-use across the pair — a per-process cache
    // would accept the same assertion once per replica.
    const denylist = new MemoryDenylist();
    const clock = { now: T0 };
    const opts = {
      now: () => clock.now,
      fetchJson: async () => JWKS,
      denylist,
    };
    const instanceA = new EnterpriseAuthService(BASE_CONFIG, opts);
    const instanceB = new EnterpriseAuthService(BASE_CONFIG, opts);

    const jag = makeJag();
    await instanceA.verifyIdJag(jag);
    try {
      await instanceB.verifyIdJag(jag);
      expect.unreachable('replay on the second replica must be rejected');
    } catch (err) {
      expect((err as OAuthTokenError).reason).toBe('idjag_replayed');
    }
  });
});

// ─── Scope resolution ────────────────────────────────────────────────────────

describe('grantedScopes', () => {
  const ENABLED = ['traces', 'metrics', 'logs'];

  it('intersects the scope claim with enabled skills', async () => {
    const { service } = rig();
    const v = await service.verifyIdJag(makeJag({ payload: { scope: 'traces grafana metrics' } }));
    expect(service.grantedScopes(v, ENABLED)).toEqual(['metrics', 'traces']);
  });

  it('throws invalid_scope when nothing usable remains', async () => {
    const { service } = rig();
    const v = await service.verifyIdJag(makeJag({ payload: { scope: 'grafana kubernetes' } }));
    try {
      service.grantedScopes(v, ENABLED);
      expect.unreachable('must throw invalid_scope');
    } catch (err) {
      expect((err as OAuthTokenError).code).toBe('invalid_scope');
    }
  });

  it('falls back to configured default scopes, then to all enabled skills', async () => {
    const withDefaults = rig({ defaultScopes: ['logs'] });
    const v1 = await withDefaults.service.verifyIdJag(makeJag({ payload: { scope: undefined } }));
    expect(withDefaults.service.grantedScopes(v1, ENABLED)).toEqual(['logs']);

    const noDefaults = rig();
    const v2 = await noDefaults.service.verifyIdJag(makeJag({ payload: { scope: undefined } }));
    expect(noDefaults.service.grantedScopes(v2, ENABLED)).toEqual(['logs', 'metrics', 'traces']);
  });
});

// ─── Discovery metadata ──────────────────────────────────────────────────────

describe('discovery metadata', () => {
  it('advertises the ID-JAG grant profile per the extension spec', () => {
    const meta = authorizationServerMetadata(BASE_CONFIG, ['traces']);
    expect(meta.issuer).toBe(AUDIENCE);
    expect(meta.token_endpoint).toBe(`${AUDIENCE}/auth/token`);
    expect(meta.grant_types_supported).toEqual([JWT_BEARER_GRANT]);
    expect(meta.authorization_grant_profiles_supported).toEqual([ID_JAG_GRANT_PROFILE]);
  });

  it('publishes protected-resource metadata pointing at this server', () => {
    const meta = protectedResourceMetadata(BASE_CONFIG, ['traces', 'metrics']);
    expect(meta.resource).toBe(AUDIENCE);
    expect(meta.authorization_servers).toEqual([AUDIENCE]);
    expect(meta.scopes_supported).toEqual(['traces', 'metrics']);
  });
});
