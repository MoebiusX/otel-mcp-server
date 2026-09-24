/**
 * MCP specification-version awareness.
 *
 * Distinct from `versions.ts` / `protocols.ts`, which model *backend product*
 * versions (Prometheus 2.x, PromQL features…). This module models the **MCP
 * protocol spec** the client is speaking, so the HTTP layer can serve
 * 2026-07-28 clients and pre-2026 clients from the same process.
 *
 * Why this lives in our layer: SDK v1 tops out at protocol `2025-11-25` and
 * rejects an unknown `MCP-Protocol-Version` header outright. Everything
 * 2026-07-28 changed at the transport/lifecycle level — the removed
 * handshake and session, the new routing headers, cache hints, trace context
 * — is therefore implemented here, above the SDK, and the header is
 * translated down to a version the SDK accepts before the request reaches it.
 *
 * The feature flags below are what the rest of the code branches on; nothing
 * should compare version strings directly.
 */

/**
 * MCP spec revisions this server knows about, oldest first.
 *
 * Must stay a superset of the bundled SDK's `SUPPORTED_PROTOCOL_VERSIONS`: a
 * revision the SDK accepts but this list omits would be treated as
 * unrecognized and served with the newest behaviour, silently giving an old
 * client stateless handling it cannot use.
 */
export const MCP_SPEC_VERSIONS = [
  '2024-10-07',
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
  '2026-07-28',
] as const;

export type McpSpecVersion = (typeof MCP_SPEC_VERSIONS)[number];

/** The newest revision this server implements. */
export const MCP_SPEC_LATEST: McpSpecVersion = '2026-07-28';

/**
 * Highest revision the bundled SDK understands. Requests declaring a newer
 * revision get this value in the header handed down to the SDK; our own layer
 * keeps the client's real revision for behaviour decisions.
 */
export const MCP_SPEC_SDK_MAX: McpSpecVersion = '2025-11-25';

/** Header carrying the client's spec revision (unchanged name in 2026-07-28). */
export const PROTOCOL_VERSION_HEADER = 'mcp-protocol-version';

/** Routing headers introduced by SEP-2243. */
export const METHOD_HEADER = 'mcp-method';
export const NAME_HEADER = 'mcp-name';

/** `_meta` keys defined by the 2026-07-28 revision. */
export const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
/** W3C Trace Context keys (SEP-414), fixed by the spec so traces correlate. */
export const TRACEPARENT_META_KEY = 'traceparent';
export const TRACESTATE_META_KEY = 'tracestate';
export const BAGGAGE_META_KEY = 'baggage';

/**
 * Cache hints for list results (SEP-2549). The tool and resource inventory is
 * fixed for a process's lifetime — skills register at construction and never
 * change — so a long TTL is honest. Kept to 5 minutes anyway so a rolling
 * deploy that changes the enabled skill set converges quickly.
 */
export const TOOL_LIST_TTL_MS = 300_000;

/**
 * The overview resource is generated from the same fixed skill set but embeds
 * availability, which follows backend configuration; a shorter TTL keeps it
 * from pinning a stale picture of which backends are reachable.
 */
export const RESOURCE_TTL_MS = 60_000;

export interface McpSpecFeatures {
  /**
   * The initialize/initialized handshake is gone; client identity and
   * capabilities ride in `_meta` on every request (SEP-2575).
   */
  statelessLifecycle: boolean;
  /** `Mcp-Session-Id` is removed from the protocol (SEP-2567). */
  sessionIdRemoved: boolean;
  /** `Mcp-Method`/`Mcp-Name` are required and must agree with the body (SEP-2243). */
  routingHeaders: boolean;
  /** List/read results carry `ttlMs` + `cacheScope` (SEP-2549). */
  cacheHints: boolean;
  /** W3C trace context propagates through `_meta` (SEP-414). */
  traceContext: boolean;
  /** Capabilities carry a reverse-DNS `extensions` map (SEP-2133). */
  extensionsMap: boolean;
  /** `server/discover` replaces initialize for capability discovery (SEP-2575). */
  serverDiscover: boolean;
}

const PRE_2026: McpSpecFeatures = {
  statelessLifecycle: false,
  sessionIdRemoved: false,
  routingHeaders: false,
  cacheHints: false,
  traceContext: false,
  extensionsMap: false,
  serverDiscover: false,
};

const V2026: McpSpecFeatures = {
  statelessLifecycle: true,
  sessionIdRemoved: true,
  routingHeaders: true,
  cacheHints: true,
  traceContext: true,
  extensionsMap: true,
  serverDiscover: true,
};

/** Feature set for a spec revision. Unknown/absent revisions get pre-2026 behaviour. */
export function specFeatures(version: McpSpecVersion | undefined): McpSpecFeatures {
  return version === '2026-07-28' ? V2026 : PRE_2026;
}

/** Is this a revision we recognize? */
export function isKnownSpecVersion(value: string): value is McpSpecVersion {
  return (MCP_SPEC_VERSIONS as readonly string[]).includes(value);
}

/** MCP revisions are dated `YYYY-MM-DD`. */
const SPEC_VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the spec revision a request is speaking.
 *
 * Explicit `MCP-Protocol-Version` wins. Absent it, a request carrying the
 * 2026-only routing headers or the `_meta` clientInfo key is treated as
 * 2026-07-28 — 2026 clients are expected to send those unconditionally, and
 * inferring is what lets a client that omits the version header still get
 * correct stateless handling rather than the SDK's session-based path.
 *
 * Returns `undefined` when nothing indicates a revision (the caller then
 * follows pre-2026 behaviour, which is also the SDK's default).
 */
export function resolveSpecVersion(input: {
  header?: string | undefined;
  hasRoutingHeaders?: boolean;
  hasClientInfoMeta?: boolean;
}): McpSpecVersion | undefined {
  const header = input.header?.trim();
  if (header && isKnownSpecVersion(header)) return header;
  if (header) {
    // Revisions are dates, so a well-formed value later than our newest is a
    // revision published after this build: serve it with our newest behaviour
    // rather than refusing, since the spec's deprecation policy guarantees
    // what we implement stays valid for >=12 months.
    //
    // The date-shape check is load-bearing, not decoration: these are string
    // comparisons, and letters sort after digits, so a bare `header >
    // MCP_SPEC_LATEST` treats "garbage" as a future revision. Anything not
    // date-shaped, or dated before our newest, falls through to pre-2026
    // handling — stateless serving is behaviour a client asks for, never
    // something inferred from an unparseable string.
    if (SPEC_VERSION_SHAPE.test(header) && header > MCP_SPEC_LATEST) return MCP_SPEC_LATEST;
    return undefined;
  }
  if (input.hasRoutingHeaders || input.hasClientInfoMeta) return '2026-07-28';
  return undefined;
}

/**
 * The value to hand down to the SDK transport. SDK v1 rejects any revision it
 * does not know with a 400, so a 2026-07-28 request is presented to it as the
 * newest revision it accepts. This is a translation, not a downgrade: the
 * wire-visible behaviour the client sees is decided by our layer from the
 * *real* revision.
 */
export function sdkProtocolVersion(version: McpSpecVersion | undefined): McpSpecVersion | undefined {
  if (!version) return undefined;
  return version > MCP_SPEC_SDK_MAX ? MCP_SPEC_SDK_MAX : version;
}
