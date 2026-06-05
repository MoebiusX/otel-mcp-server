/**
 * Traces layer — provider interface.
 *
 * A `TracesProvider` implements the stable verb set exposed by the `traces`
 * skill. Providers self-configure from environment variables in their factory.
 *
 * Capability gaps are intentional: methods that don't apply to a backend
 * (e.g. `dependencies` on Tempo) are simply omitted, and the layer surfaces a
 * clean "not supported by provider X" error to the agent.
 */

import type { SkillHelpers } from '../../skill.js';

export interface TracesSearchParams {
  /** Service name. Required by jaeger/zipkin/skywalking; synthesized into TraceQL for tempo when no `query` is given. */
  service?: string;
  /** Operation/endpoint/span name filter. */
  operation?: string;
  /** Provider-native raw query (e.g. Tempo TraceQL). Ignored by providers that don't support it. */
  query?: string;
  /** JSON-encoded span tag filter (Jaeger). */
  tags?: string;
  /** Zipkin-style annotation query (e.g. `http.status_code=500 and error`). */
  annotation_query?: string;
  /** SkyWalking trace state filter. */
  state?: 'ALL' | 'SUCCESS' | 'ERROR';
  /** Minimum span/trace duration (e.g. `500ms`, `1s`). */
  min_duration?: string;
  /** Maximum span/trace duration (Jaeger only). */
  max_duration?: string;
  /** Time window (e.g. `1h`, `30m`, `2d`). */
  lookback: string;
  /** Max traces to return. */
  limit: number;
}

export interface TracesProvider {
  /** Provider id matching `TRACES_PROVIDER` env var. */
  id: 'jaeger' | 'tempo' | 'zipkin' | 'skywalking';
  /** Human-readable backend label. */
  backend: string;

  search(params: TracesSearchParams): Promise<unknown>;
  getTrace(traceId: string): Promise<unknown>;

  /** List known services. Optional: providers without a native services endpoint omit this. */
  services?(params: { lookback: string }): Promise<unknown>;
  /** List operations/endpoints for a service. */
  operations?(params: { service: string; lookback: string }): Promise<unknown>;
  /** Service dependency graph. */
  dependencies?(params: { lookback: string }): Promise<unknown>;
}

export type TracesProviderFactory = (helpers: SkillHelpers) => TracesProvider;
