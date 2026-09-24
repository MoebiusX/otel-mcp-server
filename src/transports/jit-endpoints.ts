/**
 * HTTP endpoints for the JIT privileged-identity lifecycle (see ../jit.ts).
 *
 *   POST /auth/token          — token endpoint. Two grants:
 *                               • static client key → scoped ephemeral session
 *                                 token (OWASP MCP01/MCP02);
 *                               • `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`
 *                                 with an enterprise IdP ID-JAG assertion →
 *                                 same session token, enterprise-managed
 *                                 (MCP ext-auth enterprise-managed-authorization).
 *   POST /auth/token/refresh  — rotate a live token to its next generation.
 *                               Re-checks the parent key first, so revoking or
 *                               narrowing a key cascades into its live lineages.
 *   POST /auth/token/revoke   — revoke: self (with the token), by token_id, or
 *                               by root_id (whole-lineage kill-switch, with a
 *                               static key; restricted keys only revoke their own).
 *
 * Every outcome is audit-logged with the public token id — never the secret —
 * and counted in /metrics (OWASP MCP08).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateClientKey, extractCredential, type ClientKey } from '../auth.js';
import {
  JitError,
  looksLikeJitToken,
  type IssuedToken,
  type JitTokenService,
} from '../jit.js';
import {
  JWT_BEARER_GRANT,
  OAuthTokenError,
  type EnterpriseAuthService,
} from '../enterprise-auth.js';
import { metrics } from '../metrics.js';

/** Audit label used as `parent_key` for enterprise-minted tokens (bounded cardinality). */
export const ENTERPRISE_PARENT_KEY = 'enterprise-idp';

export interface JitEndpointContext {
  /** Null when JIT is disabled — /auth/* then answers 404 with a hint. */
  service: JitTokenService | null;
  /** Null unless enterprise-managed authorization is configured. */
  enterprise: EnterpriseAuthService | null;
  clientKeys: ClientKey[];
  /** Skill ids enabled on this server instance (scope default for unrestricted keys). */
  enabledSkillIds: string[];
}

const MAX_BODY_BYTES = 16 * 1024;

// ─── Small HTTP helpers ──────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
};

function deny(
  res: ServerResponse,
  status: number,
  reason: string,
  message: string,
): void {
  metrics.jitDenials.inc({ reason });
  console.error(`  JIT:     ✗ denied (${reason}) — ${message}`);
  json(res, status, { error: STATUS_TEXT[status] ?? 'Forbidden', message, reason });
}

/**
 * Read and parse a small request body ({} when empty). JSON by default;
 * `application/x-www-form-urlencoded` (the OAuth token-endpoint encoding) is
 * decoded into the same string-record shape.
 */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return; // keep draining (bounded memory) so the 413 can be written
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0;
        reject(new JitError('malformed', 413, `Request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolve({});

      const contentType = String(req.headers['content-type'] || '');
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return resolve(parsed as Record<string, unknown>);
        }
        reject(new JitError('malformed', 400, 'Request body must be a JSON object'));
      } catch {
        reject(new JitError('malformed', 400, 'Request body is not valid JSON'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

/** RFC 6749 §5.2 token error response (used on the OAuth grant path). */
function oauthError(res: ServerResponse, err: OAuthTokenError): void {
  metrics.jitDenials.inc({ reason: err.reason });
  console.error(`  JIT:     ✗ denied (${err.reason}) — ${err.message}`);
  res.writeHead(err.status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ error: err.code, error_description: err.message }));
}

/** OAuth-style (snake_case) representation of a freshly issued token. */
function tokenResponse(issued: IssuedToken): Record<string, unknown> {
  const r = issued.record;
  return {
    token: issued.token,
    token_type: 'Bearer',
    token_id: r.id,
    parent_key: r.parentKeyId,
    scopes: r.scopes,
    generation: r.generation,
    issued_at: new Date(r.issuedAt).toISOString(),
    expires_at: new Date(r.expiresAt).toISOString(),
    expires_in: Math.max(0, Math.round((r.expiresAt - r.issuedAt) / 1_000)),
    not_after: new Date(r.notAfter).toISOString(),
  };
}

async function syncActiveGauge(service: JitTokenService): Promise<void> {
  metrics.jitActiveTokens.set({}, await service.activeCount());
}

/** Is `scopes` still within what the parent key may currently grant? */
function withinCurrentGrant(scopes: string[], parent: ClientKey): boolean {
  if (!parent.allowedTools) return true; // unrestricted key
  return scopes.every((s) => parent.allowedTools!.includes(s));
}

// ─── Route handlers ──────────────────────────────────────────────────────────

async function handleMint(
  req: IncomingMessage,
  res: ServerResponse,
  service: JitTokenService,
  ctx: JitEndpointContext,
): Promise<void> {
  const body = await readBody(req);

  // OAuth grant path — enterprise-managed authorization (ID-JAG exchange).
  const grantType = body['grant_type'];
  if (typeof grantType === 'string' && grantType.length > 0) {
    return handleEnterpriseGrant(res, service, ctx, grantType, body);
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
  const credential = extractCredential(authHeader, apiKeyHeader);

  // A session token must not mint further tokens: delegation happens only at
  // the static key, so every lineage is one auditable hop from a named key.
  if (credential && looksLikeJitToken(credential)) {
    return deny(
      res,
      403,
      'token_minting_with_token',
      'Session tokens cannot mint new tokens; authenticate with your static API key',
    );
  }

  const parentKey = validateClientKey(ctx.clientKeys, authHeader, apiKeyHeader);
  if (!parentKey) {
    return deny(res, 401, 'invalid_parent_key', 'A valid static API key is required to mint a session token');
  }

  const scopes = body['scopes'];
  if (scopes !== undefined && !(Array.isArray(scopes) && scopes.every((s) => typeof s === 'string'))) {
    throw new JitError('malformed', 400, '"scopes" must be an array of skill id strings');
  }
  const ttlSeconds = body['ttlSeconds'];
  if (ttlSeconds !== undefined && typeof ttlSeconds !== 'number') {
    throw new JitError('malformed', 400, '"ttlSeconds" must be a number');
  }

  const issued = await service.issue({
    parentKeyId: parentKey.id,
    grantableScopes: parentKey.allowedTools ?? null,
    enabledSkillIds: ctx.enabledSkillIds,
    requestedScopes: scopes as string[] | undefined,
    requestedTtlSeconds: ttlSeconds as number | undefined,
  });

  metrics.jitTokensIssued.inc({ parent_key: parentKey.id });
  await syncActiveGauge(service);
  const r = issued.record;
  console.error(
    `  JIT:     issued ${r.id} (key=${r.parentKeyId} scopes=[${r.scopes.join(',')}] ` +
      `ttl=${Math.round((r.expiresAt - r.issuedAt) / 1_000)}s gen=${r.generation})`,
  );
  json(res, 201, tokenResponse(issued));
}

/**
 * Enterprise-managed authorization: exchange an IdP-issued ID-JAG assertion
 * for a scoped JIT session token. Success and errors use the OAuth 2.0 token
 * response shapes (RFC 6749 §5.1 / §5.2) as required by the extension spec.
 */
async function handleEnterpriseGrant(
  res: ServerResponse,
  service: JitTokenService,
  ctx: JitEndpointContext,
  grantType: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    if (grantType !== JWT_BEARER_GRANT) {
      throw new OAuthTokenError(
        'unsupported_grant_type',
        'unsupported_grant_type',
        `Unsupported grant_type; this token endpoint supports ${JWT_BEARER_GRANT}`,
      );
    }
    if (!ctx.enterprise) {
      throw new OAuthTokenError(
        'unsupported_grant_type',
        'enterprise_auth_disabled',
        'Enterprise-managed authorization is not configured (set MCP_ENTERPRISE_AUTH_ISSUER and MCP_ENTERPRISE_AUTH_AUDIENCE)',
      );
    }

    const assertion = body['assertion'];
    if (typeof assertion !== 'string' || !assertion) {
      throw new OAuthTokenError('invalid_request', 'idjag_missing', 'Missing "assertion" parameter');
    }
    const clientId = typeof body['client_id'] === 'string' ? (body['client_id'] as string) : undefined;

    const verified = await ctx.enterprise.verifyIdJag(assertion, clientId);

    // The assertion's single-use jti is burned at verification. If anything
    // downstream fails (scope resolution, capacity), the client received no
    // token — un-redeem so a retry with the same assertion is not bounced
    // with idjag_replayed, forcing a pointless IdP round-trip.
    let issued: IssuedToken;
    try {
      const scopes = ctx.enterprise.grantedScopes(verified, ctx.enabledSkillIds);
      issued = await service.issue({
        parentKeyId: ENTERPRISE_PARENT_KEY,
        grantableScopes: scopes,
        enabledSkillIds: ctx.enabledSkillIds,
        requestedScopes: scopes,
      });
    } catch (err) {
      await ctx.enterprise.unredeem(verified.jti).catch(() => undefined);
      throw err;
    }

    metrics.jitTokensIssued.inc({ parent_key: ENTERPRISE_PARENT_KEY });
    await syncActiveGauge(service);
    const r = issued.record;
    console.error(
      `  JIT:     issued ${r.id} (idp sub=${verified.sub}${verified.clientId ? ` client=${verified.clientId}` : ''} ` +
        `jti=${verified.jti} scopes=[${r.scopes.join(',')}] ttl=${Math.round((r.expiresAt - r.issuedAt) / 1_000)}s)`,
    );

    // RFC 6749 §5.1 token response; token_id/not_after ride along as extensions.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        access_token: issued.token,
        token_type: 'Bearer',
        expires_in: Math.max(0, Math.round((r.expiresAt - r.issuedAt) / 1_000)),
        scope: r.scopes.join(' '),
        token_id: r.id,
        not_after: new Date(r.notAfter).toISOString(),
      }),
    );
  } catch (err) {
    if (err instanceof OAuthTokenError) return oauthError(res, err);
    if (err instanceof JitError) {
      // e.g. capacity — surface as a temporarily-failing OAuth token request.
      return oauthError(res, new OAuthTokenError('server_error', err.code, err.message));
    }
    throw err;
  }
}

async function handleRefresh(
  req: IncomingMessage,
  res: ServerResponse,
  service: JitTokenService,
  ctx: JitEndpointContext,
): Promise<void> {
  const credential = extractCredential(
    req.headers['authorization'] as string | undefined,
    req.headers['x-api-key'] as string | undefined,
  );
  if (!credential || !looksLikeJitToken(credential)) {
    return deny(res, 401, 'unknown', 'Present the current session token to refresh it');
  }

  // Access review cascades into live lineages (OWASP MCP02): rotation
  // re-checks the *current* parent key. A key the operator has removed can no
  // longer renew its lineages, and a narrowed key cannot renew tokens whose
  // scopes exceed today's grant — the lineage dies at its current TTL instead
  // of surviving to notAfter. Enterprise-minted tokens have no local parent
  // key; their review lever is the IdP (assertions are single-use).
  const current = await service.validate(credential);
  if (current.ok && current.record.parentKeyId !== ENTERPRISE_PARENT_KEY) {
    const parent = ctx.clientKeys.find((k) => k.id === current.record.parentKeyId);
    if (!parent) {
      return deny(
        res,
        403,
        'parent_key_revoked',
        `Parent key "${current.record.parentKeyId}" no longer exists; token lineage cannot be renewed`,
      );
    }
    if (!withinCurrentGrant(current.record.scopes, parent)) {
      return deny(
        res,
        403,
        'scope_violation',
        `Parent key "${parent.id}" no longer grants this token's scopes; mint a new token via POST /auth/token`,
      );
    }
  }

  const issued = await service.refresh(credential);
  metrics.jitRotations.inc();
  await syncActiveGauge(service);
  const r = issued.record;
  console.error(
    `  JIT:     rotated → ${r.id} (key=${r.parentKeyId} root=${r.rootId} gen=${r.generation})`,
  );
  json(res, 201, tokenResponse(issued));
}

async function handleRevoke(
  req: IncomingMessage,
  res: ServerResponse,
  service: JitTokenService,
  ctx: JitEndpointContext,
): Promise<void> {
  const authHeader = req.headers['authorization'] as string | undefined;
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
  const credential = extractCredential(authHeader, apiKeyHeader);

  // Self-revocation: the token holder hands its badge back.
  if (credential && looksLikeJitToken(credential)) {
    const record = await service.revoke(credential);
    metrics.jitRevocations.inc({ source: 'self' });
    await syncActiveGauge(service);
    console.error(`  JIT:     revoked ${record.id} (self, key=${record.parentKeyId})`);
    return json(res, 200, { revoked: true, token_id: record.id });
  }

  // Administrative kill-switch by token id or lineage root id. An
  // unrestricted key (no allowedTools) may revoke anything; a restricted key
  // may only revoke tokens minted from itself — least privilege applies to
  // revocation too, or the smallest tenant key becomes a cross-tenant
  // availability lever (OWASP MCP02).
  const adminKey = validateClientKey(ctx.clientKeys, authHeader, apiKeyHeader);
  if (!adminKey) {
    return deny(res, 401, 'invalid_parent_key', 'Revocation requires the session token or a valid static API key');
  }
  const canRevoke = (parentKeyId: string): boolean =>
    !adminKey.allowedTools || parentKeyId === adminKey.id;

  const body = await readBody(req);
  const tokenId = body['token_id'];
  const rootId = body['root_id'];

  if (typeof rootId === 'string' && rootId) {
    // Lineage kill: revokes the current generation and any in-grace
    // predecessor without chasing the latest token id through the audit log.
    //
    // Ownership is resolved from the lineage's live members, NOT from
    // `get(rootId)`: the generation-0 record whose id *is* the rootId is
    // pruned after the second rotation and swept after its grace window, so a
    // root-id lookup returns undefined while the lineage is still very much
    // alive. Checking `target && ...` against that lookup let the guard
    // silently disappear — a restricted key could then kill any other key's
    // rotated lineage, the exact cross-tenant lever this check exists to stop.
    const lineage = await service.getLineage(rootId);
    if (!lineage.every((r) => canRevoke(r.parentKeyId))) {
      return deny(res, 403, 'scope_violation', 'This key may only revoke tokens minted from itself');
    }
    const killed = await service.revokeLineage(rootId);
    if (killed.length === 0) {
      return json(res, 404, { error: 'Not Found', message: `No live tokens in lineage "${rootId}"` });
    }
    metrics.jitRevocations.inc({ source: 'admin' }, killed.length);
    await syncActiveGauge(service);
    console.error(
      `  JIT:     revoked lineage ${rootId} → [${killed.map((r) => r.id).join(',')}] (admin key=${adminKey.id})`,
    );
    return json(res, 200, { revoked: true, root_id: rootId, token_ids: killed.map((r) => r.id) });
  }

  if (typeof tokenId !== 'string' || !tokenId) {
    throw new JitError('malformed', 400, '"token_id" (or "root_id") is required when revoking with a static key');
  }
  const target = await service.get(tokenId);
  if (target && !canRevoke(target.parentKeyId)) {
    return deny(res, 403, 'scope_violation', 'This key may only revoke tokens minted from itself');
  }
  const record = await service.revokeById(tokenId);
  if (!record) {
    return json(res, 404, { error: 'Not Found', message: `No token with id "${tokenId}"` });
  }
  metrics.jitRevocations.inc({ source: 'admin' });
  await syncActiveGauge(service);
  console.error(`  JIT:     revoked ${record.id} (admin key=${adminKey.id})`);
  json(res, 200, { revoked: true, token_id: record.id });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Handle a request if it targets a JIT endpoint. Returns `true` when the
 * request was answered (the caller must stop), `false` for non-/auth paths.
 */
export async function handleJitRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: JitEndpointContext,
): Promise<boolean> {
  const path = (req.url || '').split('?')[0];
  if (!path || !path.startsWith('/auth/')) return false;

  if (!ctx.service) {
    json(res, 404, {
      error: 'Not Found',
      message: 'JIT identity is disabled. Set MCP_JIT_MODE=enabled (or required) and configure client keys.',
    });
    return true;
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method Not Allowed', message: 'JIT endpoints accept POST only' });
    return true;
  }

  try {
    switch (path) {
      case '/auth/token':
        await handleMint(req, res, ctx.service, ctx);
        break;
      case '/auth/token/refresh':
        await handleRefresh(req, res, ctx.service, ctx);
        break;
      case '/auth/token/revoke':
        await handleRevoke(req, res, ctx.service, ctx);
        break;
      default:
        json(res, 404, {
          error: 'Not Found',
          message: 'Unknown auth endpoint. Available: POST /auth/token, /auth/token/refresh, /auth/token/revoke',
        });
    }
  } catch (err) {
    if (err instanceof JitError) {
      deny(res, err.status, err.code, err.message);
    } else {
      console.error(`  JIT:     ⚠ endpoint error: ${err instanceof Error ? err.message : String(err)}`);
      json(res, 500, { error: 'Internal Server Error', message: 'JIT endpoint failed' });
    }
  }
  return true;
}
