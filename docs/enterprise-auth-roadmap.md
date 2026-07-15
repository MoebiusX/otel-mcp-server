# Enterprise-Auth Hardening Roadmap (HTTP transport)

Closing the gap between what shipped in v1.8.0 (JIT privileged identity +
Enterprise-Managed Authorization / ID-JAG) and a fully enterprise-grade,
OAuth 2.1-conformant, HA-deployable MCP auth surface.

Every phase preserves the hard constraints: `MCP_JIT_MODE=off` stays the
default, the static-key + EMA flows keep working, the
`io.modelcontextprotocol/enterprise-managed-authorization` extension stays
conformant, and the **zero-runtime-dependency** posture holds (`node:crypto` +
`zod` only; any external store/registry backend is operator-supplied via
dynamic `import()`, never in `package.json` `dependencies`).

## Anchor decision: the token store

The token-store choice ripples through every other workstream (DPoP binding,
introspection, revocation, resource indicators all touch token state), so it
was pressure-tested with an independent 3-way design panel:

| Approach | Score | Verdict |
|----------|:-----:|---------|
| **Pluggable async store** (opaque `mcpj_` token + injectable store adapter) | **7** | **Chosen — the spine** |
| Hybrid (stateless signed token + shared denylist) | 6 | Rejected as token *format*; its denylist idea adopted |
| Stateless JWT (self-contained signed token, no store) | 5 | Rejected |

**Chosen: a pluggable async `JitTokenStore`, augmented with the hybrid's one
good idea — a single short-TTL, self-bounding denylist abstraction reused for
every single-use cache** (ID-JAG `redeemedJtis` today; DPoP / `private_key_jwt`
`jti` sets later).

Why, from the panel:

- **Only clean backward-compatible superset.** The token string
  `mcpj_<id>.<secret>` and `sha256(full)` hashing (`jit.ts:202-218`) stay
  byte-identical, so outstanding tokens keep validating against any adapter.
  The JWT approaches rewrite `TOKEN_RE`/`JitTokenRecord`, force a dual-path
  `validate()`, and invalidate outstanding tokens on the format switch.
- **Preserves the OWASP MCP01/MCP07 invariants** the module header claims.
  Stateless/hybrid both regress two load-bearing controls: `maxActiveTokens` /
  `activeCount()` (uncountable without a store) and cheap universal `revoke()`.
- **The JWT approaches don't even escape the store work** — revoke + once-only
  rotation still need a shared, atomic, CAS-capable denylist, so they pay the
  full store cost *plus* a signing subsystem *plus* a security-control
  regression, for a hot-path latency win a short local cache already matches.
- **The hybrid's good idea we keep:** a denylist whose entries self-expire at
  token `exp` (≤1h) is naturally bounded and structurally removes the
  `MAX_REDEEMED_JTIS` fail-closed-as-DoS problem. We adopt that shape for the
  replay/denylist structures only — not for the token.

Two design corrections the panel insisted on:

1. **No bundled Redis client.** Ship a generic external-store adapter contract
   with `MemoryJitStore` as the unconditional zero-dep default; any network
   backend loads via dynamic `import()` behind `MCP_JIT_STORE`.
2. **Do not externalize the session store.** `SessionStore.sessions` holds live
   transport/server objects that can't be serialized. Session HA is a
   *deployment* choice (sticky routing on `Mcp-Session-Id`, or the stateless
   Streamable transport with no `sessionIdGenerator`); the principal binding is
   already recomputed per request, so it survives stateless mode. Docs, not code.

**The store interface exposes atomic compound primitives, not get/set** — this
is the central design risk and the main effort driver:

- `insertIfUnderCapacity(record, cap)` — capacity check + insert as one atomic
  op (replaces the `activeCount()`-then-`mint()` gate).
- `rotate(oldId, newRecord)` — compare-and-set on `old.rotated === false`,
  insert new, prune grace corpses (replaces the read-modify-write in `refresh()`).
- `revoke` / `get` / `count` / `sweep` (`sweep` is a no-op under a TTL-native backend).

The memory adapter implements these trivially (single-threaded); a network
backend implements them via MULTI/Lua/transactions.

---

## Phase 0 — Quick wins (no dependencies; ship in parallel)

**Goal:** immediate correctness/interop value, none of it blocked by the store work.

- **EdDSA (Ed25519) verification** — `enterprise-auth.ts` ALGS map: add
  `EdDSA` (`kty: 'OKP'`, `crv: 'Ed25519'`); widen the `hash` type to
  `string | null`; the verify branch passes `null` alg (hash is intrinsic);
  allow `kty === 'OKP'` through `refreshJwks()` and the no-kid `keyFor()` filter.
  `createPublicKey({ format: 'jwk' })` imports OKP on Node ≥20.
- **Configurable `MAX_REDEEMED_JTIS` + size gauge** — env-drive the cap, add a
  cache-size gauge in `metrics.ts`, keep fail-closed (the full fix lands in
  Phase 1 via the shared bounded denylist), document the sizing formula.

> **Moved to Phase 2:** the discovery-metadata gating fix (serve well-known
> metadata for non-enterprise deployments). On implementation review it isn't a
> quick win — doing it correctly means designing what a non-enterprise AS
> advertises (grant types, `token_endpoint_auth_methods`, resource indicators),
> which is exactly the metadata work Phase 2 already owns. Enterprise-mode
> discovery already works today.

**Effort:** S · **Satisfies:** RFC 8037 (EdDSA JWS) · **Risk:** very low (all
additive) · **Verify:** EdDSA verify against a real Ed25519 JWKS vector; assert
the configurable cap + gauge.

---

## Phase 1 — HA-deployable token store ★ closes the #1 enterprise blocker ★

**Goal:** tokens and single-use replay state survive restart and work correctly
across replicas behind a load balancer. **This is the phase that makes the
server genuinely HA-deployable.**

- **`JitTokenStore` async interface + atomic primitives** (`src/jit-store.ts`):
  replace the `tokens` and `lineageMembers` Maps with a constructor-injected
  store exposing `insertIfUnderCapacity` / `rotate` (CAS) / `get` / `revoke` /
  `count` / `sweep`.
- **`MemoryJitStore` default** — in-tree, zero-dep, identical current behaviour
  (keeps "restart invalidates all tokens").
- **Async-ify the service** — `issue/validate/refresh/revoke/revokeById/sweep/
  activeCount` return `Promise`s and route through the store; `await` at the
  already-async call sites in `jit-endpoints.ts` and `index.ts`.
- **Store selection** — `MCP_JIT_STORE=memory|<adapter>` via a dynamic-import
  factory; external adapters never enter `package.json` `dependencies`.
- **Shared bounded denylist** — same async shape; **move
  `enterprise-auth.ts:redeemedJtis` onto it** or single-use ID-JAG replay
  silently degrades to per-replica under HA. Entries self-expire at `exp` →
  naturally bounded. This same primitive later hosts DPoP `jti` sets (Phase 3)
  and rate-limit counters (Phase 4).
- **Hot-path latency guard** — optional short-TTL local `validate()` cache so an
  external store's RTT isn't paid on every MCP call.
- **Session HA = docs** — document sticky routing on `Mcp-Session-Id` or the
  stateless Streamable transport.

**Effort:** L · **Risk (highest of the plan):** cross-replica TOCTOU if the
interface were get/set (mitigated by the atomic primitives); `redeemedJtis`
being overlooked (explicitly folded in here); a persistent adapter reversing the
"restart invalidates" semantic (gated behind opt-in adapter selection) ·
**Verify:** the existing JIT unit suite passes unchanged against `MemoryJitStore`
(behavioural parity); a store-contract suite runs against memory + a stub
adapter; an **HA correctness test** with two service instances sharing one store
asserts (a) a token minted on A validates on B across restart, (b) `refresh()`
once-only holds under concurrent rotate on A and B, (c) `insertIfUnderCapacity`
never exceeds the cap under concurrent mint, (d) an ID-JAG redeemed on A is
rejected on B.

---

## Phase 2 — OAuth 2.1 AS conformance ★ standards-conformant token endpoints ★

**Goal:** bring the JIT endpoints into RFC-standard shape and satisfy the one
genuinely MCP-normative item (resource indicators). Introspection/revocation
become *meaningful* now that Phase 1 gave us a shared/persistent store.

- **RFC 8707 Resource Indicators** (highest value; MCP-normative on the
  client→server path) — accept optional `resource` on `POST /auth/token` (both
  grants), validate it equals `config.resource`, add `JitTokenRecord.audience`
  (default = config resource id so pre-existing tokens stay valid), enforce
  `aud` at `validate()`. Extends the pattern `verifyIdJag` already uses.
- **RFC 6749 `client_credentials` grant** (gap #5) — new `grant_type` branch in
  `handleMint` with `client_secret_basic`/`client_secret_post`, space-delimited
  `scope`, and the §5.1 response body, reusing `service.issue()`. Leave the
  legacy JSON `{scopes, ttlSeconds}` → 201 `{token}` path untouched.
- **RFC 7009 Revocation** — RFC-shaped `handleRevoke` alias (form-encoded
  `token=<mcpj_…>`, 200 empty on success/unknown); semantics already exist.
- **RFC 7662 Introspection** — new `handleIntrospect`; `validate()` + record map
  1:1 to `{active, scope, exp, iat, token_type, sub, client_id, aud}`;
  static-key authenticated. Cross-replica-useful only post-Phase 1.
- **Metadata correctness + discovery gating** (moved from Phase 0) — advertise
  the real grant set, add `revocation_endpoint`/`introspection_endpoint`, fix
  `token_endpoint_auth_methods_supported` from `['none']` to the client-auth
  methods the mint path actually accepts, and serve the well-known documents +
  `WWW-Authenticate` `resource_metadata` pointer for non-enterprise deployments
  too (deriving the resource id from config or the request base URL). This is
  where "what a JIT-only AS advertises" gets designed correctly.

**Effort:** L · **Satisfies:** RFC 8707, RFC 6749 §4.4/§5.1, RFC 7009, RFC 7662,
RFC 8414, MCP 2025-11-25 (RS classification) · **Risk:** scope discipline — do
**not** build auth-code+PKCE or DCR here; default `audience` to the resource id
so in-flight tokens aren't rejected on deploy; don't advertise
`client_credentials` in metadata before the branch ships · **Verify:**
conformance-style tests per RFC (client_credentials §5.1 body; `resource`
mismatch → `invalid_target`; token bound to resource A rejected for B; RFC 7009
200 for known+unknown; introspection `active:false` for revoked/expired; AS
metadata validates against an RFC 8414 schema).

---

## Phase 3 — Sender-constrained tokens + client auth (gaps #3, #6)

**Goal:** offer proof-of-possession (DPoP) and stronger client auth
(`private_key_jwt`), all opt-in.

- **`src/dpop.ts`** — `verifyDpopProof()` + RFC 7638 `jwkThumbprint()`, mirroring
  the enterprise-auth JWS verifier: verify the proof against its embedded `jwk`,
  check `htm`/`htu`/`iat` freshness, single-use `jti` (via the Phase-1 shared
  denylist), and `ath == base64url(SHA-256(token))`. All `node:crypto`.
- **cnf binding** — optional `cnf?: { jkt }` on `JitTokenRecord`, threaded
  through `issue()`/`mint()` and **preserved across `refresh()`** so rotation
  stays bound to the same client key.
- **Token endpoint + request path** — read/verify the `DPoP` header at mint;
  on the MCP request path, if `record.cnf.jkt` is present require+verify a
  request-bound proof (reconstruct the absolute `htu` from forwarded headers),
  else 401; advertise `DPoP algs="…"` in `WWW-Authenticate` *without removing*
  existing challenges; `extractCredential()` also accepts the `DPoP` scheme.
- **`private_key_jwt`** — accept `client_assertion` verified against a per-client
  registered JWKS (config-file-driven, optional), reusing the Phase-0 EdDSA path.

**Effort:** L (DPoP) + M (`private_key_jwt`) · **Satisfies:** RFC 9449, RFC 7638,
RFC 7521/7523, RFC 8037 · **Risk:** `htu` reconstruction behind a proxy is a
forwarded-header trust problem (document trusted-proxy config); Bearer→DPoP is
strictly opt-in per token (`cnf` absent ⇒ plain Bearer). **mTLS (RFC 8705) is
explicitly not done** — DPoP is the primary sender-constraint · **Verify:** DPoP
round-trip (matching proof passes; mismatched/replayed `jti`/wrong `htu`/`htm`
fail); refresh preserves `jkt`; `private_key_jwt` against a registered JWKS
including an Ed25519 key.

---

## Phase 4 — Parked hardening (gap #7)

**Goal:** rate limiting, replay-cache DoS fix, claim-mapped RBAC — mostly
config-driven defense-in-depth.

- **`src/rate-limit.ts`** — pure in-process token-bucket/fixed-window limiter
  (injectable clock, like `session-store.ts`), invoked at the top of the JIT
  handlers, keyed post-auth by parent-key id / token `rootId` and pre-auth by
  client IP; returns 429 + `Retry-After`; ships disabled/high by default.
  Cross-replica counters ride the Phase-1 shared abstraction.
- **Replay-cache DoS** — the full fix (shared, self-bounding by `exp`) lands with
  the Phase-1 denylist; add rejection + cache-size metrics.
- **Claim-mapped RBAC (cheap path)** — `grantedScopes()` honors an IdP
  `roles`/`groups` claim mapped to skill scopes via optional config, intersected
  with the `scope` claim + enabled skills; thread `sub` onto the token record +
  session principal for audit/revoke-by-user. Full local user+role store deferred.

**Effort:** M (rate limiting) + S (metrics/cap) + M (RBAC mapping) · **Risk:**
rate-limit keys depend on trusted forwarded headers; keep RBAC config-driven and
optional · **Verify:** limiter unit tests (burst → 429 + `Retry-After`, refill,
per-key isolation); RBAC test mapping a `roles` claim → intersected scopes, with
no config = unchanged behaviour.

---

## Explicitly not doing / deferred

- **Auth-code + PKCE (XL).** Needs a user-agent redirect, login UI, and consent —
  concepts a headless zero-dep server doesn't have. The 2025-11-25 spec
  classifies MCP servers as *resource servers* and allows an external AS; EMA
  already **is** that delegation. Keep `response_types_supported = []`.
- **RFC 7591 Dynamic Client Registration.** No per-client registry exists
  (identity is the static key or the IdP assertion); in the EMA model the IdP
  owns registration, so DCR would be vestigial.
- **mTLS / RFC 8705.** Poor fit for plain-HTTP-behind-proxy; DPoP covers
  proof-of-possession. An optional forwarded-client-cert mode at most.
- **Externalizing the session store.** Live transport/server objects can't be
  serialized — the answer is sticky routing or the stateless transport (docs).
- **Stateless-JWT / hybrid token format.** Regresses `maxActiveTokens` and
  universal revoke, adds a master-key blast radius, and still needs the shared
  denylist — net negative vs. the pluggable store (panel 5/6 vs 7).
- **Full local user+role store.** New subsystem; the claim-mapping path in
  Phase 4 delivers the value at a fraction of the cost.

## Sequencing

**Phase 0** (quick wins, parallel) → **Phase 1** (HA unblock — the #1 blocker) →
**Phase 2** (OAuth 2.1 AS conformance; depends on Phase 1's shared store to make
introspection/revocation real) → **Phase 3** (sender-constraint; reuses Phase 0
EdDSA + Phase 1 denylist) → **Phase 4** (hardening; reuses the Phase 1 shared
abstraction).
