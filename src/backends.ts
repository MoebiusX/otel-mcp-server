/**
 * Multi-backend registry.
 *
 * Resolves one *or many* named instances of a backend from the environment,
 * each with an ordered list of URLs for failover. This is fully backward
 * compatible: a plain `PROMETHEUS_URL` still yields a single `default` instance.
 *
 * Configuration scheme (precedence: `MCP_BACKENDS` > suffixed env > base env):
 *
 *  - **Default instance** — the existing base var, unchanged:
 *      `PROMETHEUS_URL=http://prom:9090`            → instance `default`
 *      auth from `PROMETHEUS_AUTH_*`.
 *
 *  - **Named instances** — a `__<NAME>` suffix on the base var:
 *      `PROMETHEUS_URL__PROD=http://prom-prod:9090` → instance `PROD`
 *      auth from `PROMETHEUS__PROD_AUTH_*`.
 *
 *  - **Failover** — any URL value may be a comma-separated list or JSON array;
 *    URLs are tried in order:
 *      `PROMETHEUS_URL=http://a:9090,http://b:9090`
 *
 *  - **Rich form** — `MCP_BACKENDS` JSON for full control:
 *      `[{"skill":"metrics","instance":"PROD","urls":["http://a","http://b"],
 *         "authPrefix":"PROM_PROD","product":"Grafana Mimir",
 *         "extraHeaders":{"X-Scope-OrgID":"team-a"}}]`
 *
 * `target` selection is validated against *configured instance names only*, so a
 * caller can never coerce the server into fetching an arbitrary URL (no SSRF).
 */

/** A resolved backend instance: an ordered URL list plus its auth prefix. */
export interface BackendInstanceConfig {
  /** Owning skill id. */
  skillId: string;
  /** Instance name (`default` for the unsuffixed base var). */
  instance: string;
  /** Candidate URLs, tried in order for failover. */
  urls: string[];
  /** Env prefix for auth resolution (e.g. `PROMETHEUS` or `PROMETHEUS__PROD`). */
  authPrefix: string;
  /** Explicit product override (skips auto-probe when set). */
  product?: string;
  /** Extra request headers (e.g. multi-tenant `X-Scope-OrgID`). */
  extraHeaders?: Record<string, string>;
}

/** Describes how a skill's backend slot maps onto environment variables. */
export interface SkillBackendSpec {
  /** Owning skill id. */
  skillId: string;
  /** Base URL env var (e.g. `PROMETHEUS_URL`). */
  baseEnvVar: string;
  /** Auth/identity env prefix (e.g. `PROMETHEUS`). */
  prefix: string;
  /** Fallback URL when no env var is set (absent → slot requires explicit URL). */
  defaultUrl?: string;
}

type EnvRecord = Record<string, string | undefined>;

/** One entry of the `MCP_BACKENDS` JSON array. */
interface McpBackendEntry {
  skill: string;
  instance: string;
  urls?: string[];
  url?: string;
  authPrefix?: string;
  product?: string;
  extraHeaders?: Record<string, string>;
}

/** Split a URL env value into an ordered list (JSON array or comma-list). */
export function splitUrls(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.map((u) => String(u).trim()).filter((u) => u.length > 0);
      }
    } catch {
      /* fall through to comma-split */
    }
  }
  return trimmed.split(',').map((u) => u.trim()).filter((u) => u.length > 0);
}

/** Parse the optional `MCP_BACKENDS` JSON document; tolerant of malformed input. */
function parseMcpBackends(env: EnvRecord): McpBackendEntry[] {
  const raw = env['MCP_BACKENDS'];
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as McpBackendEntry[];
  } catch {
    /* ignore — invalid MCP_BACKENDS is a no-op, never throws */
  }
  return [];
}

/**
 * Registry that resolves a skill's configured backend instances from the
 * environment. Pure with respect to its injected `env` snapshot, so tests can
 * supply a fixed map.
 */
export class BackendRegistry {
  constructor(private readonly env: EnvRecord = process.env) {}

  /** All configured instances for a skill's backend slot, default first. */
  instancesFor(spec: SkillBackendSpec): BackendInstanceConfig[] {
    const byName = new Map<string, BackendInstanceConfig>();

    // 1. Default instance from the base env var (or its built-in default URL).
    const baseUrls = splitUrls(this.env[spec.baseEnvVar]);
    const urls = baseUrls.length > 0 ? baseUrls : spec.defaultUrl ? [spec.defaultUrl] : [];
    if (urls.length > 0) {
      byName.set('default', {
        skillId: spec.skillId,
        instance: 'default',
        urls,
        authPrefix: spec.prefix,
      });
    }

    // 2. Named instances via `${baseEnvVar}__<NAME>` suffix.
    const suffixRe = new RegExp(`^${escapeRegExp(spec.baseEnvVar)}__(.+)$`);
    for (const key of Object.keys(this.env)) {
      const m = key.match(suffixRe);
      if (!m) continue;
      const name = m[1];
      const instanceUrls = splitUrls(this.env[key]);
      if (instanceUrls.length === 0) continue;
      byName.set(name, {
        skillId: spec.skillId,
        instance: name,
        urls: instanceUrls,
        authPrefix: `${spec.prefix}__${name}`,
      });
    }

    // 3. MCP_BACKENDS overrides/additions (highest precedence).
    for (const entry of parseMcpBackends(this.env)) {
      if (entry.skill !== spec.skillId || !entry.instance) continue;
      const entryUrls = entry.urls ?? splitUrls(entry.url);
      if (!entryUrls || entryUrls.length === 0) continue;
      byName.set(entry.instance, {
        skillId: spec.skillId,
        instance: entry.instance,
        urls: entryUrls,
        authPrefix: entry.authPrefix ?? `${spec.prefix}__${entry.instance}`,
        product: entry.product,
        extraHeaders: entry.extraHeaders,
      });
    }

    // Order: default first (when present), then the rest in insertion order.
    const all = [...byName.values()];
    all.sort((a, b) => (a.instance === 'default' ? -1 : b.instance === 'default' ? 1 : 0));
    return all;
  }

  /** Configured instance names for a skill's backend slot. */
  names(spec: SkillBackendSpec): string[] {
    return this.instancesFor(spec).map((i) => i.instance);
  }

  /**
   * Resolve one instance. With no `target`, returns the primary (default, or the
   * first configured). With a `target`, returns only an instance whose name
   * matches exactly — unknown names resolve to `undefined` (SSRF-safe).
   */
  resolve(spec: SkillBackendSpec, target?: string): BackendInstanceConfig | undefined {
    const all = this.instancesFor(spec);
    if (!target) return all[0];
    return all.find((i) => i.instance === target);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
