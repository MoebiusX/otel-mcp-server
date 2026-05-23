/**
 * Traces layer — provider-agnostic distributed-trace skill.
 *
 * Exposes a stable verb surface (traces_search, trace_get, traces_services,
 * traces_operations, traces_dependencies) and dispatches to a backend provider
 * selected by the `TRACES_PROVIDER` environment variable.
 *
 * Supported providers: `jaeger` (default), `tempo`, `zipkin`, `skywalking`.
 *
 * Provider-specific config falls back to legacy per-vendor env vars so users
 * coming from the v1.2.0 skill-per-vendor model don't need to rename anything:
 *   TRACES_TEMPO_URL → TEMPO_URL → http://localhost:3200
 *
 * Auth continues to use the per-vendor prefix (`JAEGER_AUTH_*`, `TEMPO_AUTH_*`, ...).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';
import type { TracesProvider, TracesProviderFactory } from '../providers/traces/types.js';
import { createJaegerProvider } from '../providers/traces/jaeger.js';
import { createTempoProvider } from '../providers/traces/tempo.js';
import { createZipkinProvider } from '../providers/traces/zipkin.js';
import { createSkyWalkingProvider } from '../providers/traces/skywalking.js';

const PROVIDERS: Record<string, TracesProviderFactory> = {
  jaeger: createJaegerProvider,
  tempo: createTempoProvider,
  zipkin: createZipkinProvider,
  skywalking: createSkyWalkingProvider,
};

function resolveProvider(helpers: SkillHelpers): TracesProvider {
  const id = (helpers.env('TRACES_PROVIDER', 'jaeger') || 'jaeger').toLowerCase();
  const factory = PROVIDERS[id];
  if (!factory) {
    const supported = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown TRACES_PROVIDER "${id}". Supported: ${supported}`);
  }
  return factory(helpers);
}

function unsupported(provider: TracesProvider, verb: string) {
  return errorResult(`traces verb "${verb}" is not supported by provider "${provider.id}"`);
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const provider = resolveProvider(helpers);

  // ── traces_search ─────────────────────────────────────────────────────────

  server.tool(
    'traces_search',
    `Search distributed traces. Backend: ${provider.backend}. ` +
      'Param semantics vary by provider: `service` works for jaeger/zipkin/skywalking ' +
      '(skywalking expects a service id); `query` is a provider-native raw query (Tempo TraceQL).',
    {
      service: z.string().optional().describe('Service name (jaeger/zipkin) or service id (skywalking)'),
      operation: z.string().optional().describe('Operation/span/endpoint name filter'),
      query: z.string().optional().describe('Provider-native raw query (Tempo TraceQL)'),
      tags: z.string().optional().describe('JSON-encoded tag filter (Jaeger only)'),
      annotation_query: z.string().optional().describe('Zipkin annotation query (e.g. "http.status_code=500 and error")'),
      state: z.enum(['ALL', 'SUCCESS', 'ERROR']).optional().describe('Trace state filter (SkyWalking)'),
      min_duration: z.string().optional().describe('Minimum duration (e.g. "500ms", "1s")'),
      max_duration: z.string().optional().describe('Maximum duration (Jaeger only)'),
      lookback: z.string().default('1h').describe('Time window (e.g. "1h", "30m", "2d")'),
      limit: z.number().default(20).describe('Max traces to return'),
    },
    async (params) => {
      try {
        return textResult(await provider.search(params));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── trace_get ─────────────────────────────────────────────────────────────

  server.tool(
    'trace_get',
    `Get full trace detail by ID. Backend: ${provider.backend}.`,
    { trace_id: z.string().describe('Trace ID (hex string)') },
    async ({ trace_id }) => {
      try {
        return textResult(await provider.getTrace(trace_id));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── traces_services ───────────────────────────────────────────────────────

  server.tool(
    'traces_services',
    `List services known to the traces backend. Backend: ${provider.backend}.`,
    { lookback: z.string().default('1h').describe('Time window (used by some providers)') },
    async ({ lookback }) => {
      if (!provider.services) return unsupported(provider, 'traces_services');
      try {
        return textResult(await provider.services({ lookback }));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── traces_operations ─────────────────────────────────────────────────────

  server.tool(
    'traces_operations',
    `List operations/endpoints for a service. Backend: ${provider.backend}.`,
    {
      service: z.string().describe('Service name'),
      lookback: z.string().default('1h').describe('Time window (used by some providers)'),
    },
    async ({ service, lookback }) => {
      if (!provider.operations) return unsupported(provider, 'traces_operations');
      try {
        return textResult(await provider.operations({ service, lookback }));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── traces_dependencies ───────────────────────────────────────────────────

  server.tool(
    'traces_dependencies',
    `Service dependency graph — which services call which. Backend: ${provider.backend}.`,
    { lookback: z.string().default('1h').describe('Time window to compute dependencies (e.g. "1h", "1d")') },
    async ({ lookback }) => {
      if (!provider.dependencies) return unsupported(provider, 'traces_dependencies');
      try {
        return textResult(await provider.dependencies({ lookback }));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

/** Resolve the active provider's backend name for startup display. */
function activeBackend(): string {
  const id = (process.env['TRACES_PROVIDER'] || 'jaeger').toLowerCase();
  switch (id) {
    case 'jaeger': return 'Jaeger';
    case 'tempo': return 'Tempo';
    case 'zipkin': return 'Zipkin';
    case 'skywalking': return 'SkyWalking';
    default: return id;
  }
}

export const skill: Skill = {
  id: 'traces',
  name: 'Distributed Traces',
  description:
    'Provider-agnostic trace search and inspection. Select backend via TRACES_PROVIDER (jaeger, tempo, zipkin, skywalking).',
  tools: 5,
  get backends() { return [activeBackend()]; },
  isAvailable: () => true,
  register: registerTools,
};
