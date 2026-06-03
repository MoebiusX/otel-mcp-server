/**
 * System skill — health checks, anomaly detection, and service topology.
 *
 * Tools: anomalies_active, anomalies_baselines, system_health, system_topology
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';
import { SKILL_VERSIONS } from '../skill-versions.js';
import { PROTOCOLS } from '../protocols.js';
import { classify, supportsFeature } from '../versions.js';
import { applyGating, evaluateFeature, getGatingMode } from '../gating.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const appApiUrl = helpers.env('APP_API_URL', 'http://localhost:5000');
  const jaegerUrl = helpers.env('JAEGER_URL', 'http://localhost:16686');
  const fetchApp = helpers.createFetcher('APP_API', 'app-api');
  const fetchJaeger = helpers.createFetcher('JAEGER', 'jaeger');

  // ── anomalies_active ──────────────────────────────────────────────────────

  server.tool(
    'anomalies_active',
    'Get currently active anomalies detected by trace-based and amount-based detectors.',
    {
      type: z.enum(['trace', 'amount', 'all']).default('all')
        .describe('Anomaly type to retrieve'),
    },
    async ({ type }) => {
      try {
        const results: Record<string, any> = {};
        if (type === 'trace' || type === 'all') {
          results.traceAnomalies = await fetchApp(`${appApiUrl}/api/monitor/anomalies`);
        }
        if (type === 'amount' || type === 'all') {
          results.amountAnomalies = await fetchApp(`${appApiUrl}/api/monitor/amount-anomalies`);
        }
        return textResult(results);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── anomalies_baselines ───────────────────────────────────────────────────

  server.tool(
    'anomalies_baselines',
    'Get current span duration baselines used for anomaly detection — mean, stdDev, p50, p95, p99 per operation.',
    {},
    async () => {
      try {
        const data = await fetchApp(`${appApiUrl}/api/monitor/baselines/enriched`);
        return textResult(data);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── system_health ─────────────────────────────────────────────────────────

  server.tool(
    'system_health',
    'Get full system health — service status, uptime, performance metrics, active alerts.',
    {},
    async () => {
      try {
        const data = await fetchApp(`${appApiUrl}/api/monitor/health`);
        return textResult(data);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── system_topology ───────────────────────────────────────────────────────

  server.tool(
    'system_topology',
    'Get the live service dependency topology with health overlays from Jaeger and the application API.',
    {},
    async () => {
      try {
        const [deps, health] = await Promise.all([
          fetchJaeger(`${jaegerUrl}/api/dependencies?endTs=${Date.now()}&lookback=3600000`),
          fetchApp(`${appApiUrl}/api/monitor/health`).catch(() => null),
        ]);
        return textResult({ dependencies: deps.data || [], health });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── backend_capabilities ──────────────────────────────────────────────────

  server.tool(
    'backend_capabilities',
    'Report supported product versions and protocol feature availability per ' +
      'backend. Optionally filter by skill and classify a specific backend ' +
      'version into its support tier with a per-feature availability breakdown.',
    {
      skill: z.string().optional()
        .describe('Filter to one skill id (e.g. "metrics", "logs", "traces").'),
      backend: z.string().optional()
        .describe('Backend display name to classify (e.g. "Prometheus"). Requires skill + version.'),
      version: z.string().optional()
        .describe('Detected version to classify (e.g. "3.0.1"). Requires skill + backend.'),
    },
    async ({ skill, backend, version }) => {
      try {
        const gatingMode = getGatingMode(helpers.env);
        const report: any = {
          protocolModel: 'capability → product → protocol-adapter',
          gatingMode,
          skills: [],
        };

        const skillIds = skill
          ? Object.keys(SKILL_VERSIONS).filter((id) => id === skill)
          : Object.keys(SKILL_VERSIONS).sort();

        if (skill && skillIds.length === 0) {
          return errorResult(`Unknown or unversioned skill: ${skill}`);
        }

        for (const skillId of skillIds) {
          const support = SKILL_VERSIONS[skillId];
          const backendsOut = Object.keys(support).map((backendName) => {
            const entry = support[backendName];
            const adapter = PROTOCOLS[entry.protocol];
            const since = entry.protocolFeaturesSince ?? {};
            const versionedFeatures = Object.keys(since).map((fid) => ({
              feature: fid,
              summary: (adapter.versionedFeatures as any)[fid]?.summary,
              since: (since as any)[fid],
            }));

            const out: any = {
              backend: backendName,
              protocol: entry.protocol,
              queryLanguage: adapter.queryLanguage,
              products: adapter.products,
              productVersions: entry.productVersions,
              baselineFeatures: adapter.baselineFeatures,
              versionedFeatures,
            };

            // Optional classification for a concrete detected version.
            if (version && backend && backendName === backend) {
              const gatedOut: string[] = [];
              const featureDecisions = Object.keys(since).map((fid) => {
                const gate = supportsFeature(entry, fid, version);
                if (gate.available === false && gate.reason === 'below-min') {
                  gatedOut.push(fid);
                }
                const decision = evaluateFeature(skillId, fid, version, backendName);
                const verdict = applyGating(decision, gatingMode);
                return {
                  feature: fid,
                  ...gate,
                  proceed: verdict.ok,
                  blocked: verdict.blocked,
                  ...(verdict.warning ? { warning: verdict.warning } : {}),
                  ...(verdict.error ? { error: verdict.error } : {}),
                };
              });
              out.classification = {
                detectedVersion: version,
                supportTier: classify(version, entry.productVersions),
                gatingMode,
                gatedOut,
                features: featureDecisions,
              };
            }
            return out;
          });

          report.skills.push({ skill: skillId, backends: backendsOut });
        }

        if (version && (!skill || !backend)) {
          report.note =
            'Provide both `skill` and `backend` alongside `version` to get a per-feature classification.';
        }

        return textResult(report);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'system',
  name: 'System Health',
  description: 'Health checks, anomaly detection, and live service topology',
  tools: 5,
  backends: ['App API', 'Jaeger'],
  isAvailable: () => true,
  register: registerTools,
};
