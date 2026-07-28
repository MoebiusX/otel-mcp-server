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

  it('treats a FUTURE unrecognized revision as the newest we implement', () => {
    // Old revisions stay valid for >=12 months under the spec's deprecation
    // policy, so a value dated after ours is a revision published after this
    // build; serving it with our newest behaviour is the forward-compatible
    // reading.
    expect(resolveSpecVersion({ header: '2027-01-01' })).toBe(MCP_SPEC_LATEST);
  });

  it('does NOT infer stateless serving from an older or malformed revision', () => {
    // Regression: any unrecognized value returned MCP_SPEC_LATEST, so a typo
    // or a pre-dating revision was silently given 2026 stateless handling it
    // cannot use. Stateless must be something a client asks for.
    expect(resolveSpecVersion({ header: '2019-01-01' })).toBeUndefined();
    expect(resolveSpecVersion({ header: 'garbage' })).toBeUndefined();
  });

  it('covers every protocol version the bundled SDK accepts', async () => {
    // A revision the SDK honours but this list omits would be treated as
    // unrecognized — the class of bug that made 2024-10-07 misroute.
    const { SUPPORTED_PROTOCOL_VERSIONS } = await import('@modelcontextprotocol/sdk/types.js');
    for (const v of SUPPORTED_PROTOCOL_VERSIONS as string[]) {
      expect(isKnownSpecVersion(v), `SDK supports ${v}; add it to MCP_SPEC_VERSIONS`).toBe(true);
    }
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

  it('drops values fetch() would throw on, so a client cannot break its own call', () => {
    // Regression: only CR/LF/NUL were rejected, but fetch() throws on any
    // header value with a character above U+00FF or a DEL — so an emoji in
    // baggage turned a valid tool call into a failed backend query.
    for (const bad of ['k=🔥', 'k=ab', 'k=café']) {
      const ctx = contextFromRequest({ meta: { traceparent: TRACEPARENT, baggage: bad } });
      expect(ctx.traceparent, `traceparent should survive alongside a bad baggage`).toBe(TRACEPARENT);
      expect(ctx.baggage, `baggage ${JSON.stringify(bad)} must be dropped`).toBeUndefined();
    }
  });

  it('drops an over-long value (W3C caps baggage at 8192)', () => {
    const ctx = contextFromRequest({
      meta: { traceparent: TRACEPARENT, baggage: 'k=' + 'a'.repeat(9000) },
    });
    expect(ctx.baggage).toBeUndefined();
  });

  it('keeps ordinary tracestate and baggage syntax intact', () => {
    const ctx = contextFromRequest({
      meta: { traceparent: TRACEPARENT, tracestate: 'rojo=00f067aa0ba902b7,congo=t61rcWkgMzE', baggage: 'userId=alice,serverNode=DF%2028' },
    });
    expect(ctx.tracestate).toBe('rojo=00f067aa0ba902b7,congo=t61rcWkgMzE');
    expect(ctx.baggage).toBe('userId=alice,serverNode=DF%2028');
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

  it('rejects a batch whose first message disagrees with the headers', () => {
    const batch = [body, { jsonrpc: '2.0', id: 2, method: 'tools/list' }];
    const bad = mockReq({ headers: { 'mcp-method': 'tools/list' } });
    expect(checkRoutingHeaders(bad, batch)).toMatchObject({ ok: false });
  });

  it('does not reject when there is no body to disagree with', () => {
    expect(checkRoutingHeaders(mockReq({ headers: { 'mcp-method': 'tools/list' } }), undefined)).toEqual({ ok: true });
  });

  it('rejects a batch whose LATER message names a different method', () => {
    // Regression: only the first message was checked, so a batch could show a
    // gateway a benign Mcp-Method while message two called something the
    // gateway would have blocked — exactly the smuggling SEP-2243 prevents.
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'traces_search' } },
    ];
    const req = mockReq({ headers: { 'mcp-method': 'tools/list' } });
    expect(checkRoutingHeaders(req, batch)).toMatchObject({
      ok: false,
      header: 'Mcp-Method',
      actual: 'tools/call',
    });
  });

  it('rejects a batch whose later message names a different tool', () => {
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'metrics_query' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'traces_search' } },
    ];
    const req = mockReq({ headers: { 'mcp-method': 'tools/call', 'mcp-name': 'metrics_query' } });
    expect(checkRoutingHeaders(req, batch)).toMatchObject({ ok: false, header: 'Mcp-Name' });
  });

  it('accepts a batch where every message agrees with the headers', () => {
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'metrics_query' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'metrics_query' } },
    ];
    const req = mockReq({ headers: { 'mcp-method': 'tools/call', 'mcp-name': 'metrics_query' } });
    expect(checkRoutingHeaders(req, batch)).toEqual({ ok: true });
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

  it('does not rewrite Accept for a pre-2026 client', () => {
    // Regression: the rewrite was unconditional, so a 2025 client asking for
    // JSON only got an SSE response it cannot parse instead of an honest 406.
    const req = mockReq({ headers: { accept: 'application/json' } });
    adaptHeadersForSdk(req, '2025-06-18');
    expect(req.headers['accept']).toBe('application/json');
  });

  it('does not rewrite Accept on GET', () => {
    // Regression: forcing text/event-stream on a GET satisfied the SDK's check
    // for a client that never asked for a stream, handing it one anyway.
    const req = mockReq({ method: 'GET', headers: { accept: 'application/json' } });
    adaptHeadersForSdk(req, '2026-07-28');
    expect(req.headers['accept']).toBe('application/json');
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
    decorateWithCacheHints(list.transport, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await list.transport.send({ jsonrpc: '2.0', id: 1, result: {} });

    const read = fakeTransport();
    decorateWithCacheHints(read.transport, { jsonrpc: '2.0', id: 1, method: 'resources/read' });
    await read.transport.send({ jsonrpc: '2.0', id: 1, result: {} });

    expect(read.sent[0].result.ttlMs).toBeLessThan(list.sent[0].result.ttlMs);
  });

  it('ignores a notification (no id, so no response to hint)', async () => {
    const { sent, transport } = fakeTransport();
    decorateWithCacheHints(transport, { jsonrpc: '2.0', method: 'tools/list' });
    await transport.send({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    expect(sent[0].result.ttlMs).toBeUndefined();
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
    decorateWithCacheHints(transport, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await transport.send({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'nope' } });
    expect(sent[0].result).toBeUndefined();
    expect(sent[0].error).toBeDefined();
  });

  it('hints each batch response by its own method, not the batch head', async () => {
    // Regression: one hint was derived from the first message and stamped on
    // every response, so a tools/call result riding behind a tools/list in a
    // batch was advertised cacheable for 5 minutes — an agent could then reuse
    // a stale telemetry answer.
    const { sent, transport } = fakeTransport();
    decorateWithCacheHints(transport, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'metrics_query' } },
    ]);

    await transport.send({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    await transport.send({ jsonrpc: '2.0', id: 2, result: { content: [] } });

    expect(sent[0].result.ttlMs, 'tools/list is cacheable').toBeGreaterThan(0);
    expect(sent[1].result.ttlMs, 'tools/call must never be cacheable').toBeUndefined();
    expect(sent[1].result.cacheScope).toBeUndefined();
  });

  it('does not hint a response whose id was never requested', async () => {
    const { sent, transport } = fakeTransport();
    decorateWithCacheHints(transport, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await transport.send({ jsonrpc: '2.0', id: 99, result: { tools: [] } });
    expect(sent[0].result.ttlMs).toBeUndefined();
  });
});
