/**
 * Protocol catalog — the typed source of truth for the query/wire protocols
 * that back observability products.
 *
 * The server follows a `capability → product → protocol-adapter` model: many
 * products speak the same protocol (e.g. Prometheus, Mimir, Thanos, Cortex and
 * VictoriaMetrics all speak PromQL), so capabilities are reasoned about per
 * *protocol*, while supported versions are tracked per *product*.
 *
 * Two distinct notions of "feature" live here:
 *  1. `baselineFeatures` — capabilities present across the entire supported
 *     version window. Always advertised, never version-gated. (e.g. PromQL
 *     `rate`, `predict_linear`.)
 *  2. Versioned features (the `ProtocolFeatureMap` unions) — capabilities that
 *     arrived at a specific product version. Advertised *and* gated. The
 *     since-version is per-product and lives on each skill's `versions` entry
 *     (see src/skill.ts `BackendVersionSupport.protocolFeaturesSince`).
 *
 * @see docs/integration-adapter-matrix.md for the product→adapter mapping.
 */

// ─── Protocol identity ───────────────────────────────────────────────────────

/**
 * Maps each protocol id to its string-literal union of *versioned* features.
 *
 * Native single-product HTTP/admin APIs that have no version-gated features in
 * the current support window map to `never` (their `protocolFeaturesSince` is
 * therefore an empty object, and only baseline + product-version tiers apply).
 */
export interface ProtocolFeatureMap {
  // ── Shared query protocols ──
  promql:
    | 'subqueries'
    | 'at_modifier'
    | 'negative_offset'
    | 'native_histograms'
    | 'utf8_names'
    | 'sort_by_label'
    | 'info_func'
    | 'double_exp_smoothing';
  logql:
    | 'ip_filter'
    | 'pattern_parser'
    | 'drop_stage'
    | 'decolorize'
    | 'structured_metadata'
    | 'keep_stage'
    | 'distinct';
  esdsl:
    | 'search_after'
    | 'composite_aggs'
    | 'async_search'
    | 'pit_search'
    | 'runtime_fields'
    | 'esql';
  jaeger:
    | 'services_list'
    | 'operations_list'
    | 'dependencies_graph'
    | 'otlp_native_storage'
    | 'clickhouse_storage_v2';
  traceql:
    | 'traceql_basic'
    | 'traceql_structural'
    | 'traceql_aggregates'
    | 'metrics_from_traces'
    | 'traceql_instrument';
  zipkin: 'api_v2';
  skywalking: 'graphql_v3_schema' | 'logs_correlation' | 'ebpf_profiling_query';
  influxql: never;
  flux: 'flux_read';
  influx_sql:
    | 'sql_query'
    | 'flightsql_transport'
    | 'date_bin_windowing'
    | 'last_cache';
  clickhouse:
    | 'analyzer_new'
    | 'parallel_replicas'
    | 'json_object_type'
    | 'query_condition_cache';
  graylog:
    | 'views_search_api'
    | 'pivot_aggregations'
    | 'parameters_in_views'
    | 'data_tiering'
    | 'search_filters_reusable';
  opentsdb:
    | 'fill_policies_downsample'
    | 'explicit_tags'
    | 'rollup_preagg_queries'
    | 'histograms_sketches'
    | 'exp_expression_query';
  pyroscope:
    | 'render_api_legacy'
    | 'connect_query_api'
    | 'select_merge_profile'
    | 'flamegraph_diff'
    | 'relabeling_query'
    | 'span_profiles';
  'k8s-crd': 'crd_status_read' | 'crd_discovery';
  'opa-rest':
    | 'partial_eval_compile'
    | 'decision_logs_api'
    | 'bundle_status_api'
    | 'rego_v1_syntax'
    | 'strict_builtin_errors';
  hubble:
    | 'getflows_l7'
    | 'getnodes_api'
    | 'getnamespaces_api'
    | 'flows_filter_workload'
    | 'getflows_traffic_direction'
    | 'hubble_metrics_dynamic';
  // ── Native single-product protocols (no version-gated features yet) ──
  'grafana-http': never;
  'alertmanager-http': never;
  'k8s-core': never;
  'envoy-admin': never;
  'consul-http': never;
  'kong-admin': never;
  'traefik-http': never;
  'pinpoint-http': never;
  'cilium-http': never;
  'fluentbit-http': never;
  'beats-http': never;
  'vector-http': never;
  'alloy-http': never;
  'zk-native': never;
  'app-api': never;
}

/** Canonical protocol id — one of the adapter ids in the catalog. */
export type ProtocolId = keyof ProtocolFeatureMap;

/** The versioned-feature union for a given protocol. */
export type FeatureOf<P extends ProtocolId> = ProtocolFeatureMap[P];

// ─── Catalog shapes ──────────────────────────────────────────────────────────

export interface ProtocolFeatureInfo {
  /** One-line description of the versioned capability. */
  summary: string;
  /** Optional documentation link (product-agnostic where possible). */
  docUrl?: string;
}

export interface ProtocolAdapter<P extends ProtocolId = ProtocolId> {
  id: P;
  /** Human-readable adapter name. */
  name: string;
  /** Query/wire language exposed (e.g. 'PromQL', 'LogQL', 'SQL'). */
  queryLanguage: string;
  /** Product display names known to speak this protocol. */
  products: string[];
  /** Spec or API documentation URL. */
  specUrl?: string;
  /**
   * Always-available capabilities advertised across the whole support window.
   * Informational (ungated) — used by the manifest and the capabilities tool.
   */
  baselineFeatures: string[];
  /** Versioned feature catalog (descriptions). Since-versions are per-product. */
  versionedFeatures: Partial<Record<FeatureOf<P>, ProtocolFeatureInfo>>;
}

/** Helper to preserve the literal `id` type while widening for storage. */
function defineProtocol<P extends ProtocolId>(a: ProtocolAdapter<P>): ProtocolAdapter<P> {
  return a;
}

// ─── Catalog data ────────────────────────────────────────────────────────────

export const PROTOCOLS: { [P in ProtocolId]: ProtocolAdapter<P> } = {
  promql: defineProtocol({
    id: 'promql',
    name: 'Prometheus query API',
    queryLanguage: 'PromQL',
    products: ['Prometheus', 'Grafana Mimir', 'Thanos', 'Cortex', 'VictoriaMetrics'],
    specUrl: 'https://prometheus.io/docs/prometheus/latest/querying/basics/',
    baselineFeatures: [
      'sum', 'min', 'max', 'avg', 'group', 'stddev', 'stdvar', 'count', 'count_values',
      'bottomk', 'topk', 'quantile', 'by', 'without', 'on', 'ignoring', 'group_left',
      'group_right', 'rate', 'irate', 'increase', 'resets', 'changes', 'idelta', 'delta',
      'deriv', 'predict_linear', 'holt_winters', 'abs', 'ceil', 'floor', 'round', 'exp',
      'ln', 'log2', 'log10', 'sqrt', 'clamp', 'clamp_min', 'clamp_max', 'sgn', 'time',
      'timestamp', 'minute', 'hour', 'day_of_week', 'day_of_month', 'day_of_year',
      'days_in_month', 'month', 'year', 'label_replace', 'label_join', 'histogram_quantile',
      'histogram_fraction', 'absent', 'absent_over_time', 'vector', 'scalar', 'sort',
      'sort_desc', 'avg_over_time', 'min_over_time', 'max_over_time', 'sum_over_time',
      'count_over_time', 'quantile_over_time', 'stddev_over_time', 'stdvar_over_time',
      'last_over_time', 'present_over_time',
    ],
    versionedFeatures: {
      subqueries: { summary: 'Subquery range selectors `expr[5m:1m]`.' },
      at_modifier: { summary: '`@` modifier to fix evaluation timestamp.' },
      negative_offset: { summary: 'Negative `offset` to look ahead.' },
      native_histograms: { summary: 'Native (sparse) histogram queries.' },
      utf8_names: { summary: 'UTF-8 metric and label names.' },
      sort_by_label: { summary: '`sort_by_label` / `sort_by_label_desc`.' },
      info_func: { summary: '`info()` function for metadata joins.' },
      double_exp_smoothing: {
        summary: '`double_exponential_smoothing` (renamed from `holt_winters` in 3.0).',
      },
    },
  }),

  logql: defineProtocol({
    id: 'logql',
    name: 'Loki query API',
    queryLanguage: 'LogQL',
    products: ['Grafana Loki'],
    specUrl: 'https://grafana.com/docs/loki/latest/query/',
    baselineFeatures: [
      'stream_selector', 'line_filter_eq', 'line_filter_neq', 'line_filter_regex',
      'json', 'logfmt', 'regexp', 'unpack', 'line_format', 'label_format', 'label_filter',
      'rate', 'count_over_time', 'bytes_rate', 'bytes_over_time', 'sum', 'avg', 'min', 'max',
      'stddev', 'stdvar', 'count', 'topk', 'bottomk', 'quantile_over_time', 'first_over_time',
      'last_over_time', 'absent_over_time', 'sum_over_time', 'avg_over_time', 'min_over_time',
      'max_over_time', 'unwrap', 'by', 'without',
    ],
    versionedFeatures: {
      ip_filter: { summary: 'IP-address matching with `ip()`.' },
      pattern_parser: { summary: '`pattern` parser for structured extraction.' },
      drop_stage: { summary: '`drop` label stage.' },
      decolorize: { summary: '`decolorize` stage to strip ANSI codes.' },
      structured_metadata: { summary: 'Query over structured metadata.' },
      keep_stage: { summary: '`keep` label stage.' },
      distinct: { summary: '`distinct` label filter.' },
    },
  }),

  esdsl: defineProtocol({
    id: 'esdsl',
    name: 'Elasticsearch Query DSL',
    queryLanguage: 'Query DSL',
    products: ['Elasticsearch', 'OpenSearch', 'Quickwit', 'Elastic APM'],
    specUrl: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html',
    baselineFeatures: [
      'match', 'match_phrase', 'match_phrase_prefix', 'multi_match', 'term', 'terms',
      'terms_set', 'range', 'exists', 'prefix', 'wildcard', 'regexp', 'fuzzy', 'ids',
      'query_string', 'simple_query_string', 'bool', 'dis_max', 'boosting', 'constant_score',
      'function_score', 'nested', 'avg', 'sum', 'min', 'max', 'stats', 'extended_stats',
      'value_count', 'cardinality', 'percentiles', 'percentile_ranks', 'top_hits',
      'geo_bounds', 'terms_agg', 'date_histogram', 'histogram', 'range_agg', 'date_range',
      'filters', 'significant_terms', 'geo_distance', 'missing', 'global', 'sampler',
      'derivative', 'cumulative_sum', 'moving_fn', 'bucket_script', 'bucket_selector',
      'serial_diff', 'avg_bucket', 'max_bucket', 'min_bucket', 'sum_bucket', 'sort',
      'source_filtering', 'highlight', 'paging', 'collapse', 'track_total_hits',
    ],
    versionedFeatures: {
      search_after: { summary: 'Deep pagination via `search_after`.' },
      composite_aggs: { summary: 'Composite aggregation for paginated buckets.' },
      async_search: { summary: 'Async search API.' },
      pit_search: { summary: 'Point-in-time search context.' },
      runtime_fields: { summary: 'Runtime (schema-on-read) fields.' },
      esql: { summary: 'ES|QL piped query language.' },
    },
  }),

  jaeger: defineProtocol({
    id: 'jaeger',
    name: 'Jaeger Query API',
    queryLanguage: 'Jaeger Query',
    products: ['Jaeger', 'Grafana Tempo (Jaeger-compatible)'],
    specUrl: 'https://www.jaegertracing.io/docs/latest/apis/',
    baselineFeatures: [
      'search_by_service', 'search_by_operation', 'search_by_tags', 'get_trace_by_id',
      'lookback_window', 'limit', 'min_duration', 'max_duration',
    ],
    versionedFeatures: {
      services_list: { summary: 'List known services.' },
      operations_list: { summary: 'List operations for a service.' },
      dependencies_graph: { summary: 'Service dependency graph (needs dependency job).' },
      otlp_native_storage: { summary: 'Native OTLP ingestion path.' },
      clickhouse_storage_v2: { summary: 'Jaeger v2 (OpenTelemetry-collector backed).' },
    },
  }),

  traceql: defineProtocol({
    id: 'traceql',
    name: 'Tempo TraceQL API',
    queryLanguage: 'TraceQL',
    products: ['Grafana Tempo'],
    specUrl: 'https://grafana.com/docs/tempo/latest/traceql/',
    baselineFeatures: [
      'get_trace_by_id', 'span_attribute_filter', 'resource_attribute_filter',
      'duration_filter', 'limit',
    ],
    versionedFeatures: {
      traceql_basic: { summary: 'Basic span selectors `{ ... }`.' },
      traceql_structural: { summary: 'Structural operators (descendant/child/sibling).' },
      traceql_aggregates: { summary: 'Aggregates over matched spans.' },
      metrics_from_traces: { summary: 'TraceQL metrics (rate/quantile_over_time).' },
      traceql_instrument: { summary: 'Exemplars / instrumented results.' },
    },
  }),

  zipkin: defineProtocol({
    id: 'zipkin',
    name: 'Zipkin API v2',
    queryLanguage: 'Zipkin Query',
    products: ['Zipkin'],
    specUrl: 'https://zipkin.io/zipkin-api/',
    baselineFeatures: [
      'search', 'get_trace_by_id', 'services_list', 'span_names', 'dependencies',
      'lookback', 'limit', 'min_duration',
    ],
    versionedFeatures: {
      api_v2: { summary: 'Zipkin API v2 (v1 endpoints are unsupported).' },
    },
  }),

  skywalking: defineProtocol({
    id: 'skywalking',
    name: 'SkyWalking OAP GraphQL',
    queryLanguage: 'GraphQL',
    products: ['Apache SkyWalking'],
    specUrl: 'https://skywalking.apache.org/docs/',
    baselineFeatures: [
      'trace_query', 'get_trace_by_id', 'services_list', 'endpoints_list',
      'topology', 'dependencies', 'duration_window',
    ],
    versionedFeatures: {
      graphql_v3_schema: { summary: 'Current GraphQL query-protocol schema.' },
      logs_correlation: { summary: 'Trace↔log correlation queries.' },
      ebpf_profiling_query: { summary: 'eBPF profiling queries.' },
    },
  }),

  influxql: defineProtocol({
    id: 'influxql',
    name: 'InfluxDB InfluxQL API',
    queryLanguage: 'InfluxQL',
    products: ['InfluxDB 1.x', 'InfluxDB 2.x (compat)'],
    specUrl: 'https://docs.influxdata.com/influxdb/v1/query_language/',
    baselineFeatures: [
      'select', 'where', 'group_by_time', 'group_by_tag', 'fill', 'mean', 'median', 'mode',
      'sum', 'count', 'min', 'max', 'first', 'last', 'spread', 'stddev', 'percentile',
      'distinct', 'top', 'bottom', 'sample', 'derivative', 'non_negative_derivative',
      'difference', 'moving_average', 'cumulative_sum', 'elapsed', 'into',
      'show_measurements', 'show_tag_keys', 'show_field_keys', 'show_series',
    ],
    versionedFeatures: {},
  }),

  flux: defineProtocol({
    id: 'flux',
    name: 'InfluxDB Flux API',
    queryLanguage: 'Flux',
    products: ['InfluxDB 2.x'],
    specUrl: 'https://docs.influxdata.com/flux/v0/',
    baselineFeatures: [
      'from', 'range', 'filter', 'group', 'aggregateWindow', 'map', 'pivot', 'join', 'to',
    ],
    versionedFeatures: {
      flux_read: { summary: 'Flux read queries (removed in InfluxDB 3.x).' },
    },
  }),

  influx_sql: defineProtocol({
    id: 'influx_sql',
    name: 'InfluxDB 3 SQL/FlightSQL API',
    queryLanguage: 'SQL',
    products: ['InfluxDB 3 Core', 'InfluxDB 3 Enterprise'],
    specUrl: 'https://docs.influxdata.com/influxdb3/core/query-data/sql/',
    baselineFeatures: [
      'select', 'where', 'group_by', 'having', 'order_by', 'window_functions',
      'information_schema',
    ],
    versionedFeatures: {
      sql_query: { summary: 'ANSI SQL over measurements-as-tables.' },
      flightsql_transport: { summary: 'FlightSQL transport.' },
      date_bin_windowing: { summary: '`date_bin()` time-bucketing.' },
      last_cache: { summary: 'Last-value / distinct-value cache.' },
    },
  }),

  clickhouse: defineProtocol({
    id: 'clickhouse',
    name: 'ClickHouse HTTP SQL',
    queryLanguage: 'SQL',
    products: ['ClickHouse'],
    specUrl: 'https://clickhouse.com/docs/en/sql-reference',
    baselineFeatures: [
      'select', 'where', 'group_by', 'order_by', 'limit', 'join', 'cte', 'array_join',
      'subqueries', 'format_json', 'system_tables', 'count', 'sum', 'avg', 'min', 'max',
      'uniq', 'uniqExact', 'quantile', 'quantiles', 'groupArray', 'datetime_functions',
      'show_tables', 'show_databases', 'describe',
    ],
    versionedFeatures: {
      analyzer_new: { summary: 'New query analyzer (default-on in 24.8).' },
      parallel_replicas: { summary: 'Parallel replicas for distributed reads.' },
      json_object_type: { summary: 'Native JSON data type.' },
      query_condition_cache: { summary: 'Query condition cache.' },
    },
  }),

  graylog: defineProtocol({
    id: 'graylog',
    name: 'Graylog search API',
    queryLanguage: 'Lucene',
    products: ['Graylog'],
    specUrl: 'https://go2docs.graylog.org/current/what_is_graylog/what_is_graylog.html',
    baselineFeatures: [
      'full_text', 'field_value', 'boolean_ops', 'range', 'wildcards', 'exists',
      'timerange', 'sort', 'paging', 'streams_filter', 'fields_projection',
      'message_by_id', 'inputs_listing', 'streams_listing',
    ],
    versionedFeatures: {
      views_search_api: { summary: 'POST /views/search aggregation API.' },
      pivot_aggregations: { summary: 'Pivot-style aggregations.' },
      parameters_in_views: { summary: 'Parameterised views (Ops/Enterprise).' },
      data_tiering: { summary: 'Data tiering / warm tier.' },
      search_filters_reusable: { summary: 'Reusable saved search filters.' },
    },
  }),

  opentsdb: defineProtocol({
    id: 'opentsdb',
    name: 'OpenTSDB HTTP query API',
    queryLanguage: 'OpenTSDB Query',
    products: ['OpenTSDB'],
    specUrl: 'http://opentsdb.net/docs/build/html/api_http/index.html',
    baselineFeatures: [
      'query', 'sum', 'avg', 'min', 'max', 'count', 'dev', 'zimsum', 'mimmin', 'mimmax',
      'downsampling', 'rate', 'suggest', 'search_lookup', 'multi_metric', 'time_range',
    ],
    versionedFeatures: {
      fill_policies_downsample: { summary: 'Downsample fill policies (none/nan/null/zero).' },
      explicit_tags: { summary: 'Explicit-tags query optimisation.' },
      rollup_preagg_queries: { summary: 'Rollup / pre-aggregate queries.' },
      histograms_sketches: { summary: 'Histogram & sketch data types.' },
      exp_expression_query: { summary: '`/api/query/exp` expression queries.' },
    },
  }),

  pyroscope: defineProtocol({
    id: 'pyroscope',
    name: 'Pyroscope query API',
    queryLanguage: 'Pyroscope Query',
    products: ['Grafana Pyroscope'],
    specUrl: 'https://grafana.com/docs/pyroscope/latest/',
    baselineFeatures: [
      'profile_by_app', 'label_selector', 'time_range', 'flamegraph', 'profile_types',
      'render_json', 'flamebearer', 'label_names', 'label_values',
    ],
    versionedFeatures: {
      render_api_legacy: { summary: 'Legacy `/render` API (pre-1.0).' },
      connect_query_api: { summary: 'Connect querier.v1 API (post-Phlare merge).' },
      select_merge_profile: { summary: '`SelectMergeProfile` query.' },
      flamegraph_diff: { summary: 'Flamegraph diff (`render-diff`).' },
      relabeling_query: { summary: 'Relabeling at query time.' },
      span_profiles: { summary: 'Span profiles (trace→profile link).' },
    },
  }),

  'k8s-crd': defineProtocol({
    id: 'k8s-crd',
    name: 'Kubernetes CRD status reader',
    queryLanguage: 'Kubernetes API',
    products: [
      'Gatekeeper', 'Kyverno', 'Kubewarden', 'Chaos Mesh', 'Litmus', 'Argo Rollouts',
      'Flagger', 'KEDA', 'Argo Events', 'Keptn', 'OSM', 'Istio', 'Linkerd', 'Inspektor Gadget',
    ],
    specUrl: 'https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/',
    baselineFeatures: [
      'list_cr', 'get_cr', 'read_status_conditions', 'read_spec', 'label_selector',
      'field_selector', 'watch',
    ],
    versionedFeatures: {
      crd_status_read: { summary: 'Read custom-resource `.status`.' },
      crd_discovery: { summary: 'Discover served CRD apiVersions.' },
    },
  }),

  'opa-rest': defineProtocol({
    id: 'opa-rest',
    name: 'OPA Data & Decision API',
    queryLanguage: 'Rego',
    products: ['Open Policy Agent'],
    specUrl: 'https://www.openpolicyagent.org/docs/latest/rest-api/',
    baselineFeatures: [
      'query_data', 'post_data_input', 'list_policies', 'get_policy', 'health', 'metrics',
    ],
    versionedFeatures: {
      partial_eval_compile: { summary: 'Partial evaluation via `/v1/compile`.' },
      decision_logs_api: { summary: 'Decision logs API.' },
      bundle_status_api: { summary: 'Bundle status API.' },
      rego_v1_syntax: { summary: 'Rego v1 syntax (`if`/`contains`; default in 1.0).' },
      strict_builtin_errors: { summary: 'Strict built-in error handling.' },
    },
  }),

  hubble: defineProtocol({
    id: 'hubble',
    name: 'Hubble Observer gRPC',
    queryLanguage: 'Hubble Observer',
    products: ['Cilium / Hubble'],
    specUrl: 'https://docs.cilium.io/en/stable/observability/hubble/',
    baselineFeatures: [
      'get_flows', 'server_status', 'flow_verdict', 'l3_l4_fields', 'time_range',
      'follow', 'limit',
    ],
    versionedFeatures: {
      getflows_l7: { summary: 'L7 flow parsers (HTTP/DNS/Kafka).' },
      getnodes_api: { summary: '`GetNodes` API.' },
      getnamespaces_api: { summary: '`GetNamespaces` API.' },
      flows_filter_workload: { summary: 'Filter flows by workload.' },
      getflows_traffic_direction: { summary: 'Traffic-direction field on flows.' },
      hubble_metrics_dynamic: { summary: 'Dynamic Hubble metrics.' },
    },
  }),

  // ── Native single-product protocols ──

  'grafana-http': defineProtocol({
    id: 'grafana-http',
    name: 'Grafana HTTP API',
    queryLanguage: 'Grafana HTTP',
    products: ['Grafana'],
    specUrl: 'https://grafana.com/docs/grafana/latest/developers/http_api/',
    baselineFeatures: [
      'health', 'search_dashboards', 'get_dashboard', 'list_datasources', 'list_folders',
      'list_alert_rules', 'list_users', 'list_teams', 'datasource_proxy',
    ],
    versionedFeatures: {},
  }),

  'alertmanager-http': defineProtocol({
    id: 'alertmanager-http',
    name: 'Alertmanager API v2',
    queryLanguage: 'Alertmanager HTTP',
    products: ['Alertmanager'],
    specUrl: 'https://github.com/prometheus/alertmanager/blob/main/api/v2/openapi.yaml',
    baselineFeatures: ['alerts', 'silences', 'status', 'receivers'],
    versionedFeatures: {},
  }),

  'k8s-core': defineProtocol({
    id: 'k8s-core',
    name: 'Kubernetes core API',
    queryLanguage: 'Kubernetes API',
    products: ['Kubernetes'],
    specUrl: 'https://kubernetes.io/docs/reference/kubernetes-api/',
    baselineFeatures: [
      'list_pods', 'list_nodes', 'list_namespaces', 'list_events', 'get_resource',
    ],
    versionedFeatures: {},
  }),

  'envoy-admin': defineProtocol({
    id: 'envoy-admin',
    name: 'Envoy admin API',
    queryLanguage: 'Envoy Admin',
    products: ['Envoy'],
    specUrl: 'https://www.envoyproxy.io/docs/envoy/latest/operations/admin',
    baselineFeatures: ['server_info', 'stats', 'clusters', 'config_dump'],
    versionedFeatures: {},
  }),

  'consul-http': defineProtocol({
    id: 'consul-http',
    name: 'Consul HTTP API',
    queryLanguage: 'Consul HTTP',
    products: ['Consul'],
    specUrl: 'https://developer.hashicorp.com/consul/api-docs',
    baselineFeatures: ['health', 'services', 'nodes', 'kv', 'catalog'],
    versionedFeatures: {},
  }),

  'kong-admin': defineProtocol({
    id: 'kong-admin',
    name: 'Kong admin API',
    queryLanguage: 'Kong Admin',
    products: ['Kong'],
    specUrl: 'https://docs.konghq.com/gateway/latest/admin-api/',
    baselineFeatures: ['status', 'services', 'routes', 'plugins'],
    versionedFeatures: {},
  }),

  'traefik-http': defineProtocol({
    id: 'traefik-http',
    name: 'Traefik API',
    queryLanguage: 'Traefik HTTP',
    products: ['Traefik'],
    specUrl: 'https://doc.traefik.io/traefik/operations/api/',
    baselineFeatures: ['overview', 'routers', 'services', 'middlewares'],
    versionedFeatures: {},
  }),

  'pinpoint-http': defineProtocol({
    id: 'pinpoint-http',
    name: 'Pinpoint web API',
    queryLanguage: 'Pinpoint HTTP',
    products: ['Pinpoint'],
    specUrl: 'https://pinpoint-apm.gitbook.io/pinpoint/',
    baselineFeatures: ['applications', 'agents', 'server_map', 'transactions'],
    versionedFeatures: {},
  }),

  'cilium-http': defineProtocol({
    id: 'cilium-http',
    name: 'Cilium agent API',
    queryLanguage: 'Cilium HTTP',
    products: ['Cilium'],
    specUrl: 'https://docs.cilium.io/en/stable/api/',
    baselineFeatures: ['health', 'endpoints', 'policy', 'status'],
    versionedFeatures: {},
  }),

  'fluentbit-http': defineProtocol({
    id: 'fluentbit-http',
    name: 'Fluent Bit monitoring API',
    queryLanguage: 'Fluent Bit HTTP',
    products: ['Fluent Bit'],
    specUrl: 'https://docs.fluentbit.io/manual/administration/monitoring',
    baselineFeatures: ['uptime', 'metrics', 'health'],
    versionedFeatures: {},
  }),

  'beats-http': defineProtocol({
    id: 'beats-http',
    name: 'Beats monitoring API',
    queryLanguage: 'Beats HTTP',
    products: ['Filebeat', 'Metricbeat'],
    specUrl: 'https://www.elastic.co/guide/en/beats/filebeat/current/http-endpoint.html',
    baselineFeatures: ['stats', 'state', 'info'],
    versionedFeatures: {},
  }),

  'vector-http': defineProtocol({
    id: 'vector-http',
    name: 'Vector GraphQL/HTTP API',
    queryLanguage: 'Vector GraphQL',
    products: ['Vector'],
    specUrl: 'https://vector.dev/docs/reference/api/',
    baselineFeatures: ['health', 'components', 'metrics'],
    versionedFeatures: {},
  }),

  'alloy-http': defineProtocol({
    id: 'alloy-http',
    name: 'Grafana Alloy API',
    queryLanguage: 'Alloy HTTP',
    products: ['Grafana Alloy'],
    specUrl: 'https://grafana.com/docs/alloy/latest/',
    baselineFeatures: ['ready', 'components', 'metrics'],
    versionedFeatures: {},
  }),

  'zk-native': defineProtocol({
    id: 'zk-native',
    name: 'Zero-knowledge proof protocol',
    queryLanguage: 'ZK Protocol',
    products: ['ZK Proofs'],
    baselineFeatures: ['generate_proof', 'verify_proof'],
    versionedFeatures: {},
  }),

  'app-api': defineProtocol({
    id: 'app-api',
    name: 'Application API (internal)',
    queryLanguage: 'App API',
    products: ['Application API'],
    baselineFeatures: ['health', 'info'],
    versionedFeatures: {},
  }),
};

/** All protocol ids, for iteration and validation. */
export const PROTOCOL_IDS = Object.keys(PROTOCOLS) as ProtocolId[];

/** Look up a protocol adapter by id (undefined if unknown). */
export function getProtocol(id: ProtocolId): ProtocolAdapter {
  return PROTOCOLS[id];
}

/** Type guard: is the given string a known protocol id? */
export function isProtocolId(id: string): id is ProtocolId {
  return Object.prototype.hasOwnProperty.call(PROTOCOLS, id);
}
