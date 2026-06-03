/**
 * Skill — the plugin abstraction for telemetry signal sources.
 *
 * Each skill is a self-contained module that:
 *  - Declares its identity and availability
 *  - Self-configures from environment variables
 *  - Registers MCP tools on the server
 *
 * Adding a new telemetry source is as simple as:
 *  1. Create a file in src/tools/ that exports `skill: Skill`
 *  2. Import it in src/skills.ts and add to the `allSkills` array
 *
 * @example
 * ```typescript
 * // src/tools/tempo.ts
 * import type { Skill, SkillHelpers } from '../skill.js';
 * import { textResult, errorResult } from '../helpers.js';
 *
 * function registerTools(server, helpers) {
 *   const url = helpers.env('TEMPO_URL');
 *   const fetch = helpers.createFetcher('TEMPO', 'tempo');
 *   server.tool('tempo_search', 'Search traces', { ... }, async (params) => { ... });
 * }
 *
 * export const skill: Skill = {
 *   id: 'tempo',
 *   name: 'Grafana Tempo',
 *   description: 'Query traces via the Grafana Tempo API',
 *   tools: 3,
 *   backends: ['Tempo'],
 *   isAvailable: () => !!process.env.TEMPO_URL,
 *   register: registerTools,
 * };
 * ```
 */

import { buildAuth } from './auth.js';
import { createFetcher as createRawFetcher, createFailoverFetcher } from './helpers.js';
import type { FetchOptions } from './helpers.js';
import type { SkillVersionSupport } from './versions.js';
import { BackendRegistry, type SkillBackendSpec } from './backends.js';

// ─── Public Types ────────────────────────────────────────────────────────────

export type Fetcher = (
  url: string,
  overrideTimeout?: number,
  options?: FetchOptions,
) => Promise<any>;

export interface Skill {
  /** Unique ID, used in the --tools CLI flag (e.g. 'traces', 'elasticsearch') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description of the skill's capabilities */
  description: string;
  /** Number of tools this skill registers */
  tools: number;
  /** Backend system names for startup display */
  backends: string[];
  /**
   * Version-support metadata: backend display name → supported product
   * versions and protocol-feature availability. Optional; skills are migrated
   * to declare this incrementally. Keys should align with `backends`.
   */
  versions?: SkillVersionSupport;
  /** Return true if this skill's backend(s) are configured and available */
  isAvailable(): boolean;
  /** Register MCP tools on the server */
  register(server: any, helpers: SkillHelpers): void;
  /**
   * Optionally probe the live backend for its version string.
   * Returns null when the version cannot be determined (gating then falls back
   * to optimistic pass-through). `backend` selects which configured backend to
   * probe for multi-backend skills (defaults to the primary).
   */
  detectVersion?(helpers: SkillHelpers, backend?: string): Promise<string | null>;
}

export interface CreateFetcherOptions {
  /** Additional headers beyond auth (e.g. X-Scope-OrgID for multi-tenant Loki) */
  extraHeaders?: Record<string, string>;
  /** Override the default timeout for all requests made by this fetcher (ms) */
  timeoutMs?: number;
}

/**
 * A resolved backend instance ready to query: its primary base URL, the full
 * ordered URL list (for failover), and a failover-aware fetcher.
 */
export interface ResolvedBackend {
  /** Instance name (`default` for the unsuffixed base var). */
  instance: string;
  /** Primary base URL (first in the failover list). */
  baseUrl: string;
  /** All candidate URLs, tried in order on infrastructure failures. */
  urls: string[];
  /** Explicit product override, when configured. */
  product?: string;
  /** Failover-aware fetcher bound to this instance's URLs and auth. */
  fetch: Fetcher;
}

export interface SkillHelpers {
  /** Default request timeout (ms), from MCP_TIMEOUT_MS env var or 15000 */
  timeoutMs: number;

  /**
   * Create an instrumented fetcher for a backend.
   *
   * Auth is auto-resolved from `{envPrefix}_AUTH_TOKEN`, `_AUTH_BASIC`,
   * or `_AUTH_HEADER` environment variables.
   *
   * @param envPrefix Env var prefix for auth resolution (e.g. 'JAEGER', 'PROMETHEUS')
   * @param backend   Backend label for self-metrics instrumentation
   * @param options   Optional extra headers and timeout override
   */
  createFetcher(
    envPrefix: string,
    backend: string,
    options?: CreateFetcherOptions,
  ): Fetcher;

  /** Read an environment variable with optional fallback */
  env(key: string, fallback?: string): string;

  /** Configured instance names for a skill's backend slot (`default` first). */
  listInstances(spec: SkillBackendSpec): string[];

  /**
   * Resolve a backend instance for a skill, optionally selecting a named
   * `target`. Returns a {@link ResolvedBackend} with a failover-aware fetcher,
   * or `null` when `target` does not match a configured instance (SSRF-safe).
   */
  resolveBackend(
    spec: SkillBackendSpec,
    backend: string,
    target?: string,
    options?: CreateFetcherOptions,
  ): ResolvedBackend | null;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Create SkillHelpers from the current process environment. */
export function createSkillHelpers(overrides?: { timeoutMs?: number }): SkillHelpers {
  const timeoutMs =
    overrides?.timeoutMs ??
    parseInt(process.env['MCP_TIMEOUT_MS'] || '15000', 10);

  const registry = new BackendRegistry();

  return {
    timeoutMs,

    createFetcher(
      envPrefix: string,
      backend: string,
      options?: CreateFetcherOptions,
    ): Fetcher {
      const auth = buildAuth(envPrefix);
      if (options?.extraHeaders) {
        auth.extraHeaders = { ...auth.extraHeaders, ...options.extraHeaders };
      }
      return createRawFetcher(options?.timeoutMs ?? timeoutMs, auth, backend);
    },

    env(key: string, fallback = ''): string {
      return process.env[key] || fallback;
    },

    listInstances(spec: SkillBackendSpec): string[] {
      return registry.names(spec);
    },

    resolveBackend(
      spec: SkillBackendSpec,
      backend: string,
      target?: string,
      options?: CreateFetcherOptions,
    ): ResolvedBackend | null {
      const inst = registry.resolve(spec, target);
      if (!inst) return null;

      const auth = buildAuth(inst.authPrefix);
      const extraHeaders = { ...inst.extraHeaders, ...options?.extraHeaders };
      if (Object.keys(extraHeaders).length > 0) {
        auth.extraHeaders = { ...auth.extraHeaders, ...extraHeaders };
      }

      return {
        instance: inst.instance,
        baseUrl: inst.urls[0],
        urls: inst.urls,
        product: inst.product,
        fetch: createFailoverFetcher(
          options?.timeoutMs ?? timeoutMs,
          auth,
          inst.urls,
          backend,
        ),
      };
    },
  };
}
