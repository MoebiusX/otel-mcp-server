/**
 * Capability gating.
 *
 * Turns the declarative version-support model (`SKILL_VERSIONS` + `PROTOCOLS`)
 * and the runtime {@link versionRegistry} into a guard that tool handlers can
 * call before attempting a version-sensitive feature.
 *
 * Policy (`MCP_VERSION_GATING`):
 *  - `off`     — no gating; legacy behaviour, always proceed (no warnings).
 *  - `warn`    — proceed, but annotate the response when a feature is unlikely
 *                to be supported (the default; never worse than today).
 *  - `enforce` — block features the detected version does not support.
 *
 * Unknown versions are always treated *optimistically*: when detection fails we
 * proceed with a warning rather than block — even under `enforce` — so that a
 * probe failure is never worse than having no gating at all.
 */

import type { SkillHelpers } from './skill.js';
import { PROTOCOLS } from './protocols.js';
import { SKILL_VERSIONS } from './skill-versions.js';
import { supportsCapability, type BackendVersionSupport, type FeatureGate } from './versions.js';
import { versionRegistry, type VersionRegistry } from './version-registry.js';

// ─── Mode ────────────────────────────────────────────────────────────────────

export type GatingMode = 'off' | 'warn' | 'enforce';

/**
 * Resolve the active gating mode from the environment.
 * Defaults to `'warn'`; unrecognized values fall back to the default.
 */
export function getGatingMode(
  env: (k: string, fallback?: string) => string = (k, f = '') => process.env[k] || f,
): GatingMode {
  const raw = env('MCP_VERSION_GATING', 'warn').trim().toLowerCase();
  return raw === 'off' || raw === 'enforce' ? raw : 'warn';
}

// ─── Decision types ──────────────────────────────────────────────────────────

/** The result of evaluating one feature against a (possibly detected) version. */
export interface GateDecision {
  skillId: string;
  feature: string;
  /** Backend instance display name, when resolved from the registry. */
  instance?: string;
  /** Product the support entry was selected for. */
  product?: string;
  /** Protocol the feature belongs to. */
  protocol?: string;
  /** Detected version string, or null when undetermined. */
  detectedVersion: string | null;
  /** Underlying feature-availability verdict. */
  gate: FeatureGate;
}

/** Outcome of applying the gating policy to a {@link GateDecision}. */
export interface RequireResult {
  /** Whether the caller should proceed with the operation. */
  ok: boolean;
  /** True only when `enforce` actively blocked the operation. */
  blocked: boolean;
  /** Advisory message to surface to the caller (warn mode, or unknown version). */
  warning?: string;
  /** Error message when blocked under `enforce`. */
  error?: string;
  /** The decision this result was derived from. */
  decision: GateDecision;
}

// ─── Pure evaluation ─────────────────────────────────────────────────────────

/** Look up the declared support entry for a skill + product. */
function lookupSupport(
  skillId: string,
  product: string | undefined,
): BackendVersionSupport | undefined {
  const skillSupport = SKILL_VERSIONS[skillId];
  if (!skillSupport) return undefined;
  if (product && skillSupport[product]) return skillSupport[product];
  return Object.values(skillSupport)[0];
}

/**
 * Evaluate a feature against declared support and a detected version, without
 * consulting the runtime registry. Useful for tests and offline classification.
 */
export function evaluateFeature(
  skillId: string,
  feature: string,
  detectedVersion: string | null,
  product?: string,
): GateDecision {
  const support = lookupSupport(skillId, product);
  if (!support) {
    return {
      skillId,
      feature,
      product,
      detectedVersion,
      gate: { available: false, reason: 'not-in-protocol' },
    };
  }
  const adapter = PROTOCOLS[support.protocol];
  const baseline = adapter?.baselineFeatures ?? [];
  const gate = supportsCapability(support, baseline, feature, detectedVersion);
  return {
    skillId,
    feature,
    product: product ?? support.protocol,
    protocol: support.protocol,
    detectedVersion,
    gate,
  };
}

/**
 * Apply the gating policy to a decision, producing a proceed/block verdict and
 * any advisory or error message. Pure — does not perform I/O.
 */
export function applyGating(decision: GateDecision, mode: GatingMode): RequireResult {
  const base = { blocked: false, decision } as const;

  // Legacy mode: never gate.
  if (mode === 'off') {
    return { ok: true, ...base };
  }

  const { gate } = decision;
  const where = describeBackend(decision);

  // Available (baseline or version satisfies the minimum) → proceed silently.
  if (gate.available === true) {
    return { ok: true, ...base };
  }

  // Unknown version → optimistic pass-through with a warning, even under enforce.
  if (gate.available === 'unknown') {
    return {
      ok: true,
      ...base,
      warning:
        `Version of ${where} could not be detected; attempting "${decision.feature}" ` +
        `optimistically${gate.since ? ` (requires ${where} ≥ ${gate.since})` : ''}. ` +
        `It may fail if the backend is older.`,
    };
  }

  // We do not model this feature for the backend's protocol → do not gate it.
  if (gate.reason === 'not-in-protocol') {
    return { ok: true, ...base };
  }

  // below-min: the detected version is too old for this feature.
  const detail =
    `"${decision.feature}" requires ${where} ≥ ${gate.since}` +
    (decision.detectedVersion ? ` but ${decision.detectedVersion} was detected` : '');

  if (mode === 'enforce') {
    return { ok: false, blocked: true, decision, error: `Unsupported: ${detail}.` };
  }
  // warn
  return {
    ok: true,
    blocked: false,
    decision,
    warning: `${detail}; attempting anyway (set MCP_VERSION_GATING=enforce to block).`,
  };
}

function describeBackend(decision: GateDecision): string {
  const name = decision.product ?? decision.instance ?? decision.skillId;
  return decision.instance && decision.instance !== name
    ? `${name} (${decision.instance})`
    : name;
}

// ─── Live, registry-backed guard ─────────────────────────────────────────────

export interface RequireFeatureOptions {
  /** Specific backend instance display name to target (defaults to first configured). */
  instance?: string;
  /** Override the gating mode (defaults to `MCP_VERSION_GATING`). */
  mode?: GatingMode;
  /** Force a fresh probe rather than using the TTL cache. */
  force?: boolean;
  /** Registry to consult (defaults to the process singleton). */
  registry?: VersionRegistry;
}

/**
 * Resolve a skill's live backend version and decide whether `feature` may be
 * used, honouring `MCP_VERSION_GATING`. Never throws: registry/probe failures
 * degrade to an optimistic pass-through with a warning.
 */
export async function requireFeature(
  skillId: string,
  feature: string,
  helpers: SkillHelpers,
  opts: RequireFeatureOptions = {},
): Promise<RequireResult> {
  const mode = opts.mode ?? getGatingMode(helpers.env);
  const registry = opts.registry ?? versionRegistry;

  if (mode === 'off') {
    const decision = evaluateFeature(skillId, feature, null);
    return { ok: true, blocked: false, decision };
  }

  // Find a configured instance for this skill (optionally by name).
  const candidates = registry
    .configured(helpers.env)
    .filter((i) => i.skillId === skillId && (!opts.instance || i.instance === opts.instance));

  if (candidates.length === 0) {
    // Nothing configured to probe — evaluate declaratively with unknown version.
    const decision = evaluateFeature(skillId, feature, null);
    return applyGating(decision, mode);
  }

  const inst = candidates[0];
  let detectedVersion: string | null = null;
  let product: string | undefined = inst.product;
  try {
    const entry = await registry.resolve(inst, helpers, { force: opts.force });
    detectedVersion = entry.detectedVersion;
    product = entry.product;
  } catch {
    // Probe failed — fall through with unknown version (optimistic).
  }

  const decision = evaluateFeature(skillId, feature, detectedVersion, product);
  decision.instance = inst.instance;
  return applyGating(decision, mode);
}
