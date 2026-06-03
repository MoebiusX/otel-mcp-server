/**
 * Runtime version registry.
 *
 * Bridges the *declared* version-support catalog (`SKILL_VERSIONS`) with the
 * *detected* product/version of each live backend instance. It owns:
 *  - a catalog of backend "instances" (one per configurable backend slot) with
 *    the env vars and protocol needed to probe them;
 *  - a lazily-populated, TTL-cached map of detected identities and the support
 *    tier each detected version classifies into.
 *
 * Detection is best-effort and never throws: probe failures and unknown
 * versions degrade gracefully so callers (e.g. the `/health` endpoint and, in a
 * later phase, feature gating) can reason optimistically.
 */

import type { SkillHelpers } from './skill.js';
import type { ProtocolId } from './protocols.js';
import { resolveIdentity, type BackendIdentity } from './detect.js';
import { SKILL_VERSIONS } from './skill-versions.js';
import { classify, type BackendVersionSupport, type SupportLevel } from './versions.js';

/** A configurable backend slot that can be probed for its version. */
export interface BackendInstance {
  /** Owning skill id (matches `Skill.id`). */
  skillId: string;
  /** Display name of this instance/slot (e.g. 'Prometheus', 'Jaeger'). */
  instance: string;
  /** Protocol this slot speaks. */
  protocol: ProtocolId;
  /** Env prefix for auth + `_PRODUCT`/`_VERSION` overrides (e.g. 'PROMETHEUS'). */
  prefix: string;
  /** Candidate URL env vars, in priority order. */
  urlEnvs: string[];
  /** Default URL when no env var is set (absent → slot requires explicit URL). */
  urlDefault?: string;
  /**
   * Fixed product name when the slot maps to exactly one product. When omitted
   * (e.g. PromQL, where one URL could be several products) the probed identity's
   * product is used to select the support entry.
   */
  product?: string;
  /** Predicate deciding whether this slot is active given the environment. */
  isConfigured(env: (k: string, fallback?: string) => string): boolean;
}

/** A resolved registry entry: declared support + detected identity + tier. */
export interface VersionEntry {
  skillId: string;
  instance: string;
  protocol: ProtocolId;
  /** Detected (or default) product name. */
  product: string;
  /** Detected version string, or null when undetermined. */
  detectedVersion: string | null;
  /** How the identity was resolved: 'config' | 'probe' | 'default'. */
  source: BackendIdentity['source'];
  /** Support tier the detected version classifies into. */
  tier: SupportLevel;
  /** Resolved URL that was probed (for diagnostics). */
  url: string;
  /** Probe error message, if any (identity then falls back to default). */
  error?: string;
}

const hasExplicitUrl =
  (envs: string[]) => (env: (k: string, fallback?: string) => string) =>
    envs.some((k) => env(k).trim().length > 0);

/** Build a single-instance descriptor for a fixed-product backend slot. */
function single(
  skillId: string,
  instance: string,
  protocol: ProtocolId,
  prefix: string,
  urlEnvs: string[],
  urlDefault: string | undefined,
  product: string,
): BackendInstance {
  const explicit = hasExplicitUrl(urlEnvs);
  return {
    skillId,
    instance,
    protocol,
    prefix,
    urlEnvs,
    urlDefault,
    product,
    // With a default URL the slot is implicitly active; otherwise it requires
    // an explicit URL to be considered configured.
    isConfigured: urlDefault ? () => true : explicit,
  };
}

/**
 * Catalog of probeable backend instances.
 *
 * Ordering mirrors `allSkills` for readability. Multi-product protocols (PromQL)
 * leave `product` undefined so the probe disambiguates; provider/agent skills
 * declare one instance per backend with a configuration predicate.
 */
export const BACKEND_INSTANCES: BackendInstance[] = [
  // ── traces (one active provider via TRACES_PROVIDER) ──
  ...(['jaeger', 'tempo', 'zipkin', 'skywalking'] as const).map((id) => {
    const meta = {
      jaeger: { name: 'Jaeger', proto: 'jaeger', prefix: 'JAEGER', envs: ['TRACES_JAEGER_URL', 'JAEGER_URL'], def: 'http://localhost:16686' },
      tempo: { name: 'Tempo', proto: 'traceql', prefix: 'TEMPO', envs: ['TRACES_TEMPO_URL', 'TEMPO_URL'], def: 'http://localhost:3200' },
      zipkin: { name: 'Zipkin', proto: 'zipkin', prefix: 'ZIPKIN', envs: ['TRACES_ZIPKIN_URL', 'ZIPKIN_URL'], def: 'http://localhost:9411' },
      skywalking: { name: 'SkyWalking', proto: 'skywalking', prefix: 'SKYWALKING', envs: ['TRACES_SKYWALKING_URL', 'SKYWALKING_URL'], def: 'http://localhost:12800' },
    }[id];
    return {
      skillId: 'traces',
      instance: meta.name,
      protocol: meta.proto as ProtocolId,
      prefix: meta.prefix,
      urlEnvs: meta.envs,
      urlDefault: meta.def,
      product: meta.name,
      isConfigured: (env: (k: string, f?: string) => string) =>
        (env('TRACES_PROVIDER', 'jaeger') || 'jaeger').toLowerCase() === id,
    } satisfies BackendInstance;
  }),

  // ── single-product query backends ──
  // metrics: one PromQL URL shared by Prometheus/Mimir/Thanos/Cortex/VM — leave
  // `product` undefined so the buildinfo probe disambiguates the real product.
  {
    skillId: 'metrics',
    instance: 'Prometheus-compatible',
    protocol: 'promql',
    prefix: 'PROMETHEUS',
    urlEnvs: ['PROMETHEUS_URL'],
    urlDefault: 'http://localhost:9090',
    isConfigured: () => true,
  },
  single('logs', 'Grafana Loki', 'logql', 'LOKI', ['LOKI_URL'], 'http://localhost:3100', 'Grafana Loki'),
  // elasticsearch: Query DSL shared with OpenSearch — probe disambiguates.
  {
    skillId: 'elasticsearch',
    instance: 'Elasticsearch-compatible',
    protocol: 'esdsl',
    prefix: 'ELASTICSEARCH',
    urlEnvs: ['ELASTICSEARCH_URL'],
    isConfigured: hasExplicitUrl(['ELASTICSEARCH_URL']),
  },
  single('alertmanager', 'Alertmanager', 'alertmanager-http', 'ALERTMANAGER', ['ALERTMANAGER_URL'], undefined, 'Alertmanager'),
  single('grafana', 'Grafana', 'grafana-http', 'GRAFANA', ['GRAFANA_URL'], undefined, 'Grafana'),
  single('cilium', 'Cilium', 'cilium-http', 'CILIUM', ['CILIUM_URL'], 'http://localhost:9234', 'Cilium'),
  single('kubernetes', 'Kubernetes', 'k8s-core', 'KUBERNETES', ['KUBERNETES_URL'], 'https://kubernetes.default.svc', 'Kubernetes'),
  single('clickhouse', 'ClickHouse', 'clickhouse', 'CLICKHOUSE', ['CLICKHOUSE_URL'], 'http://localhost:8123', 'ClickHouse'),
  single('pyroscope', 'Grafana Pyroscope', 'pyroscope', 'PYROSCOPE', ['PYROSCOPE_URL'], 'http://localhost:4040', 'Grafana Pyroscope'),
  single('opa', 'Open Policy Agent', 'opa-rest', 'OPA', ['OPA_URL'], 'http://localhost:8181', 'Open Policy Agent'),
  single('envoy', 'Envoy', 'envoy-admin', 'ENVOY', ['ENVOY_ADMIN_URL'], 'http://localhost:9901', 'Envoy'),
  single('consul', 'Consul', 'consul-http', 'CONSUL', ['CONSUL_URL'], 'http://localhost:8500', 'Consul'),
  single('kong', 'Kong', 'kong-admin', 'KONG', ['KONG_ADMIN_URL'], 'http://localhost:8001', 'Kong'),
  single('traefik', 'Traefik', 'traefik-http', 'TRAEFIK', ['TRAEFIK_URL'], 'http://localhost:8080', 'Traefik'),
  single('opentsdb', 'OpenTSDB', 'opentsdb', 'OPENTSDB', ['OPENTSDB_URL'], 'http://localhost:4242', 'OpenTSDB'),
  single('graylog', 'Graylog', 'graylog', 'GRAYLOG', ['GRAYLOG_URL'], 'http://localhost:9000', 'Graylog'),
  single('pinpoint', 'Pinpoint', 'pinpoint-http', 'PINPOINT', ['PINPOINT_URL'], 'http://localhost:8080', 'Pinpoint'),

  // ── InfluxDB: one URL, product/protocol selected by INFLUX_VERSION major ──
  ...(['1', '2', '3'] as const).map((major) => {
    const meta = {
      '1': { name: 'InfluxDB 1.x', proto: 'influxql' },
      '2': { name: 'InfluxDB 2.x', proto: 'flux' },
      '3': { name: 'InfluxDB 3.x', proto: 'influx_sql' },
    }[major];
    return {
      skillId: 'influx',
      instance: meta.name,
      protocol: meta.proto as ProtocolId,
      prefix: 'INFLUX',
      urlEnvs: ['INFLUX_URL'],
      urlDefault: 'http://localhost:8086',
      product: meta.name,
      isConfigured: (env: (k: string, f?: string) => string) => {
        const ver = env('INFLUX_VERSION').trim();
        const declared = ver ? ver.replace(/^v/i, '').split('.')[0] : '2'; // default 2.x
        return declared === major;
      },
    } satisfies BackendInstance;
  }),

  // ── pipeline agents (each its own URL, no default) ──
  single('pipeline', 'Fluent Bit', 'fluentbit-http', 'FLUENTBIT', ['FLUENTBIT_URL'], undefined, 'Fluent Bit'),
  single('pipeline', 'Beats', 'beats-http', 'BEATS', ['BEATS_URL'], undefined, 'Beats'),
  single('pipeline', 'Vector', 'vector-http', 'VECTOR', ['VECTOR_URL'], undefined, 'Vector'),
  single('pipeline', 'Grafana Alloy', 'alloy-http', 'ALLOY', ['ALLOY_URL'], undefined, 'Grafana Alloy'),

  // ── system (internal application API) ──
  single('system', 'Application API', 'app-api', 'APP_API', ['APP_API_URL'], 'http://localhost:5000', 'Application API'),
];

/** Default probe timeout (ms) — kept short so `/health` stays responsive. */
const PROBE_TIMEOUT_MS = 3000;

/** How long a resolved entry is cached before re-probing (ms). */
const DEFAULT_TTL_MS = 60_000;

interface CacheSlot {
  entry: VersionEntry;
  at: number;
}

/** Look up the declared support entry for a resolved instance + product. */
function lookupSupport(
  skillId: string,
  product: string,
): BackendVersionSupport | undefined {
  const skillSupport = SKILL_VERSIONS[skillId];
  if (!skillSupport) return undefined;
  return skillSupport[product] ?? Object.values(skillSupport)[0];
}

export class VersionRegistry {
  private cache = new Map<string, CacheSlot>();

  constructor(
    private readonly instances: BackendInstance[] = BACKEND_INSTANCES,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  private key(skillId: string, instance: string): string {
    return `${skillId}::${instance}`;
  }

  /** Instances that are configured (active) for the current environment. */
  configured(env: (k: string, fallback?: string) => string): BackendInstance[] {
    return this.instances.filter((i) => i.isConfigured(env));
  }

  /**
   * Resolve a single instance to a {@link VersionEntry}, probing the live
   * backend when a fetcher is available. Results are TTL-cached.
   */
  async resolve(
    inst: BackendInstance,
    helpers: SkillHelpers,
    opts: { force?: boolean } = {},
  ): Promise<VersionEntry> {
    const key = this.key(inst.skillId, inst.instance);
    const cached = this.cache.get(key);
    if (!opts.force && cached && Date.now() - cached.at < this.ttlMs) {
      return cached.entry;
    }

    const env = helpers.env;
    const url =
      inst.urlEnvs.map((k) => env(k).trim()).find((v) => v.length > 0) ||
      inst.urlDefault ||
      '';

    let identity: BackendIdentity;
    let error: string | undefined;
    try {
      const fetcher = helpers.createFetcher(inst.prefix, inst.instance, {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      identity = await resolveIdentity({
        protocol: inst.protocol,
        baseUrl: url,
        env,
        prefix: inst.prefix,
        fetch: url ? (u: string) => fetcher(u) : undefined,
      });
    } catch (e: any) {
      error = e?.message ?? String(e);
      identity = { product: inst.product ?? inst.protocol, version: null, source: 'default' };
    }

    const product = inst.product ?? identity.product;
    const support = lookupSupport(inst.skillId, product);
    const tier: SupportLevel = support
      ? classify(identity.version, support.productVersions)
      : 'unknown';

    const entry: VersionEntry = {
      skillId: inst.skillId,
      instance: inst.instance,
      protocol: inst.protocol,
      product,
      detectedVersion: identity.version,
      source: identity.source,
      tier,
      url,
      error,
    };
    this.cache.set(key, { entry, at: Date.now() });
    return entry;
  }

  /**
   * Resolve all configured instances for the given enabled skill ids.
   * Probes run concurrently; individual failures are captured per entry.
   */
  async resolveEnabled(
    helpers: SkillHelpers,
    enabledIds: Set<string>,
    opts: { force?: boolean } = {},
  ): Promise<VersionEntry[]> {
    const active = this.configured(helpers.env).filter((i) =>
      enabledIds.has(i.skillId),
    );
    return Promise.all(active.map((i) => this.resolve(i, helpers, opts)));
  }

  /** Drop all cached entries (forces re-probe on next resolve). */
  clear(): void {
    this.cache.clear();
  }
}

/** Process-wide registry singleton. */
export const versionRegistry = new VersionRegistry();
