/**
 * vmalert skill — query alerting + recording rules, their evaluation health,
 * and active alerts from a VictoriaMetrics vmalert instance.
 *
 * vmalert is the component that actually evaluates rules in a VictoriaMetrics
 * stack: VM single-node stores and serves time series but does NOT evaluate
 * rules, so its /api/v1/rules is always empty. vmalert exposes the
 * Prometheus-compatible rules API plus its own active-alert view.
 *
 * Tools: vmalert_rules, vmalert_alerts, vmalert_groups, vmalert_rule_health
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const vmalertUrl = helpers.env('VMALERT_URL');
  if (!vmalertUrl) return;

  const fetchJSON = helpers.createFetcher('VMALERT', 'vmalert');

  // ── vmalert_rules ─────────────────────────────────────────────────────────

  server.tool(
    'vmalert_rules',
    'List alerting and/or recording rules evaluated by vmalert, with their '
      + 'current state, query, and evaluation health.',
    {
      type: z.enum(['all', 'alerting', 'recording']).default('all')
        .describe('Filter rules by type'),
      state: z.enum(['all', 'firing', 'pending', 'inactive']).default('all')
        .describe('Filter alerting rules by state (ignored for recording rules)'),
    },
    async ({ type, state }) => {
      try {
        const qs = new URLSearchParams();
        if (type === 'alerting') qs.set('type', 'alert');
        else if (type === 'recording') qs.set('type', 'record');
        const suffix = qs.toString() ? `?${qs}` : '';

        const data = await fetchJSON(`${vmalertUrl}/api/v1/rules${suffix}`);
        const groups = ((data.data?.groups || []) as any[]).map((g: any) => ({
          name: g.name,
          file: g.file,
          interval: g.interval,
          rules: ((g.rules || []) as any[])
            .filter((r: any) =>
              r.type === 'recording'
              || state === 'all'
              || r.state === state)
            .map((r: any) => ({
              name: r.name,
              type: r.type,
              state: r.state,
              severity: r.labels?.severity,
              query: r.query,
              duration: r.duration,
              health: r.health,
              lastError: r.lastError || null,
              evaluationTime: r.evaluationTime,
              lastEvaluation: r.lastEvaluation,
              activeAt: r.alerts?.[0]?.activeAt || null,
              annotations: r.annotations,
            })),
        })).filter((g: any) => g.rules.length > 0);
        return textResult({ groups });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── vmalert_alerts ────────────────────────────────────────────────────────

  server.tool(
    'vmalert_alerts',
    'Get active alerts as vmalert currently sees them (pre-Alertmanager), with '
      + 'labels, annotations, value, and source deep-links.',
    {
      filter: z.enum(['all', 'firing', 'pending']).default('all')
        .describe('Filter alerts by state'),
    },
    async ({ filter }) => {
      try {
        const data = await fetchJSON(`${vmalertUrl}/api/v1/alerts`);
        const alerts = ((data.data?.alerts || []) as any[])
          .filter((a: any) => filter === 'all' || a.state === filter)
          .map((a: any) => ({
            name: a.name,
            state: a.state,
            value: a.value,
            severity: a.labels?.severity,
            labels: a.labels,
            annotations: a.annotations,
            activeAt: a.activeAt,
            source: a.source,
          }));
        return textResult({ count: alerts.length, alerts });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── vmalert_groups ────────────────────────────────────────────────────────

  server.tool(
    'vmalert_groups',
    'List rule groups with their evaluation metadata — interval, source file, '
      + 'concurrency, and rule counts by type.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${vmalertUrl}/api/v1/rules`);
        const groups = ((data.data?.groups || []) as any[]).map((g: any) => {
          const rules = (g.rules || []) as any[];
          return {
            name: g.name,
            file: g.file,
            interval: g.interval,
            concurrency: g.concurrency,
            alertingRules: rules.filter((r: any) => r.type === 'alerting').length,
            recordingRules: rules.filter((r: any) => r.type === 'recording').length,
            lastEvaluation: g.lastEvaluation,
          };
        });
        return textResult({ count: groups.length, groups });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── vmalert_rule_health ───────────────────────────────────────────────────

  server.tool(
    'vmalert_rule_health',
    'Surface rules that are failing to evaluate — returns only rules whose '
      + 'health is not "ok" (e.g. "err"), with the evaluation error.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${vmalertUrl}/api/v1/rules`);
        const unhealthy: any[] = [];
        for (const g of (data.data?.groups || []) as any[]) {
          for (const r of (g.rules || []) as any[]) {
            if (r.health && r.health !== 'ok') {
              unhealthy.push({
                group: g.name,
                file: g.file,
                name: r.name,
                type: r.type,
                health: r.health,
                lastError: r.lastError || null,
                query: r.query,
                lastEvaluation: r.lastEvaluation,
              });
            }
          }
        }
        return textResult({ unhealthy: unhealthy.length, rules: unhealthy });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'vmalert',
  name: 'vmalert Rules',
  description: 'Query alerting/recording rules, evaluation health, and active alerts via the vmalert API',
  tools: 4,
  backends: ['vmalert'],
  isAvailable: () => !!process.env['VMALERT_URL'],
  register: registerTools,
};
