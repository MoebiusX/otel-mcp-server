/**
 * Grafana skill — read-only verification and interrogation of Grafana, plus
 * opt-in write tools for provisioning dashboards and folders.
 *
 * Read tools: grafana_health, grafana_datasources, grafana_datasource_health,
 *        grafana_datasource_query, grafana_dashboards_search,
 *        grafana_dashboard_get, grafana_folders, grafana_alert_rules,
 *        grafana_alerts, grafana_contact_points
 * Write tools (only when MCP_ENABLE_WRITES is set): grafana_create_dashboard,
 *        grafana_delete_dashboard, grafana_create_folder
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function numberFromEnv(value: string, fallback: number, max = MAX_LIMIT): number {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function truncate(value: string, maxLength = 2_000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '[redacted]' : '';
      parsed.password = parsed.password ? '[redacted]' : '';
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function isSensitiveKey(key: string): boolean {
  return /password|secret|token|apikey|api_key|authorization|cookie|private|webhook/i.test(key);
}

function redactSensitive(value: unknown, keyHint = ''): unknown {
  if (isSensitiveKey(keyHint)) return '[redacted]';
  if (typeof value === 'string') return truncate(value);
  if (Array.isArray(value)) return value.map(item => redactSensitive(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        redactSensitive(nestedValue, key),
      ]),
    );
  }
  return value;
}

function summarizeDatasource(datasource: any): Record<string, unknown> {
  return {
    id: datasource.id,
    uid: datasource.uid,
    orgId: datasource.orgId,
    name: datasource.name,
    type: datasource.type,
    typeName: datasource.typeName,
    access: datasource.access,
    url: redactUrl(datasource.url),
    isDefault: datasource.isDefault,
    readOnly: datasource.readOnly,
    basicAuth: datasource.basicAuth,
    withCredentials: datasource.withCredentials,
    jsonData: redactSensitive(datasource.jsonData || {}),
    secureJsonFields: Object.keys(datasource.secureJsonFields || {}),
    version: datasource.version,
    apiVersion: datasource.apiVersion,
  };
}

function summarizeDatasourceRef(datasource: any): unknown {
  if (!datasource) return null;
  if (typeof datasource === 'string') return datasource;
  return {
    uid: datasource.uid,
    type: datasource.type,
    name: datasource.name,
    default: datasource.default,
  };
}

function summarizeTarget(target: any): Record<string, unknown> {
  return {
    refId: target.refId,
    datasource: summarizeDatasourceRef(target.datasource),
    expr: typeof target.expr === 'string' ? truncate(target.expr) : target.expr,
    query: typeof target.query === 'string' ? truncate(target.query) : target.query,
    rawSql: typeof target.rawSql === 'string' ? truncate(target.rawSql) : target.rawSql,
    legendFormat: target.legendFormat,
    queryType: target.queryType,
    instant: target.instant,
    range: target.range,
    interval: target.interval,
    intervalMs: target.intervalMs,
    maxDataPoints: target.maxDataPoints,
  };
}

function flattenPanels(panels: any[]): any[] {
  const flattenedPanels: any[] = [];
  for (const panel of panels || []) {
    flattenedPanels.push(panel);
    if (Array.isArray(panel.panels)) {
      flattenedPanels.push(...flattenPanels(panel.panels));
    }
  }
  return flattenedPanels;
}

function summarizePanel(panel: any): Record<string, unknown> {
  const defaults = panel.fieldConfig?.defaults || {};
  return {
    id: panel.id,
    title: panel.title,
    type: panel.type,
    description: panel.description,
    datasource: summarizeDatasourceRef(panel.datasource),
    targets: (panel.targets || []).map(summarizeTarget),
    gridPos: panel.gridPos,
    fieldConfig: {
      unit: defaults.unit,
      min: defaults.min,
      max: defaults.max,
      decimals: defaults.decimals,
      thresholds: defaults.thresholds?.steps?.map((step: any) => ({
        color: step.color,
        value: step.value,
      })),
      mappingsCount: defaults.mappings?.length || 0,
    },
    transformations: (panel.transformations || []).map((transformation: any) => ({
      id: transformation.id,
    })),
  };
}

function summarizeVariable(variable: any): Record<string, unknown> {
  return {
    name: variable.name,
    type: variable.type,
    label: variable.label,
    datasource: summarizeDatasourceRef(variable.datasource),
    query: redactSensitive(variable.query),
    current: redactSensitive(variable.current),
    optionsCount: variable.options?.length || 0,
  };
}

function summarizeDashboardSearchItem(item: any): Record<string, unknown> {
  return {
    id: item.id,
    uid: item.uid,
    title: item.title,
    type: item.type,
    folderUid: item.folderUid,
    folderTitle: item.folderTitle,
    url: item.url,
    uri: item.uri,
    tags: item.tags || [],
    isStarred: item.isStarred,
  };
}

function summarizeFrame(frame: any): Record<string, unknown> {
  const fields = frame.schema?.fields || [];
  const values = frame.data?.values || [];
  const rowCount = Array.isArray(values[0]) ? values[0].length : 0;
  const sampleRows = [];
  for (let rowIndex = 0; rowIndex < Math.min(rowCount, 5); rowIndex++) {
    const row: Record<string, unknown> = {};
    fields.forEach((field: any, fieldIndex: number) => {
      row[field.name || `field_${fieldIndex}`] = values[fieldIndex]?.[rowIndex];
    });
    sampleRows.push(row);
  }
  return {
    name: frame.schema?.name,
    refId: frame.schema?.refId,
    fields: fields.map((field: any) => ({
      name: field.name,
      type: field.type,
      labels: field.labels,
    })),
    rowCount,
    sampleRows,
  };
}

function summarizeQueryResponse(response: any): Record<string, unknown> {
  const results = Object.entries(response.results || {}).map(([refId, result]) => {
    const queryResult = result as any;
    return {
      refId,
      status: queryResult.status,
      error: queryResult.error,
      frameCount: queryResult.frames?.length || 0,
      frames: (queryResult.frames || []).map(summarizeFrame),
    };
  });
  return { results };
}

function buildQueryModel(params: {
  datasource: any;
  query: string;
  queryType?: string;
  refId: string;
  intervalMs: number;
  maxDataPoints: number;
  instant: boolean;
  rawQueryModel?: Record<string, unknown>;
}): Record<string, unknown> {
  const datasourceRef = {
    type: params.datasource.type,
    uid: params.datasource.uid,
  };
  const common = {
    refId: params.refId,
    datasource: datasourceRef,
    intervalMs: params.intervalMs,
    maxDataPoints: params.maxDataPoints,
  };

  if (params.rawQueryModel) {
    return {
      ...params.rawQueryModel,
      ...common,
      datasource: datasourceRef,
    };
  }

  if (params.datasource.type === 'prometheus') {
    return {
      ...common,
      expr: params.query,
      instant: params.instant,
      range: !params.instant,
      queryType: params.queryType,
      format: 'time_series',
    };
  }

  if (params.datasource.type === 'loki') {
    return {
      ...common,
      expr: params.query,
      queryType: params.queryType || 'range',
    };
  }

  if (params.datasource.type === 'elasticsearch' || params.datasource.type === 'grafana-elasticsearch-datasource') {
    return {
      ...common,
      query: params.query,
      queryType: params.queryType || 'lucene',
    };
  }

  return {
    ...common,
    query: params.query,
    expr: params.query,
    queryType: params.queryType,
  };
}

function summarizeAlertRule(rule: any): Record<string, unknown> {
  return {
    uid: rule.uid,
    title: rule.title,
    orgID: rule.orgID,
    folderUID: rule.folderUID,
    ruleGroup: rule.ruleGroup,
    condition: rule.condition,
    for: rule.for,
    noDataState: rule.noDataState,
    execErrState: rule.execErrState,
    isPaused: rule.isPaused,
    labels: rule.labels || {},
    annotations: rule.annotations || {},
    data: (rule.data || []).map((query: any) => ({
      refId: query.refId,
      datasourceUid: query.datasourceUid,
      relativeTimeRange: query.relativeTimeRange,
      model: summarizeTarget(query.model || {}),
    })),
  };
}

function summarizeAlert(alert: any): Record<string, unknown> {
  return {
    fingerprint: alert.fingerprint,
    status: alert.status?.state || alert.status,
    labels: alert.labels || {},
    annotations: alert.annotations || {},
    startsAt: alert.startsAt,
    endsAt: alert.endsAt,
    generatorURL: alert.generatorURL,
    receivers: alert.receivers?.map((receiver: any) => receiver.name),
    silencedBy: alert.status?.silencedBy || [],
    inhibitedBy: alert.status?.inhibitedBy || [],
  };
}

function summarizeContactPoint(receiver: any): Record<string, unknown> {
  return {
    name: receiver.name,
    active: receiver.active,
    integrations: (receiver.integrations || []).map((integration: any) => ({
      name: integration.name,
      sendResolved: integration.sendResolved,
      lastNotifyAttempt: integration.lastNotifyAttempt,
      lastNotifyAttemptDuration: integration.lastNotifyAttemptDuration,
    })),
  };
}

/**
 * Whether mutating (write) tools are enabled. Writes are opt-in and disabled by
 * default: read-only stays the safe default posture. Enable with
 * `MCP_ENABLE_WRITES=true` (also accepts 1/yes/on).
 */
function writesEnabled(helpers: SkillHelpers): boolean {
  return /^(1|true|yes|on)$/i.test(helpers.env('MCP_ENABLE_WRITES').trim());
}

/** True when an error from the fetcher carries a given HTTP status code. */
function isHttpStatus(err: unknown, status: number): boolean {
  return new RegExp(`HTTP ${status}\\b`).test(String((err as any)?.message ?? err));
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const grafanaUrl = normalizeBaseUrl(helpers.env('GRAFANA_URL'));
  if (!grafanaUrl) return;

  const orgId = helpers.env('GRAFANA_ORG_ID');
  const defaultLimit = numberFromEnv(helpers.env('GRAFANA_MAX_ITEMS'), DEFAULT_LIMIT);
  const defaultFrom = helpers.env('GRAFANA_DEFAULT_FROM', 'now-1h');
  const fetchGrafana = helpers.createFetcher('GRAFANA', 'grafana', {
    timeoutMs: Math.max(helpers.timeoutMs, 30_000),
    extraHeaders: orgId ? { 'X-Grafana-Org-Id': orgId } : undefined,
  });

  // ── grafana_health ───────────────────────────────────────────────────────

  server.tool(
    'grafana_health',
    'Get Grafana health, version, commit, and database status.',
    {},
    async () => {
      try {
        const data = await fetchGrafana(`${grafanaUrl}/api/health`);
        return textResult({
          version: data.version,
          commit: data.commit,
          database: data.database,
          orgId: orgId || null,
        });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_datasources ──────────────────────────────────────────────────

  server.tool(
    'grafana_datasources',
    'List Grafana data sources with type, UID, access mode, default status, and safe metadata.',
    {
      type: z.string().optional().describe('Filter by data source type, e.g. prometheus, loki, elasticsearch.'),
      name: z.string().optional().describe('Case-insensitive data source name filter.'),
      limit: z.number().int().positive().max(MAX_LIMIT).default(defaultLimit).describe('Maximum data sources to return.'),
    },
    async ({ type, name, limit }) => {
      try {
        const data = await fetchGrafana(`${grafanaUrl}/api/datasources`);
        const datasources = (Array.isArray(data) ? data : [])
          .filter((datasource: any) => !type || datasource.type === type)
          .filter((datasource: any) => !name || String(datasource.name || '').toLowerCase().includes(name.toLowerCase()))
          .slice(0, limit)
          .map(summarizeDatasource);
        return textResult({ count: datasources.length, datasources });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_datasource_health ────────────────────────────────────────────

  server.tool(
    'grafana_datasource_health',
    'Check a Grafana data source by UID and return its metadata plus health status when supported.',
    {
      uid: z.string().describe('Grafana data source UID.'),
    },
    async ({ uid }) => {
      try {
        const datasource = await fetchGrafana(`${grafanaUrl}/api/datasources/uid/${encodeURIComponent(uid)}`);
        const health = await fetchGrafana(`${grafanaUrl}/api/datasources/uid/${encodeURIComponent(uid)}/health`)
          .then((data: any) => ({ supported: true, ...data }))
          .catch((err: any) => ({ supported: false, error: err.message }));
        return textResult({ datasource: summarizeDatasource(datasource), health });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_datasource_query ─────────────────────────────────────────────

  server.tool(
    'grafana_datasource_query',
    'Run a read-only query through Grafana unified data source query API and summarize returned data frames.',
    {
      datasource_uid: z.string().describe('Grafana data source UID.'),
      query: z.string().describe('Read-only query expression, such as PromQL or LogQL.'),
      query_type: z.string().optional().describe('Optional plugin-specific query type.'),
      from: z.string().default(defaultFrom).describe('Range start, e.g. now-1h or an ISO timestamp.'),
      to: z.string().default('now').describe('Range end, e.g. now or an ISO timestamp.'),
      ref_id: z.string().default('A').describe('Grafana query ref ID.'),
      interval_ms: z.number().int().positive().max(3_600_000).default(1_000).describe('Query interval in milliseconds.'),
      max_data_points: z.number().int().positive().max(10_000).default(500).describe('Maximum returned data points requested from Grafana.'),
      instant: z.boolean().default(false).describe('Use an instant query when supported by the data source.'),
      format: z.enum(['summary', 'raw']).default('summary').describe('Return summarized frames by default, or raw Grafana response.'),
      raw_query_model: z.record(z.string(), z.any()).optional().describe('Advanced plugin-specific query model. Still sent read-only through /api/ds/query.'),
    },
    async (params) => {
      try {
        const datasource = await fetchGrafana(
          `${grafanaUrl}/api/datasources/uid/${encodeURIComponent(params.datasource_uid)}`,
        );
        const queryModel = buildQueryModel({
          datasource,
          query: params.query,
          queryType: params.query_type,
          refId: params.ref_id,
          intervalMs: params.interval_ms,
          maxDataPoints: params.max_data_points,
          instant: params.instant,
          rawQueryModel: params.raw_query_model,
        });
        const body = {
          from: params.from,
          to: params.to,
          queries: [queryModel],
        };
        const data = await fetchGrafana(
          `${grafanaUrl}/api/ds/query`,
          undefined,
          { method: 'POST', body: JSON.stringify(body) },
        );
        return textResult(params.format === 'raw'
          ? redactSensitive(data)
          : summarizeQueryResponse(data));
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_dashboards_search ────────────────────────────────────────────

  server.tool(
    'grafana_dashboards_search',
    'Search Grafana dashboards and folders by text, tag, folder UID, type, or starred status.',
    {
      query: z.string().optional().describe('Search text.'),
      tag: z.array(z.string()).optional().describe('Dashboard tags to match.'),
      folder_uid: z.string().optional().describe('Folder UID to search within.'),
      type: z.enum(['all', 'dash-db', 'dash-folder']).default('all').describe('Search dashboards, folders, or both.'),
      starred: z.boolean().optional().describe('Filter starred dashboards.'),
      limit: z.number().int().positive().max(MAX_LIMIT).default(defaultLimit).describe('Maximum results to return.'),
    },
    async ({ query, tag, folder_uid, type, starred, limit }) => {
      try {
        const searchParams = new URLSearchParams({ limit: String(limit) });
        if (query) searchParams.set('query', query);
        if (folder_uid) searchParams.set('folderUIDs', folder_uid);
        if (type !== 'all') searchParams.set('type', type);
        if (starred !== undefined) searchParams.set('starred', String(starred));
        for (const tagName of tag || []) searchParams.append('tag', tagName);

        const data = await fetchGrafana(`${grafanaUrl}/api/search?${searchParams}`);
        const results = (Array.isArray(data) ? data : []).map(summarizeDashboardSearchItem);
        return textResult({ count: results.length, results });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_dashboard_get ────────────────────────────────────────────────

  server.tool(
    'grafana_dashboard_get',
    'Get a Grafana dashboard by UID with summarized panels, variables, data source references, and panel queries.',
    {
      uid: z.string().describe('Dashboard UID.'),
      include_json: z.boolean().default(false).describe('Include sanitized raw dashboard JSON.'),
      panel_limit: z.number().int().positive().max(MAX_LIMIT).default(100).describe('Maximum panel summaries to return.'),
    },
    async ({ uid, include_json, panel_limit }) => {
      try {
        const data = await fetchGrafana(`${grafanaUrl}/api/dashboards/uid/${encodeURIComponent(uid)}`);
        const dashboard = data.dashboard || {};
        const panels = flattenPanels(dashboard.panels || []);
        const result: Record<string, unknown> = {
          meta: {
            folderUid: data.meta?.folderUid,
            folderTitle: data.meta?.folderTitle,
            url: data.meta?.url,
            slug: data.meta?.slug,
            canSave: data.meta?.canSave,
            canEdit: data.meta?.canEdit,
            isStarred: data.meta?.isStarred,
          },
          dashboard: {
            uid: dashboard.uid,
            title: dashboard.title,
            tags: dashboard.tags || [],
            timezone: dashboard.timezone,
            refresh: dashboard.refresh,
            time: dashboard.time,
            schemaVersion: dashboard.schemaVersion,
            version: dashboard.version,
            variables: (dashboard.templating?.list || []).map(summarizeVariable),
            panelCount: panels.length,
            returnedPanels: Math.min(panels.length, panel_limit),
            panels: panels.slice(0, panel_limit).map(summarizePanel),
          },
        };
        if (include_json) {
          result.raw = redactSensitive(dashboard);
        }
        return textResult(result);
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_folders ──────────────────────────────────────────────────────

  server.tool(
    'grafana_folders',
    'List Grafana folders with UID, title, URL, and basic metadata.',
    {
      limit: z.number().int().positive().max(MAX_LIMIT).default(defaultLimit).describe('Maximum folders to return.'),
    },
    async ({ limit }) => {
      try {
        const data = await fetchGrafana(`${grafanaUrl}/api/folders?limit=${limit}`);
        const folders = (Array.isArray(data) ? data : []).map((folder: any) => ({
          id: folder.id,
          uid: folder.uid,
          title: folder.title,
          url: folder.url,
          hasAcl: folder.hasAcl,
          canSave: folder.canSave,
          canEdit: folder.canEdit,
        }));
        return textResult({ count: folders.length, folders });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_alert_rules ──────────────────────────────────────────────────

  server.tool(
    'grafana_alert_rules',
    'List Grafana-managed alert rules with labels, annotations, conditions, and query references.',
    {
      folder_uid: z.string().optional().describe('Filter by folder UID.'),
      datasource_uid: z.string().optional().describe('Filter rules that reference a data source UID.'),
      limit: z.number().int().positive().max(MAX_LIMIT).default(defaultLimit).describe('Maximum alert rules to return.'),
    },
    async ({ folder_uid, datasource_uid, limit }) => {
      try {
        const data = await fetchGrafana(`${grafanaUrl}/api/v1/provisioning/alert-rules`);
        const rules = (Array.isArray(data) ? data : [])
          .filter((rule: any) => !folder_uid || rule.folderUID === folder_uid)
          .filter((rule: any) => !datasource_uid || (rule.data || []).some((query: any) => query.datasourceUid === datasource_uid))
          .slice(0, limit)
          .map(summarizeAlertRule);
        return textResult({ count: rules.length, rules });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_alerts ───────────────────────────────────────────────────────

  server.tool(
    'grafana_alerts',
    'List active Grafana Alertmanager alert instances with labels, annotations, timing, and routing status.',
    {
      filter: z.array(z.string()).optional().describe('Label matchers, e.g. ["severity=critical"].'),
      active: z.boolean().default(true).describe('Include active alerts.'),
      silenced: z.boolean().default(false).describe('Include silenced alerts.'),
      inhibited: z.boolean().default(false).describe('Include inhibited alerts.'),
      limit: z.number().int().positive().max(MAX_LIMIT).default(defaultLimit).describe('Maximum alerts to return.'),
    },
    async ({ filter, active, silenced, inhibited, limit }) => {
      try {
        const searchParams = new URLSearchParams({
          active: String(active),
          silenced: String(silenced),
          inhibited: String(inhibited),
        });
        for (const matcher of filter || []) searchParams.append('filter', matcher);
        const data = await fetchGrafana(`${grafanaUrl}/api/alertmanager/grafana/api/v2/alerts?${searchParams}`);
        const alerts = (Array.isArray(data) ? data : []).slice(0, limit).map(summarizeAlert);
        return textResult({ count: alerts.length, alerts });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_contact_points ───────────────────────────────────────────────

  server.tool(
    'grafana_contact_points',
    'List Grafana alert contact points or receivers with safe integration status metadata.',
    {},
    async () => {
      try {
        const data = await fetchGrafana(`${grafanaUrl}/api/alertmanager/grafana/config/api/v1/receivers`);
        const contactPoints = (Array.isArray(data) ? data : []).map(summarizeContactPoint);
        return textResult({ count: contactPoints.length, contactPoints });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── Write tools (opt-in) ──────────────────────────────────────────────────
  // Disabled unless MCP_ENABLE_WRITES is set. Read-only stays the default
  // posture, so these tools are only advertised when writes are enabled.
  if (!writesEnabled(helpers)) return;

  /** Look up a dashboard by UID; returns existence + version without throwing on 404. */
  async function getDashboard(uid: string): Promise<{ exists: boolean; version?: number; title?: string }> {
    try {
      const data = await fetchGrafana(`${grafanaUrl}/api/dashboards/uid/${encodeURIComponent(uid)}`);
      return { exists: true, version: data.dashboard?.version, title: data.dashboard?.title };
    } catch (err: any) {
      if (isHttpStatus(err, 404)) return { exists: false };
      throw err;
    }
  }

  /** Look up a folder by UID; returns existence + version without throwing on 404. */
  async function getFolder(uid: string): Promise<{ exists: boolean; version?: number; title?: string }> {
    try {
      const data = await fetchGrafana(`${grafanaUrl}/api/folders/${encodeURIComponent(uid)}`);
      return { exists: true, version: data.version, title: data.title };
    } catch (err: any) {
      if (isHttpStatus(err, 404)) return { exists: false };
      throw err;
    }
  }

  // ── grafana_create_dashboard ─────────────────────────────────────────────

  server.tool(
    'grafana_create_dashboard',
    'Create, upsert, or update a Grafana dashboard via POST /api/dashboards/db. ' +
      'mode=create (default) is a strict insert that fails if the UID already exists; ' +
      'mode=upsert creates or overwrites; mode=update requires the dashboard to already exist. ' +
      'Requires MCP_ENABLE_WRITES and a token with dashboards:write.',
    {
      dashboard: z.record(z.string(), z.any()).describe('Dashboard model JSON (must include a "title"; "uid" optional). An "id" field is ignored.'),
      folder_uid: z.string().optional().describe('Target folder UID. Omit for the General folder.'),
      message: z.string().optional().describe('Commit message recorded in the dashboard version history.'),
      mode: z.enum(['create', 'upsert', 'update']).default('create').describe('create = strict insert (fail if UID exists); upsert = create-or-overwrite; update = fail if UID is absent.'),
      dry_run: z.boolean().default(false).describe('Validate and report the planned action without writing.'),
    },
    async ({ dashboard, folder_uid, message, mode, dry_run }) => {
      try {
        const dash: Record<string, unknown> = { ...dashboard };
        delete dash.id; // UID + overwrite drive create/update; a stale numeric id can misbind.
        const title = dash.title;
        if (typeof title !== 'string' || !title.trim()) {
          return errorResult('dashboard.title is required and must be a non-empty string.');
        }
        const uid = typeof dash.uid === 'string' && dash.uid ? dash.uid : undefined;

        if (uid && (mode === 'create' || mode === 'update')) {
          const existing = await getDashboard(uid);
          if (mode === 'create' && existing.exists) {
            return errorResult(
              `conflict: dashboard uid "${uid}" already exists (version ${existing.version}, title "${existing.title}"). Use mode=upsert to overwrite.`,
            );
          }
          if (mode === 'update' && !existing.exists) {
            return errorResult(`dashboard uid "${uid}" does not exist. Use mode=create to create it.`);
          }
        }

        if (dry_run) {
          return textResult({ dryRun: true, mode, wouldApply: { uid: uid ?? null, title, folderUid: folder_uid ?? null } });
        }

        const overwrite = mode !== 'create'; // strict insert never overwrites; upsert/update may.
        const body: Record<string, unknown> = { dashboard: dash, overwrite };
        if (folder_uid) body.folderUid = folder_uid;
        if (message) body.message = message;

        try {
          const result = await fetchGrafana(`${grafanaUrl}/api/dashboards/db`, undefined, {
            method: 'POST',
            body: JSON.stringify(body),
          });
          return textResult({
            status: result.status ?? 'success',
            uid: result.uid,
            id: result.id,
            version: result.version,
            url: result.url,
            slug: result.slug,
            mode,
          });
        } catch (err: any) {
          // overwrite=false collisions (UID/title/version) surface as 412/409/400.
          if (mode === 'create' && (isHttpStatus(err, 412) || isHttpStatus(err, 409) || isHttpStatus(err, 400))) {
            return errorResult(`conflict creating dashboard "${title}": ${err.message}. Use mode=upsert to overwrite.`);
          }
          throw err;
        }
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_delete_dashboard ─────────────────────────────────────────────

  server.tool(
    'grafana_delete_dashboard',
    'Delete a Grafana dashboard by UID via DELETE /api/dashboards/uid/{uid}. ' +
      'Requires MCP_ENABLE_WRITES and a token with dashboards:delete.',
    {
      uid: z.string().describe('Dashboard UID to delete.'),
      dry_run: z.boolean().default(false).describe('Report the dashboard that would be deleted without deleting it.'),
    },
    async ({ uid, dry_run }) => {
      try {
        const existing = await getDashboard(uid);
        if (!existing.exists) {
          return errorResult(`dashboard uid "${uid}" not found.`);
        }
        if (dry_run) {
          return textResult({ dryRun: true, wouldDelete: { uid, title: existing.title } });
        }
        const result = await fetchGrafana(`${grafanaUrl}/api/dashboards/uid/${encodeURIComponent(uid)}`, undefined, {
          method: 'DELETE',
        });
        return textResult({ deleted: true, uid, title: result.title ?? existing.title, message: result.message });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );

  // ── grafana_create_folder ────────────────────────────────────────────────

  server.tool(
    'grafana_create_folder',
    'Create or upsert a Grafana folder. mode=create (default) is a strict insert that fails if the UID exists; ' +
      'mode=upsert creates the folder or renames it when the UID already exists. ' +
      'Requires MCP_ENABLE_WRITES and a token with folders:write.',
    {
      title: z.string().describe('Folder title.'),
      uid: z.string().optional().describe('Folder UID. Omit to let Grafana generate one (create only).'),
      mode: z.enum(['create', 'upsert']).default('create').describe('create = strict insert (fail if UID exists); upsert = create-or-update.'),
      dry_run: z.boolean().default(false).describe('Validate and report the planned action without writing.'),
    },
    async ({ title, uid, mode, dry_run }) => {
      try {
        if (!title.trim()) return errorResult('title is required and must be a non-empty string.');

        if (uid && mode === 'create') {
          const existing = await getFolder(uid);
          if (existing.exists) {
            return errorResult(
              `conflict: folder uid "${uid}" already exists (title "${existing.title}"). Use mode=upsert to update.`,
            );
          }
        }

        if (dry_run) {
          return textResult({ dryRun: true, mode, wouldApply: { uid: uid ?? null, title } });
        }

        if (mode === 'upsert' && uid) {
          const existing = await getFolder(uid);
          if (existing.exists) {
            const result = await fetchGrafana(`${grafanaUrl}/api/folders/${encodeURIComponent(uid)}`, undefined, {
              method: 'PUT',
              body: JSON.stringify({ title, overwrite: true }),
            });
            return textResult({ updated: true, uid: result.uid, title: result.title, version: result.version, url: result.url });
          }
        }

        const result = await fetchGrafana(`${grafanaUrl}/api/folders`, undefined, {
          method: 'POST',
          body: JSON.stringify(uid ? { uid, title } : { title }),
        });
        return textResult({ created: true, uid: result.uid, title: result.title, version: result.version, url: result.url });
      } catch (err: any) {
        return errorResult(err.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'grafana',
  name: 'Grafana',
  description: 'Read-only Grafana verification across data sources, dashboards, folders, alerts, and contact points (plus opt-in dashboard/folder write tools via MCP_ENABLE_WRITES)',
  tools: 10,
  backends: ['Grafana'],
  isAvailable: () => !!process.env['GRAFANA_URL'],
  register: registerTools,
};