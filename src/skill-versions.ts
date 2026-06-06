/**
 * Centralized version-support data for all skills.
 *
 * Kept in one place (rather than scattered across tool files) so the manifest
 * generator, the `backend_capabilities` tool, and the startup banner have a
 * single source of truth. `skills.ts` attaches each entry to its skill's
 * `versions` field after import.
 *
 * Pattern: `must` = latest major(s), `should` = previous, `optional` = tail.
 * Product version numbers are a best-effort baseline — verify against upstream
 * release notes when tightening gates. `protocolFeaturesSince` records the
 * product version where each *versioned* protocol feature first appeared; it is
 * per-product because the same feature ships at different versions across
 * products that share a protocol.
 */

import { backend, type SkillVersionSupport } from './versions.js';

export const SKILL_VERSIONS: Record<string, SkillVersionSupport> = {
  // ── Traces (one skill, four protocols) ──
  traces: {
    Jaeger: backend(
      'jaeger',
      { must: ['2.x'], should: ['1.6x', '1.5x'], optional: ['1.4x'] },
      {
        services_list: '1.0',
        operations_list: '1.0',
        dependencies_graph: '1.0',
        otlp_native_storage: '1.35',
        clickhouse_storage_v2: '2.0',
      },
    ),
    Tempo: backend(
      'traceql',
      { must: ['2.7', '2.6'], should: ['2.5'], optional: ['2.4'] },
      {
        traceql_basic: '2.0',
        traceql_structural: '2.2',
        traceql_aggregates: '2.3',
        metrics_from_traces: '2.4',
        traceql_instrument: '2.6',
      },
    ),
    Zipkin: backend(
      'zipkin',
      { must: ['3.x'], should: ['2.x'] },
      { api_v2: '2.0' },
    ),
    SkyWalking: backend(
      'skywalking',
      { must: ['10.x'], should: ['9.x'], optional: ['8.x'] },
      {
        graphql_v3_schema: '9.0',
        logs_correlation: '9.2',
        ebpf_profiling_query: '9.3',
      },
    ),
  },

  // ── Metrics (PromQL — many products) ──
  metrics: {
    Prometheus: backend(
      'promql',
      { must: ['3.x'], should: ['2.55', '2.5x'], optional: ['2.4x'] },
      {
        subqueries: '2.7',
        at_modifier: '2.26',
        negative_offset: '2.26',
        native_histograms: '3.0',
        utf8_names: '3.0',
        sort_by_label: '2.55',
        info_func: '3.0',
        double_exp_smoothing: '3.0',
      },
    ),
    'Grafana Mimir': backend(
      'promql',
      { must: ['2.14', '2.13'], should: ['2.10'], optional: ['2.0'] },
      {
        subqueries: '2.0',
        at_modifier: '2.0',
        negative_offset: '2.0',
        native_histograms: '2.10',
        utf8_names: '2.14',
        sort_by_label: '2.13',
      },
    ),
    Thanos: backend(
      'promql',
      { must: ['0.37', '0.36'], should: ['0.34'], optional: ['0.30'] },
      {
        subqueries: '0.10',
        at_modifier: '0.21',
        negative_offset: '0.21',
        native_histograms: '0.34',
        utf8_names: '0.37',
        sort_by_label: '0.36',
      },
    ),
    VictoriaMetrics: backend(
      'promql',
      { must: ['1.x'], should: ['0.x'] },
      {
        subqueries: '1.0',
        at_modifier: '1.54',
        negative_offset: '1.54',
        sort_by_label: '1.93',
      },
    ),
    Cortex: backend(
      'promql',
      { must: ['1.x'], should: ['0.x'] },
      {
        subqueries: '1.0',
        at_modifier: '1.11',
        negative_offset: '1.11',
      },
    ),
  },

  // ── Logs (LogQL — Loki) ──
  logs: {
    'Grafana Loki': backend(
      'logql',
      { must: ['3.x'], should: ['2.9'], optional: ['2.8'] },
      {
        ip_filter: '2.5',
        pattern_parser: '2.9',
        drop_stage: '2.9',
        decolorize: '2.9',
        structured_metadata: '3.0',
        keep_stage: '3.0',
        distinct: '3.1',
      },
    ),
  },

  // ── Elasticsearch (Query DSL) ──
  elasticsearch: {
    Elasticsearch: backend(
      'esdsl',
      { must: ['9.x'], should: ['8.x'], optional: ['7.x'] },
      {
        search_after: '5.0',
        composite_aggs: '6.1',
        async_search: '7.7',
        pit_search: '7.10',
        runtime_fields: '7.11',
        esql: '8.14',
      },
    ),
    OpenSearch: backend(
      'esdsl',
      { must: ['2.x'], should: ['1.x'] },
      {
        search_after: '1.0',
        composite_aggs: '1.0',
        pit_search: '2.4',
      },
    ),
  },

  // ── Alertmanager ──
  alertmanager: {
    Alertmanager: backend('alertmanager-http', {
      must: ['0.28', '0.27'],
      should: ['0.26'],
      optional: ['0.25'],
    }),
  },

  // ── Grafana ──
  grafana: {
    Grafana: backend('grafana-http', {
      must: ['12.x', '13.x'],
      should: ['11.x'],
      optional: ['10.x', '9.x'],
    }),
  },

  // ── Cilium (agent HTTP) ──
  cilium: {
    Cilium: backend('cilium-http', {
      must: ['1.17', '1.16'],
      should: ['1.15'],
      optional: ['1.14'],
    }),
  },

  // ── Kubernetes (core API) ──
  kubernetes: {
    Kubernetes: backend('k8s-core', {
      must: ['1.33', '1.32'],
      should: ['1.31'],
      optional: ['1.30'],
    }),
  },

  // ── ClickHouse (SQL) ──
  clickhouse: {
    ClickHouse: backend(
      'clickhouse',
      { must: ['25.x', '24.x'], should: ['24.3'], optional: ['23.8'] },
      {
        parallel_replicas: '23.11',
        analyzer_new: '24.3',
        json_object_type: '24.8',
        query_condition_cache: '25.1',
      },
    ),
  },

  // ── Pyroscope ──
  pyroscope: {
    'Grafana Pyroscope': backend(
      'pyroscope',
      { must: ['1.x'], should: ['0.x'] },
      {
        render_api_legacy: '0.1',
        connect_query_api: '1.0',
        select_merge_profile: '1.0',
        flamegraph_diff: '1.1',
        relabeling_query: '1.2',
        span_profiles: '1.3',
      },
    ),
  },

  // ── OPA (Data & Decision REST) ──
  opa: {
    'Open Policy Agent': backend(
      'opa-rest',
      { must: ['1.x'], should: ['0.6x'], optional: ['0.5x'] },
      {
        partial_eval_compile: '0.11',
        decision_logs_api: '0.13',
        bundle_status_api: '0.13',
        rego_v1_syntax: '0.59',
        strict_builtin_errors: '1.0',
      },
    ),
  },

  // ── Envoy ──
  envoy: {
    Envoy: backend('envoy-admin', {
      must: ['1.33', '1.32'],
      should: ['1.31'],
      optional: ['1.30'],
    }),
  },

  // ── Consul ──
  consul: {
    Consul: backend('consul-http', {
      must: ['1.20', '1.19'],
      should: ['1.18'],
      optional: ['1.17'],
    }),
  },

  // ── Kong ──
  kong: {
    Kong: backend('kong-admin', {
      must: ['3.8', '3.7'],
      should: ['3.6'],
      optional: ['3.4'],
    }),
  },

  // ── Traefik ──
  traefik: {
    Traefik: backend('traefik-http', {
      must: ['3.x'],
      should: ['2.11'],
      optional: ['2.10'],
    }),
  },

  // ── InfluxDB (protocol changes by major: InfluxQL / Flux / SQL) ──
  influx: {
    'InfluxDB 1.x': backend('influxql', { must: ['1.11'], should: ['1.8'] }),
    'InfluxDB 2.x': backend('flux', { must: ['2.7'], should: ['2.6'] }, { flux_read: '2.0' }),
    'InfluxDB 3.x': backend(
      'influx_sql',
      { must: ['3.x'] },
      {
        sql_query: '3.0',
        flightsql_transport: '3.0',
        date_bin_windowing: '3.0',
        last_cache: '3.0',
      },
    ),
  },

  // ── OpenTSDB ──
  opentsdb: {
    OpenTSDB: backend(
      'opentsdb',
      { must: ['2.4.x'], should: ['2.3.x'] },
      {
        fill_policies_downsample: '2.2',
        explicit_tags: '2.3',
        exp_expression_query: '2.3',
        rollup_preagg_queries: '2.4',
        histograms_sketches: '2.4',
      },
    ),
  },

  // ── Graylog (Lucene) ──
  graylog: {
    Graylog: backend(
      'graylog',
      { must: ['6.x'], should: ['5.2'], optional: ['5.0', '4.x'] },
      {
        views_search_api: '4.0',
        pivot_aggregations: '4.0',
        parameters_in_views: '5.0',
        data_tiering: '5.2',
        search_filters_reusable: '6.0',
      },
    ),
  },

  // ── Pinpoint ──
  pinpoint: {
    Pinpoint: backend('pinpoint-http', {
      must: ['3.x'],
      should: ['2.5'],
      optional: ['2.4'],
    }),
  },

  // ── Pipeline agents (four native protocols) ──
  pipeline: {
    'Fluent Bit': backend('fluentbit-http', { must: ['3.x'], should: ['2.2'], optional: ['2.1'] }),
    Beats: backend('beats-http', { must: ['9.x', '8.x'], should: ['8.x'], optional: ['7.x'] }),
    Vector: backend('vector-http', { must: ['0.4x'], should: ['0.3x'] }),
    'Grafana Alloy': backend('alloy-http', { must: ['1.x'] }),
  },

  // ── ZK proofs (protocol-versioned; no product semver) ──
  'zk-proofs': {
    'ZK Proofs': backend('zk-native', { must: ['1.x'] }),
  },

  // ── System (internal application API) ──
  system: {
    'Application API': backend('app-api', { must: ['1.x'] }),
  },

  // ── Public Exchange (KrystalineX /api/public/* transparency endpoints) ──
  'public-exchange': {
    'App API': backend('app-api', { must: ['1.x'] }),
  },

  // ── AgentRelay (hosted /v1 REST messaging) ──
  agentrelay: {
    AgentRelay: backend('agentrelay-http', { must: ['v1'] }),
  },
};
