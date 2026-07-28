/**
 * MCP 2026-07-28 request handling for the Streamable HTTP transport.
 *
 * The 2026-07-28 revision made the protocol stateless: the initialize
 * handshake and `Mcp-Session-Id` are gone (SEP-2575, SEP-2567), routing
 * headers `Mcp-Method`/`Mcp-Name` are required and must agree with the body
 * (SEP-2243), list results carry cache hints (SEP-2549), and W3C trace
 * context propagates in `_meta` (SEP-414).
 *
 * SDK v1 predates all of that — it tops out at protocol `2025-11-25`, rejects
 * an unknown `MCP-Protocol-Version` outright, and has no notion of the
 * routing headers. So this module sits between the Node HTTP server and the
 * SDK transport and owns everything the SDK cannot do:
 *
 *   1. Buffer the JSON-RPC body **once** and pass it to the SDK as
 *      `parsedBody`, so header/body cross-checks are possible without the
 *      transport re-reading a consumed stream.
 *   2. Validate the routing headers against that body (SEP-2243).
 *   3. Translate the protocol-version header down to what the SDK accepts,
 *      keeping the client's real revision for our own decisions.
 *   4. Normalize `Accept`, which the SDK requires to list both media types
 *      even though a 2026 client may sensibly ask for JSON only.
 *   5. Serve each request from a fresh Server+transport pair with no session,
 *      so any replica can answer any request.
 *
 * Everything here is additive: a pre-2026 client still gets the session-based
 * path in `index.ts` untouched.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  METHOD_HEADER,
  NAME_HEADER,
  PROTOCOL_VERSION_HEADER,
  CLIENT_INFO_META_KEY,
  TOOL_LIST_TTL_MS,
  RESOURCE_TTL_MS,
  resolveSpecVersion,
  sdkProtocolVersion,
  specFeatures,
  type McpSpecVersion,
} from '../mcp-spec.js';
import { contextFromRequest, runWithContext, type RequestContext } from '../request-context.js';
import { metrics } from '../metrics.js';

/** Request bodies are small JSON-RPC envelopes; anything larger is abuse. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface ParsedMcpRequest {
  /** Raw body bytes as received (empty for GET/DELETE). */
  raw: string;
  /** Parsed JSON-RPC message, or undefined when the body was empty/not JSON. */
  body: unknown;
  /** Spec revision the client is speaking (undefined ⇒ pre-2026 default). */
  specVersion: McpSpecVersion | undefined;
  /** Per-request ambient context (trace propagation, principal, client info). */
  context: RequestContext;
}

/** A single JSON-RPC message from a body that may be a batch. */
type JsonRpcMessage = {
  id?: unknown;
  method?: unknown;
  params?: { name?: unknown; _meta?: unknown };
};

function messagesOf(body: unknown): JsonRpcMessage[] {
  if (Array.isArray(body)) return body.filter((m): m is JsonRpcMessage => !!m && typeof m === 'object');
  if (body && typeof body === 'object') return [body as JsonRpcMessage];
  return [];
}

/** Merge `_meta` from every message in the body (batches share a trace). */
function metaOf(body: unknown): Record<string, unknown> | undefined {
  let merged: Record<string, unknown> | undefined;
  for (const msg of messagesOf(body)) {
    const meta = msg.params?._meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      merged = { ...(merged ?? {}), ...(meta as Record<string, unknown>) };
    }
  }
  return merged;
}

/** Read the whole request body, bounded. Rejects oversized bodies. */
export function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return; // keep draining so the response can be written
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0;
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Buffer and inspect an MCP request before it reaches the SDK.
 *
 * `principal` is threaded in so the ambient context carries the authenticated
 * identity for audit without this module knowing how auth works.
 */
export async function parseMcpRequest(
  req: IncomingMessage,
  principal?: string,
): Promise<ParsedMcpRequest> {
  const raw = req.method === 'POST' ? await readRawBody(req) : '';

  let body: unknown;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined; // let the SDK produce the canonical JSON-RPC parse error
    }
  }

  const meta = metaOf(body);
  const specVersion = resolveSpecVersion({
    header: req.headers[PROTOCOL_VERSION_HEADER] as string | undefined,
    hasRoutingHeaders: !!req.headers[METHOD_HEADER],
    hasClientInfoMeta: !!meta && CLIENT_INFO_META_KEY in meta,
  });

  const context = contextFromRequest({
    meta,
    headers: req.headers,
    principal,
    specVersion,
  });

  return { raw, body, specVersion, context };
}

export type RoutingCheck =
  | { ok: true }
  | { ok: false; header: string; expected: string; actual: string };

/**
 * SEP-2243: when a request carries `Mcp-Method`/`Mcp-Name`, they must match
 * the body. The spec requires servers to reject disagreement — a gateway may
 * have routed or rate-limited on the headers, so a body that says something
 * else means the decision was made on false information.
 *
 * **Every** message in a batch is checked, not just the first. A single pair
 * of headers describes the whole request, so a batch whose later messages
 * name a different method is precisely the smuggling case the requirement
 * exists to prevent: the gateway sees `tools/list` and waves it through while
 * message two calls something it would have blocked.
 *
 * Absent headers are not an error here: this server accepts pre-2026 clients
 * on the same endpoint, and a 2026 client that omits them still gets correct
 * (if unroutable) service.
 */
export function checkRoutingHeaders(req: IncomingMessage, body: unknown): RoutingCheck {
  const methodHeader = req.headers[METHOD_HEADER] as string | undefined;
  const nameHeader = req.headers[NAME_HEADER] as string | undefined;
  if (!methodHeader && !nameHeader) return { ok: true };

  for (const msg of messagesOf(body)) {
    if (methodHeader) {
      const actual = typeof msg.method === 'string' ? msg.method : '';
      if (methodHeader !== actual) {
        return { ok: false, header: 'Mcp-Method', expected: methodHeader, actual };
      }
    }
    if (nameHeader) {
      const actual = typeof msg.params?.name === 'string' ? (msg.params.name as string) : '';
      if (nameHeader !== actual) {
        return { ok: false, header: 'Mcp-Name', expected: nameHeader, actual };
      }
    }
  }
  return { ok: true };
}

/** JSON-RPC error codes used by this layer (SEP-2164 aligned). */
const INVALID_REQUEST = -32600;

/** Write a JSON-RPC error response for a routing-header mismatch. */
export function rejectRoutingMismatch(res: ServerResponse, check: Extract<RoutingCheck, { ok: false }>): void {
  metrics.routingHeaderRejections.inc({ header: check.header });
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: INVALID_REQUEST,
        message:
          `${check.header} header does not match the request body ` +
          `(header "${check.expected}", body "${check.actual}")`,
      },
    }),
  );
}

/**
 * Set a header on both views Node exposes.
 *
 * `req.headers` is the convenient parsed object, but the SDK's Node transport
 * hands the request to `@hono/node-server`, which rebuilds the web `Request`
 * from `req.rawHeaders` — so mutating only `req.headers` is silently ignored
 * by everything downstream.
 */
function setHeader(req: IncomingMessage, name: string, value: string): void {
  req.headers[name] = value;

  const raw = req.rawHeaders;
  if (!Array.isArray(raw)) return;
  let found = false;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]?.toLowerCase() === name) {
      raw[i + 1] = value;
      found = true;
    }
  }
  if (!found) raw.push(name, value);
}

/**
 * Rewrite request headers so SDK v1 accepts a 2026-07-28 request.
 *
 * - `MCP-Protocol-Version`: an unknown revision is a hard 400 in the SDK, so
 *   it is translated to the newest revision the SDK knows. The header is
 *   rewritten rather than deleted: deleting it makes the SDK fall back to
 *   `2025-03-26`, which changes SSE/resumability behaviour.
 * - `Accept`: the SDK requires both `application/json` and `text/event-stream`
 *   on POST; a JSON-only 2026 client would otherwise get a 406.
 *
 * The `Accept` rewrite is deliberately limited to POST from a 2026 client.
 * Rewriting it on GET would satisfy the SDK's check for a client that never
 * asked for an event stream and hand it one anyway; rewriting it for a
 * pre-2026 client would replace that client's honest 406 with a response it
 * cannot parse. Only the case the shim exists for is touched.
 */
export function adaptHeadersForSdk(req: IncomingMessage, specVersion: McpSpecVersion | undefined): void {
  const sdkVersion = sdkProtocolVersion(specVersion);
  if (sdkVersion && req.headers[PROTOCOL_VERSION_HEADER]) {
    setHeader(req, PROTOCOL_VERSION_HEADER, sdkVersion);
  }

  if (req.method !== 'POST' || !specFeatures(specVersion).statelessLifecycle) return;

  const accept = String(req.headers['accept'] || '');
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    setHeader(req, 'accept', 'application/json, text/event-stream');
  }
}

/** Run `fn` with the request's ambient context and record propagation metrics. */
export function withRequestContext<T>(parsed: ParsedMcpRequest, fn: () => T): T {
  metrics.traceContextPropagated.inc({ source: parsed.context.traceSource ?? 'none' });
  metrics.specRequests.inc({
    version: parsed.specVersion ?? 'unspecified',
    mode: specFeatures(parsed.specVersion).statelessLifecycle ? 'stateless' : 'session',
  });
  return runWithContext(parsed.context, fn);
}

/** Cache hint per method (SEP-2549); undefined ⇒ the result is not cacheable. */
function cacheHintFor(method: string | undefined): { ttlMs: number; cacheScope: string } | undefined {
  switch (method) {
    case 'tools/list':
    case 'resources/list':
    case 'resources/templates/list':
    case 'prompts/list':
      return { ttlMs: TOOL_LIST_TTL_MS, cacheScope: 'session' };
    case 'resources/read':
      return { ttlMs: RESOURCE_TTL_MS, cacheScope: 'session' };
    default:
      // Tool calls are live telemetry queries — never advertise them cacheable.
      return undefined;
  }
}

/** Minimal view of the SDK transport surface this module drives. */
export interface SendableTransport {
  send(message: unknown, options?: unknown): Promise<void>;
}

/**
 * Attach SEP-2549 cache hints to responses for cacheable methods.
 *
 * Wraps the transport's `send` — a public `Transport` interface method —
 * rather than re-registering SDK request handlers, so the SDK's own tool-list
 * generation (including zod → JSON Schema conversion) is untouched and no
 * private API is involved.
 *
 * Hints are keyed by **request id**, so in a batch each response gets the hint
 * for the method that actually produced it. Deriving one hint from the first
 * message and stamping it on everything would advertise a live `tools/call`
 * result as cacheable for five minutes — an agent could then reuse a stale
 * telemetry answer, which is worse than emitting no hint at all.
 *
 * `cacheScope: 'session'` rather than `'public'`: the tool list is filtered to
 * the presenting credential's scopes, so one client's list must never be
 * shared with another.
 *
 * Only applied for clients that asked for a revision defining these fields;
 * a 2025-era client's response shape is left exactly as it was.
 */
export function decorateWithCacheHints(transport: SendableTransport, body: unknown): void {
  const hints = new Map<string, { ttlMs: number; cacheScope: string }>();
  for (const msg of messagesOf(body)) {
    if (msg.id === undefined || msg.id === null) continue; // notification — no response
    const hint = cacheHintFor(typeof msg.method === 'string' ? msg.method : undefined);
    if (hint) hints.set(String(msg.id), hint);
  }
  if (hints.size === 0) return;

  const send = transport.send.bind(transport);
  transport.send = async (message: unknown, options?: unknown) => {
    const msg = message as { id?: unknown; result?: Record<string, unknown> } | null;
    if (msg && typeof msg === 'object' && msg.result && typeof msg.result === 'object') {
      const hint = msg.id === undefined || msg.id === null ? undefined : hints.get(String(msg.id));
      if (hint) msg.result = { ...msg.result, ...hint };
    }
    return send(message, options);
  };
}
