/**
 * Per-request ambient context, carried with `AsyncLocalStorage`.
 *
 * Its main job is W3C Trace Context propagation (MCP 2026-07-28 SEP-414):
 * `traceparent`/`tracestate`/`baggage` arrive in a tool call's `_meta` (or, as
 * a fallback, as HTTP headers from a proxy) and must reach the outbound
 * requests this server makes to telemetry backends, so one trace spans
 * host → MCP server → backend. For an OpenTelemetry MCP server that is table
 * stakes: without it, a tool call and the Jaeger/Prometheus queries it
 * triggers appear as unrelated spans.
 *
 * Ambient rather than a threaded parameter by design: backend fetchers are
 * pre-baked closures created at skill-registration time (`skill.ts`), and
 * every one of ~120 tool call sites invokes `fetcher(url)` with no context
 * argument. `AsyncLocalStorage` reaches them all without touching a single
 * tool module, and `fetchJSON` reads the store as the default for outbound
 * headers. Explicit `options.headers` still wins where a caller sets it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BAGGAGE_META_KEY,
  CLIENT_INFO_META_KEY,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
  type McpSpecVersion,
} from './mcp-spec.js';

/** Identity a 2026-07-28 client sends in `_meta` on every request. */
export interface McpClientInfo {
  name?: string;
  version?: string;
}

export interface RequestContext {
  /** W3C `traceparent` of the calling span, when the client propagated one. */
  traceparent?: string;
  /** W3C `tracestate` (vendor trace data) travelling with it. */
  tracestate?: string;
  /** W3C `baggage` (application-defined key/value context). */
  baggage?: string;
  /** Where the trace context came from — for the propagation metric. */
  traceSource?: 'meta' | 'http' | 'none';
  /** Authenticated principal (`key:<id>` / `jit:<rootId>`) for audit. */
  principal?: string;
  /** Client identity, from `_meta` (2026-07-28) or the initialize handshake. */
  clientInfo?: McpClientInfo;
  /** MCP spec revision this request is speaking. */
  specVersion?: McpSpecVersion;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` as the ambient request context. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The ambient context, or undefined outside a request (stdio, tests, startup). */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * W3C Trace Context headers to attach to an outbound backend request, from
 * the ambient context. Empty when nothing propagated — never invents a trace.
 */
export function outboundTraceHeaders(): Record<string, string> {
  const ctx = storage.getStore();
  if (!ctx) return {};
  const headers: Record<string, string> = {};
  if (ctx.traceparent) headers['traceparent'] = ctx.traceparent;
  if (ctx.tracestate) headers['tracestate'] = ctx.tracestate;
  if (ctx.baggage) headers['baggage'] = ctx.baggage;
  return headers;
}

/**
 * A `traceparent` must be `version-traceid-spanid-flags` with hex fields of
 * fixed width (W3C Trace Context §3.2). Rejecting malformed values keeps us
 * from forwarding client-controlled junk into backend request headers.
 */
const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** W3C caps `baggage` at 8192 bytes; `tracestate` is far smaller in practice. */
const MAX_HEADER_VALUE = 8192;

/**
 * Printable ASCII (plus space and tab) — the character set W3C defines
 * `tracestate` and `baggage` over.
 *
 * Anything outside it is rejected rather than forwarded, for two reasons:
 * CR/LF would be header injection, and — the case that actually bites —
 * `fetch()` *throws* on a header value containing a character above U+00FF
 * (e.g. an emoji) or a DEL character. Forwarding such a value would turn a
 * client-supplied string into a failed backend query, letting any client
 * break its own tool calls through a field that is supposed to be inert
 * metadata.
 */
const SAFE_HEADER_VALUE_RE = /^[\t\x20-\x7e]+$/;

function safeHeaderValue(value: unknown, max = MAX_HEADER_VALUE): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return SAFE_HEADER_VALUE_RE.test(trimmed) ? trimmed : undefined;
}

function validTraceparent(value: unknown): string | undefined {
  const raw = safeHeaderValue(value, 64);
  return raw && TRACEPARENT_RE.test(raw) ? raw : undefined;
}

/**
 * Build a request context from a request's `_meta` and HTTP headers.
 *
 * `_meta` wins over HTTP headers: SEP-414 makes `_meta` the protocol-level
 * channel, so a client that propagates there is more authoritative than an
 * intermediary that stamped a header. `tracestate`/`baggage` are only taken
 * from the same source as the accepted `traceparent` — mixing a traceparent
 * from one source with tracestate from another would produce an incoherent
 * context.
 */
export function contextFromRequest(input: {
  meta?: Record<string, unknown> | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
  principal?: string;
  specVersion?: McpSpecVersion;
}): RequestContext {
  const ctx: RequestContext = {
    principal: input.principal,
    specVersion: input.specVersion,
    traceSource: 'none',
  };

  const meta = input.meta;
  if (meta) {
    const info = meta[CLIENT_INFO_META_KEY];
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      const { name, version } = info as Record<string, unknown>;
      ctx.clientInfo = {
        name: typeof name === 'string' ? name : undefined,
        version: typeof version === 'string' ? version : undefined,
      };
    }

    const traceparent = validTraceparent(meta[TRACEPARENT_META_KEY]);
    if (traceparent) {
      ctx.traceparent = traceparent;
      ctx.tracestate = safeHeaderValue(meta[TRACESTATE_META_KEY]);
      ctx.baggage = safeHeaderValue(meta[BAGGAGE_META_KEY]);
      ctx.traceSource = 'meta';
    }
  }

  if (!ctx.traceparent && input.headers) {
    const header = (k: string): unknown => {
      const v = input.headers![k];
      return Array.isArray(v) ? v[0] : v;
    };
    const traceparent = validTraceparent(header('traceparent'));
    if (traceparent) {
      ctx.traceparent = traceparent;
      ctx.tracestate = safeHeaderValue(header('tracestate'));
      ctx.baggage = safeHeaderValue(header('baggage'));
      ctx.traceSource = 'http';
    }
  }

  return ctx;
}
