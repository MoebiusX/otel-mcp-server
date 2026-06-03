/**
 * Version model & helpers.
 *
 * Defines the per-backend version-support metadata attached to skills, plus the
 * pure functions that classify a detected version into a support tier and
 * decide whether a protocol feature is available.
 *
 * Design notes:
 *  - Support is declared per *product* (`productVersions`), since products that
 *    share a protocol (e.g. PromQL) ship the same feature at different versions.
 *  - `protocolFeaturesSince` is keyed by the protocol's versioned-feature union
 *    (compile-time checked via `FeatureOf<P>`), mapping each feature to the
 *    product version where it became available.
 *  - When a version cannot be detected, gating is *optimistic*: features are
 *    attempted with a warning rather than blocked. See `supportsFeature`.
 */

import type { FeatureOf, ProtocolId } from './protocols.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SupportTier {
  /** Latest supported major(s) — first-class support. */
  must: string[];
  /** Previous major(s) — supported. */
  should?: string[];
  /** Residual tail — best-effort. */
  optional?: string[];
}

/**
 * Version support for a single backend product, bound to its protocol so that
 * `protocolFeaturesSince` keys are checked against that protocol's features.
 */
export interface BackendVersionSupport<P extends ProtocolId = ProtocolId> {
  /** Protocol this backend speaks. */
  protocol: P;
  /** Supported product version ranges by tier. */
  productVersions: SupportTier;
  /** Versioned protocol feature → product version it first appeared in. */
  protocolFeaturesSince?: Partial<Record<FeatureOf<P>, string>>;
}

/** Map of backend display name → its version support entry. */
export type SkillVersionSupport = Record<string, BackendVersionSupport>;

/**
 * Typed builder for a backend version-support entry.
 *
 * Binding the protocol id at the call site makes `protocolFeaturesSince` keys
 * checked against that protocol's feature union (a `logql` feature cannot be
 * declared on a `promql` backend).
 */
export function backend<P extends ProtocolId>(
  protocol: P,
  productVersions: SupportTier,
  protocolFeaturesSince?: Partial<Record<FeatureOf<P>, string>>,
): BackendVersionSupport<P> {
  return { protocol, productVersions, protocolFeaturesSince };
}

/** Outcome of classifying a detected version against declared support. */
export type SupportLevel = 'must' | 'should' | 'optional' | 'unsupported' | 'unknown';

/** Result of a feature-availability check. */
export type FeatureGate =
  | { available: true; reason: 'baseline' | 'versioned' }
  | { available: false; reason: 'below-min'; since: string }
  | { available: false; reason: 'not-in-protocol' }
  | { available: 'unknown'; reason: 'version-undetected'; since?: string };

// ─── Version normalization & comparison ──────────────────────────────────────

/**
 * Coerce a raw backend version string into a `[major, minor, patch]` tuple.
 *
 * Handles `v`-prefixes, two-segment versions (`24.3` → `24.3.0`), extra build
 * segments (ClickHouse `24.3.1.2002` → `24.3.1`), and trailing pre-release /
 * build metadata. Returns `null` if no numeric version can be parsed.
 */
export function parseVersion(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .replace(/^v/i, '')
    .match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Compare two version strings: -1, 0, or 1. Unparseable sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** `detected >= since`? Returns false if either is unparseable. */
export function versionAtLeast(detected: string, since: string): boolean {
  const pd = parseVersion(detected);
  const ps = parseVersion(since);
  if (!pd || !ps) return false;
  return compareVersions(detected, since) >= 0;
}

/**
 * Does a detected version satisfy a declared range token?
 *
 * Supported tokens:
 *  - exact / partial: `3`, `3.1`, `3.1.4`  (prefix match on supplied segments)
 *  - x-ranges: `3.x`, `2.5.x`
 *  - comparators: `>=2.7`, `>2.7`, `<=3`, `<3`
 *  - LTS / annotations are ignored (`24.3 LTS` → `24.3`)
 */
export function matchesRange(detected: string, token: string): boolean {
  const pd = parseVersion(detected);
  if (!pd) return false;
  const t = token.trim().replace(/\s*\(.*\)\s*/g, ' ').replace(/\bLTS\b/i, '').trim();

  const cmp = t.match(/^(>=|<=|>|<)\s*(.+)$/);
  if (cmp) {
    const c = compareVersions(detected, cmp[2]);
    switch (cmp[1]) {
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
    }
  }

  // x-range or prefix match: compare only the segments explicitly given.
  const cleaned = t.replace(/^v/i, '');
  const segs = cleaned.split('.');
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === 'x' || s === '*' || s === '') continue;
    if (Number(s) !== pd[i]) return false;
  }
  return true;
}

/** Does the detected version match any token in the list? */
function matchesAny(detected: string, tokens: string[] | undefined): boolean {
  return !!tokens && tokens.some((t) => matchesRange(detected, t));
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a detected version against a declared support tier.
 * Returns `'unknown'` when no version was detected (null/empty).
 */
export function classify(detected: string | null | undefined, tier: SupportTier): SupportLevel {
  if (!detected || !parseVersion(detected)) return 'unknown';
  if (matchesAny(detected, tier.must)) return 'must';
  if (matchesAny(detected, tier.should)) return 'should';
  if (matchesAny(detected, tier.optional)) return 'optional';
  return 'unsupported';
}

// ─── Feature gating ──────────────────────────────────────────────────────────

/**
 * Decide whether a protocol feature is available on a backend.
 *
 * Resolution order:
 *  1. Baseline features (always available) — caller passes the protocol's
 *     `baselineFeatures` list. (Handled by `supportsCapability`.)
 *  2. Versioned features — compare detected version against the per-product
 *     `protocolFeaturesSince` entry.
 *  3. Unknown version — optimistic: report `'unknown'` so callers can attempt
 *     with a warning rather than hard-block.
 */
export function supportsFeature(
  support: BackendVersionSupport,
  feature: string,
  detectedVersion: string | null | undefined,
): FeatureGate {
  const since = support.protocolFeaturesSince?.[feature as keyof typeof support.protocolFeaturesSince];
  if (since === undefined) {
    // Not a tracked versioned feature for this protocol.
    return { available: false, reason: 'not-in-protocol' };
  }
  if (!detectedVersion || !parseVersion(detectedVersion)) {
    return { available: 'unknown', reason: 'version-undetected', since };
  }
  if (versionAtLeast(detectedVersion, since)) {
    return { available: true, reason: 'versioned' };
  }
  return { available: false, reason: 'below-min', since };
}

/**
 * High-level capability check that also accounts for baseline features.
 *
 * @param baselineFeatures the protocol's always-available capability list.
 */
export function supportsCapability(
  support: BackendVersionSupport,
  baselineFeatures: string[],
  feature: string,
  detectedVersion: string | null | undefined,
): FeatureGate {
  if (baselineFeatures.includes(feature)) {
    return { available: true, reason: 'baseline' };
  }
  return supportsFeature(support, feature, detectedVersion);
}
