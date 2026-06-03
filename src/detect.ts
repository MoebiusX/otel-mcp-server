/**
 * Backend product & version detection.
 *
 * A URL reveals the *protocol* (e.g. `PROMETHEUS_URL` speaks PromQL) but not the
 * *product* — that endpoint could be Prometheus, Mimir, Thanos, Cortex, or
 * VictoriaMetrics, each of which ships protocol features at different versions.
 * This module resolves a concrete {product, version} so version gating and the
 * `backend_capabilities` tool can pick the right per-product since-matrix.
 *
 * Resolution order (first hit wins):
 *   1. Explicit config override — `{PREFIX}_PRODUCT` / `{PREFIX}_VERSION`.
 *   2. Live buildinfo probe — protocol-specific endpoint.
 *   3. Default product for the protocol (version unknown → optimistic).
 *
 * Detection is always best-effort: probe failures degrade to `version: null`,
 * which callers treat optimistically (feature allowed, optionally warned).
 */

import type { ProtocolId } from './protocols.js';

export type IdentitySource = 'config' | 'probe' | 'default';

export interface BackendIdentity {
  /** Canonical product name (e.g. 'Prometheus', 'Grafana Mimir'). */
  product: string;
  /** Detected semver-ish version string, or null when undetermined. */
  version: string | null;
  /** How the identity was resolved. */
  source: IdentitySource;
}

/** Minimal fetcher shape: resolve a URL to parsed JSON (or throw). */
export type ProbeFetch = (url: string) => Promise<any>;

/** Default product assumed for a protocol when nothing else is known. */
const DEFAULT_PRODUCT: Partial<Record<ProtocolId, string>> = {
  promql: 'Prometheus',
  logql: 'Grafana Loki',
  esdsl: 'Elasticsearch',
  traceql: 'Tempo',
  jaeger: 'Jaeger',
  zipkin: 'Zipkin',
  skywalking: 'SkyWalking',
  influxql: 'InfluxDB 1.x',
  flux: 'InfluxDB 2.x',
  influx_sql: 'InfluxDB 3.x',
  clickhouse: 'ClickHouse',
  graylog: 'Graylog',
  opentsdb: 'OpenTSDB',
  pyroscope: 'Grafana Pyroscope',
  'opa-rest': 'Open Policy Agent',
  'grafana-http': 'Grafana',
  'alertmanager-http': 'Alertmanager',
  'k8s-core': 'Kubernetes',
  'envoy-admin': 'Envoy',
  'consul-http': 'Consul',
  'kong-admin': 'Kong',
  'traefik-http': 'Traefik',
  'pinpoint-http': 'Pinpoint',
  'cilium-http': 'Cilium',
};

const stripTrailingSlash = (u: string) => u.replace(/\/+$/, '');

/** Normalize a probed version string ('v3.0.1', '2.9.0-rc.1' → keep core). */
function cleanVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/v?(\d+(?:\.\d+){0,3})/);
  return m ? m[1] : null;
}

/**
 * Probe a PromQL endpoint's buildinfo to distinguish Prometheus-family
 * products. Returns null product when ambiguous so the default applies.
 */
async function probePromql(
  fetch: ProbeFetch,
  base: string,
): Promise<Partial<BackendIdentity> | null> {
  try {
    const info = await fetch(`${base}/api/v1/status/buildinfo`);
    const data = info?.data ?? info;
    const version = cleanVersion(data?.version);
    // VictoriaMetrics exposes /api/v1/status/buildinfo too but tags version
    // strings like 'victoria-metrics-...'; Mimir/Thanos report via their own
    // application field. Best-effort product hints:
    const blob = JSON.stringify(data ?? '').toLowerCase();
    let product: string | undefined;
    if (blob.includes('mimir')) product = 'Grafana Mimir';
    else if (blob.includes('thanos')) product = 'Thanos';
    else if (blob.includes('cortex')) product = 'Cortex';
    else if (blob.includes('victoria')) product = 'VictoriaMetrics';
    return { product, version: version ?? null };
  } catch {
    return null;
  }
}

async function probeEsdsl(
  fetch: ProbeFetch,
  base: string,
): Promise<Partial<BackendIdentity> | null> {
  try {
    const root = await fetch(`${base}/`);
    const version = cleanVersion(root?.version?.number);
    const distro = String(root?.version?.distribution ?? '').toLowerCase();
    const product = distro === 'opensearch' ? 'OpenSearch' : 'Elasticsearch';
    return { product, version };
  } catch {
    return null;
  }
}

async function probeJsonVersion(
  fetch: ProbeFetch,
  url: string,
  field = 'version',
): Promise<string | null> {
  try {
    const r = await fetch(url);
    return cleanVersion(r?.[field] ?? r?.data?.[field]);
  } catch {
    return null;
  }
}

/**
 * Resolve a backend's product/version identity.
 *
 * @param protocol  The protocol the backend speaks.
 * @param baseUrl   Backend base URL (no trailing slash required).
 * @param env       Env reader (for `{PREFIX}_PRODUCT` / `_VERSION` overrides).
 * @param prefix    Env prefix (e.g. 'PROMETHEUS').
 * @param fetch     Optional probe fetcher; when omitted, no live probe is done.
 */
export async function resolveIdentity(opts: {
  protocol: ProtocolId;
  baseUrl: string;
  env: (key: string, fallback?: string) => string;
  prefix: string;
  fetch?: ProbeFetch;
}): Promise<BackendIdentity> {
  const { protocol, env, prefix } = opts;
  const base = stripTrailingSlash(opts.baseUrl);
  const fallbackProduct = DEFAULT_PRODUCT[protocol] ?? protocol;

  // 1. Explicit config override.
  const cfgProduct = env(`${prefix}_PRODUCT`).trim();
  const cfgVersion = env(`${prefix}_VERSION`).trim();
  if (cfgProduct || cfgVersion) {
    return {
      product: cfgProduct || fallbackProduct,
      version: cleanVersion(cfgVersion),
      source: 'config',
    };
  }

  // 2. Live probe (best-effort, protocol-specific).
  if (opts.fetch) {
    const probed = await probeIdentity(protocol, opts.fetch, base);
    if (probed && (probed.product || probed.version)) {
      return {
        product: probed.product || fallbackProduct,
        version: probed.version ?? null,
        source: 'probe',
      };
    }
  }

  // 3. Default for protocol; version unknown.
  return { product: fallbackProduct, version: null, source: 'default' };
}

async function probeIdentity(
  protocol: ProtocolId,
  fetch: ProbeFetch,
  base: string,
): Promise<Partial<BackendIdentity> | null> {
  switch (protocol) {
    case 'promql':
      return probePromql(fetch, base);
    case 'esdsl':
      return probeEsdsl(fetch, base);
    case 'logql':
    case 'traceql':
      return { version: await probeJsonVersion(fetch, `${base}/api/status/buildinfo`) };
    case 'flux':
    case 'influxql':
    case 'influx_sql':
      return { version: await probeJsonVersion(fetch, `${base}/health`) };
    case 'grafana-http':
      return { version: await probeJsonVersion(fetch, `${base}/api/health`) };
    case 'alertmanager-http':
      return { version: await probeJsonVersion(fetch, `${base}/api/v2/status`, 'versionInfo') };
    default:
      return null;
  }
}
