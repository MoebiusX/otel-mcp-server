import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  MCP_SPEC_LATEST,
  MCP_SPEC_SDK_MAX,
  isKnownSpecVersion,
  resolveSpecVersion,
  sdkProtocolVersion,
  specFeatures,
  CLIENT_INFO_META_KEY,
} from '../src/mcp-spec.js';
import {
  contextFromRequest,
  runWithContext,
  currentContext,
  outboundTraceHeaders,
} from '../src/request-context.js';
import {
  parseMcpRequest,
  checkRoutingHeaders,
  adaptHeadersForSdk,
  decorateWithCacheHints,
} from '../src/transports/mcp-2026.js';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

/**
 * Minimal IncomingMessage stand-in. It carries `rawHeaders` as well as
 * `headers` because the SDK's Node transport rebuilds the request from
 * `rawHeaders` — a stand-in with only `headers` would let a broken header
 * rewrite pass its unit test and fail against a real server.
 */
function mockReq(opts: { method?: string; headers?: Record<string, string>; body?: string }): any {
  const req = new EventEmitter() as any;
  req.method = opts.method ?? 'POST';
  req.url = '/mcp';
  req.headers = opts.headers ?? {};
  req.rawHeaders = Object.entries(req.headers).flatMap(([k, v]) => [k, String(v)]);
  queueMicrotask(() => {
    if (opts.body) req.emit('data', Buffer.from(opts.body, 'utf-8'));
    req.emit('end');
  });
  return req;
}

/** Read a header back the way @hono/node-server does. */
function rawHeader(req: any, name: string): string | undefined {
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === name) return req.rawHeaders[i + 1];
  }
  return undefined;
}

// ─── Spec version model ──────────────────────────────────────────────────────

describe('MCP spec version resolution', () => {
  it('recognizes known revisions and reports 2026 features only for 2026-07-28', () => {
    expect(isKnownSpecVersion('2026-07-28')).toBe(true);
    expect(isKnownSpecVersion('1999-01-01')).toBe(false);

    const v2026 = specFeatures('2026-07-28');
    expect(v2026.statelessLifecycle).toBe(true);
    expect(v2026.routingHeaders).toBe(true);
    expect(v2026.cacheHints).toBe(true);

    const v2025 = specFeatures('2025-11-25');
    expect(v2025.statelessLifecycle).toBe(false);
    expect(v2025.sessionIdRemoved).toBe(false);
    expect(specFeatures(undefined).statelessLifecycle).toBe(false);
  });

  it('prefers an explicit header over inference', () => {
    expect(resolveSpecVersion({ header: '2025-06-18', hasRoutingHeaders: true })).toBe('2025-06-18');
  });

  it('infers 2026-07-28 from routing headers or _meta clientInfo', () => {
    expect(resolveSpecVersion({ hasRoutingHeaders: true })).toBe('2026-07-28');
    expect(resolveSpecVersion({ hasClientInfoMeta: true })).toBe('2026-07-28');
    expect(resolveSpecVersion({})).toBeUndefined();
  });

  it('treats an unrecognized revision as the newest we implement', () => {
    // Old revisions stay valid for >=12 months under the spec's deprecation
    // policy, so an unknown value is almost certainly newer than we know.
    expect(resolveSpecVersion({ header: '2027-01-01' })).toBe(MCP_SPEC_LATEST);
  });

  it('translates a newer revision down to what the SDK accepts', () => {
    expect(sdkProtocolVersion('2026-07-28')).toBe(MCP_SPEC_SDK_MAX);
    expect(sdkProtocolVersion('2025-06-18')).toBe('2025-06-18');
    expect(sdkProtocolVersion(undefined)).toBeUndefined();
  });
});

// ─── SEP-414 trace context ───────────────────────────────────────────────────

describe('trace context extraction (SEP-414)', () => {
  it('takes trace context from _meta', () => {
    const ctx = contextFromRequest({
      meta: { traceparent: TRACEPARENT, tracestate: 'vendor=x', baggage: 'k=v' },
    });
    expect(ctx.traceparent).toBe(TRACEPARENT);
    expect(ctx.tracestate).toBe('vendor=x');
    expect(ctx.baggage).toBe('k=v');
    expect(ctx.traceSource).toBe('meta');
  });

  it('falls back to HTTP headers when _meta carries none', () => {
    const ctx = contextFromRequest({ headers: { traceparent: TRACEPARENT, tracestate: 'a=b' } });
    expect(ctx.traceparent).toBe(TRACEPARENT);
    expect(ctx.traceSource).toBe('http');
  });

  it('prefers _meta over HTTP headers and does not mix sources', () => {
    const other = '00-11111111111111111111111111111111-2222222222222222-01';
    const ctx = contextFromRequest({
      meta: { traceparent: TRACEPARENT },
      headers: { traceparent: other, tracestate: 'from=header' },
    });
    expect(ctx.traceparent).toBe(TRACEPARENT);
    // tracestate from the losing source must not ride along.
    expect(ctx.tracestate).toBeUndefined();
  });

  it('rejects malformed or unsafe traceparent values', () => {
    expect(contextFromRequest({ meta: { traceparent: 'not-a-traceparent' } }).traceparent).toBeUndefined();
    expect(contextFromRequest({ meta: { traceparent: 42 } }).traceparent).toBeUndefined();
    // Header injection attempt.
    expect(
      contextFromRequest({ headers: { traceparent: `${TRACEPARENT}\r\nX-Evil: 1` } }).traceparent,
    ).toBeUndefined();
  });

  it('drops tracestate/baggage containing CR/LF', () => {
    const ctx = contextFromRequest({
      meta: { traceparent: TRACEPARENT, tracestate: 'a=b\r\nX-Evil: 1', baggage: 'ok=1' },
    });
    expect(ctx.traceparent).toBe(TRACEPARENT);
    expect(ctx.tracestate).toBeUndefined();
    expect(ctx.baggage).toBe('ok=1');
  });

  it('extracts client info from the 2026 _meta key', () => {
    const ctx = contextFromRequest({
      meta: { [CLIENT_INFO_META_KEY]: { name: 'my-app', version: '1.0' } },
    });
    expect(ctx.clientInfo).toEqual({ name: 'my-app', version: '1.0' });
  });

  it('reports no trace context when nothing propagated', () => {
    const ctx = contextFromRequest({});
    expect(ctx.traceSource).toBe('none');
    expect(runWithContext(ctx, () => outboundTraceHeaders())).toEqual({});
  });

  it('exposes propagated headers to ambient callers', () => {
    const ctx = contextFromRequest({ meta: { traceparent: TRACEPARENT, baggage: 'k=v' } });
    const headers = runWithContext(ctx, () => outboundTraceHeaders());
    expect(headers).toEqual({ traceparent: TRACEPARENT, baggage: 'k=v' });
    // Outside a context there is nothing to propagate.
    expect(currentContext()).toBeUndefined();
    expect(outboundTraceHeaders()).toEqual({});
  });

  it('survives async boundaries (the reason for AsyncLocalStorage)', async () => {
    const ctx = contextFromRequest({ meta: { traceparent: TRACEPARENT } });
    const seen = await runWithContext(ctx, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return outboundTraceHeaders();
    });
    expect(seen.traceparent).toBe(TRACEPARENT);
  });
});

// ─── SEP-2243 routing headers ────────────────────────────────────────────────

describe('routing header validation (SEP-2243)', () => {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'traces_search' } };

  it('accepts headers that agree with the body', () => {
    const req = mockReq({ headers: { 'mcp-method': 'tools/call', 'mcp-name': 'traces_search' } });
    expect(checkRoutingHeaders(req, body)).toEqual({ ok: true });
  });

  it('rejects a method mismatch', () => {
    const req = mockReq({ headers: { 'mcp-method': 'tools/list' } });
    const check = checkRoutingHeaders(req, body);
    expect(check).toMatchObject({ ok: false, header: 'Mcp-Method', expected: 'tools/list', actual: 'tools/call' });
  });

  it('rejects a name mismatch', () => {
    const req = mockReq({ headers: { 'mcp-method': 'tools/call', 'mcp-name': 'metrics_query' } });
    expect(checkRoutingHeaders(req, body)).toMatchObject({ ok: false, header: 'Mcp-Name' });
  });

  it('accepts requests that omit the headers (pre-2026 clients)', () => {
    expect(checkRoutingHeaders(mockReq({}), body)).toEqual({ ok: true });
  });

  it('validates a batch against its first message', () => {
    const batch = [body, { jsonrpc: '2.0', id: 2, method: 'tools/list' }];
    const ok = mockReq({ headers: { 'mcp-method': 'tools/call' } });
    expect(checkRoutingHeaders(ok, batch)).toEqual({ ok: true });
    const bad = mockReq({ headers: { 'mcp-method': 'tools/list' } });
    expect(checkRoutingHeaders(bad, batch)).toMatchObject({ ok: false });
  });

  it('does not reject when there is no body to disagree with', () => {
    expect(checkRoutingHeaders(mockReq({ headers: { 'mcp-method': 'tools/list' } }), undefined)).toEqual({ ok: true });
  });
});

// ─── Header adaptation for SDK v1 ────────────────────────────────────────────

describe('SDK header adaptation', () => {
  it('translates 2026-07-28 down to the SDK maximum without deleting the header', () => {
    const req = mockReq({ headers: { 'mcp-protocol-version': '2026-07-28' } });
    adaptHeadersForSdk(req, '2026-07-28');
    // Deleting it would make the SDK fall back to 2025-03-26 and change
    // SSE/resumability behaviour, so it must be rewritten, not removed.
    expect(req.headers['mcp-protocol-version']).toBe(MCP_SPEC_SDK_MAX);
  });

  it('rewrites rawHeaders too — the view the SDK actually reads', () => {
    // Regression: the SDK's Node transport hands the request to
    // @hono/node-server, which rebuilds the web Request from rawHeaders.
    // Mutating only req.headers was silently ignored and every 2026 request
    // came back 406.
    const req = mockReq({ headers: { 'mcp-protocol-version': '2026-07-28', accept: 'application/json' } });
    adaptHeadersForSdk(req, '2026-07-28');
    expect(rawHeader(req, 'mcp-protocol-version')).toBe(MCP_SPEC_SDK_MAX);
    expect(rawHeader(req, 'accept')).toBe('application/json, text/event-stream');
  });

  it('appends Accept to rawHeaders when the client sent none', () => {
    const req = mockReq({ headers: {} });
    adaptHeadersForSdk(req, '2026-07-28');
    expect(rawHeader(req, 'accept')).toBe('application/json, text/event-stream');
  });

  it('leaves a version the SDK already accepts untouched', () => {
    const req = mockReq({ headers: { 'mcp-protocol-version': '2025-06-18' } });
    adaptHeadersForSdk(req, '2025-06-18');
    expect(req.headers['mcp-protocol-version']).toBe('2025-06-18');
  });

  it('normalizes Accept so a JSON-only client is not 406ed', () => {
    const req = mockReq({ headers: { accept: 'application/json' } });
    adaptHeadersForSdk(req, '2026-07-28');
    expect(req.headers['accept']).toBe('application/json, text/event-stream');
  });

  it('leaves a fully-specified Accept alone', () => {
    const req = mockReq({ headers: { accept: 'application/json, text/event-stream' } });
    adaptHeadersForSdk(req, '2026-07-28');
    expect(req.headers['accept']).toBe('application/json, text/event-stream');
  });
});

// ─── Request parsing ─────────────────────────────────────────────────────────

describe('parseMcpRequest', () => {
  it('buffers the body, resolves the version, and builds the context', async () => {
    const req = mockReq({
      headers: { 'mcp-protocol-version': '2026-07-28' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'traces_search',
          _meta: { traceparent: TRACEPARENT, [CLIENT_INFO_META_KEY]: { name: 'agent', version: '2' } },
        },
      }),
    });
    const parsed = await parseMcpRequest(req, 'jit:root-1');
    expect(parsed.specVersion).toBe('2026-07-28');
    expect((parsed.body as any).method).toBe('tools/call');
    expect(parsed.context.traceparent).toBe(TRACEPARENT);
    expect(parsed.context.clientInfo?.name).toBe('agent');
    expect(parsed.context.principal).toBe('jit:root-1');
  });

  it('infers 2026 from _meta clientInfo with no version header', async () => {
    const req = mockReq({
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [CLIENT_INFO_META_KEY]: { name: 'a' } } } }),
    });
    expect((await parseMcpRequest(req)).specVersion).toBe('2026-07-28');
  });

  it('leaves malformed JSON for the SDK to reject canonically', async () => {
    const req = mockReq({ body: '{not json' });
    const parsed = await parseMcpRequest(req);
    expect(parsed.body).toBeUndefined();
    expect(parsed.raw).toBe('{not json');
  });

  it('does not read a body for GET', async () => {
    const parsed = await parseMcpRequest(mockReq({ method: 'GET' }));
    expect(parsed.raw).toBe('');
    expect(parsed.specVersion).toBeUndefined();
  });

  it('rejects an oversized body', async () => {
    const req = mockReq({ body: 'x'.repeat(5 * 1024 * 1024) });
    await expect(parseMcpRequest(req)).rejects.toThrow(/exceeds/);
  });
});

// ─── SEP-2549 cache hints ────────────────────────────────────────────────────

describe('cache hints (SEP-2549)', () => {
  function fakeTransport() {
    const sent: any[] = [];
    return { sent, transport: { send: async (m: unknown) => { sent.push(m); } } };
  }

  it('adds ttlMs and cacheScope to a tools/list result', async () => {
    const { sent, transport } = fakeTransport();
    decorateWithCacheHints(transport, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await transport.send({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    expect(sent[0].result.ttlMs).toBeGreaterThan(0);
    expect(sent[0].result.cacheScope).toBe('session');
  });

  it('uses a shorter TTL for resources/read', async () => {
    const list = fakeTransport();
    decorateWithCacheHints(list.transport, { method: 'tools/list' });
    await list.transport.send({ id: 1, result: {} });

    const read = fakeTransport();
    decorateWithCacheHints(read.transport, { method: 'resources/read' });
    await read.transport.send({ id: 1, result: {} });

    expect(read.sent[0].result.ttlMs).toBeLessThan(list.sent[0].result.ttlMs);
  });

  it('never marks a tool call cacheable — it is a live telemetry query', async () => {
    const { sent, transport } = fakeTransport();
    decorateWithCacheHints(transport, { jsonrpc: '2.0', id: 1, method: 'tools/call' });
    await transport.send({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    expect(sent[0].result.ttlMs).toBeUndefined();
    expect(sent[0].result.cacheScope).toBeUndefined();
  });

  it('leaves error responses alone', async () => {
    const { sent, transport } = fakeTransport();
    decorateWithCacheHints(transport, { method: 'tools/list' });
    await transport.send({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'nope' } });
    expect(sent[0].result).toBeUndefined();
    expect(sent[0].error).toBeDefined();
  });
});
