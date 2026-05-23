import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

interface FetchCall {
  url: string;
  init?: any;
}

function mockFetch(responses: Record<string, any>, calls: FetchCall[] = []) {
  return vi.fn(async (url: string | URL | Request, init?: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    calls.push({ url: urlStr, init });
    for (const [pattern, data] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        return { ok: true, json: async () => data };
      }
    }
    return { ok: false, status: 404, statusText: 'Not Found' };
  });
}

async function createTestClient(tools?: string[]) {
  const server = createServer(tools ? { tools } : undefined);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

const datasource = {
  id: 1,
  uid: 'prometheus',
  orgId: 1,
  name: 'Prometheus',
  type: 'prometheus',
  typeName: 'Prometheus',
  access: 'proxy',
  url: 'http://localhost:9090',
  isDefault: true,
  readOnly: true,
  basicAuth: false,
  withCredentials: false,
  jsonData: { timeInterval: '1s' },
  secureJsonFields: { httpHeaderValue1: true },
  version: 1,
};

function grafanaResponses() {
  return {
    '/api/datasources/uid/prometheus/health': {
      status: 'OK',
      message: 'Successfully queried the Prometheus API.',
      details: { application: 'Prometheus' },
    },
    '/api/datasources/uid/prometheus': datasource,
    '/api/datasources': [datasource],
    '/api/health': { version: '11.5.0', commit: 'abc123', database: 'ok' },
    '/api/search?': [
      { id: 1, uid: 'folder-uid', title: 'GT7', type: 'dash-folder', url: '/dashboards/f/folder-uid/gt7', tags: [] },
      { id: 2, uid: 'pitwall', title: 'GT7 Pit Wall v2', type: 'dash-db', folderUid: 'folder-uid', folderTitle: 'GT7', url: '/d/pitwall/gt7-pit-wall-v2', tags: ['gt7', 'pit-wall'] },
    ],
    '/api/dashboards/uid/pitwall': {
      meta: { folderUid: 'folder-uid', folderTitle: 'GT7', url: '/d/pitwall/gt7-pit-wall-v2', canEdit: false, canSave: false },
      dashboard: {
        uid: 'pitwall',
        title: 'GT7 Pit Wall v2',
        tags: ['gt7', 'pit-wall'],
        timezone: 'browser',
        refresh: '1s',
        time: { from: 'now-15m', to: 'now' },
        schemaVersion: 39,
        version: 6,
        templating: { list: [{ name: 'car', type: 'query', query: 'label_values(gt7_session_info, car_name)' }] },
        panels: [
          {
            id: 5,
            title: 'FUEL %',
            type: 'stat',
            datasource: { type: 'prometheus', uid: 'prometheus' },
            targets: [{ refId: 'A', expr: 'gt7_fuel_pct', legendFormat: 'Fuel' }],
            fieldConfig: { defaults: { unit: 'percent', thresholds: { steps: [{ color: 'green' }, { color: 'red', value: 15 }] } } },
          },
        ],
      },
    },
    '/api/folders': [{ id: 1, uid: 'folder-uid', title: 'GT7', url: '/dashboards/f/folder-uid/gt7' }],
    '/api/v1/provisioning/alert-rules': [
      {
        uid: 'rule-1',
        title: 'Data stale',
        folderUID: 'folder-uid',
        ruleGroup: 'gt7',
        condition: 'A',
        noDataState: 'NoData',
        execErrState: 'Error',
        labels: { severity: 'warning' },
        annotations: { summary: 'GT7 data is stale' },
        data: [{ refId: 'A', datasourceUid: 'prometheus', model: { refId: 'A', expr: 'gt7_data_age_seconds > 5' } }],
      },
    ],
    '/api/alertmanager/grafana/api/v2/alerts': [
      {
        fingerprint: 'abc123',
        status: { state: 'active', silencedBy: [], inhibitedBy: [] },
        labels: { alertname: 'DataStale', severity: 'warning' },
        annotations: { summary: 'GT7 data is stale' },
        startsAt: '2026-05-20T12:00:00Z',
      },
    ],
    '/api/alertmanager/grafana/config/api/v1/receivers': [
      {
        name: 'grafana-default-email',
        active: true,
        integrations: [{ name: 'email', sendResolved: true, lastNotifyAttempt: '0001-01-01T00:00:00Z', lastNotifyAttemptDuration: '0s' }],
      },
    ],
    '/api/ds/query': {
      results: {
        A: {
          status: 200,
          frames: [{
            schema: { refId: 'A', fields: [{ name: 'Time', type: 'time' }, { name: 'up', type: 'number' }] },
            data: { values: [[1_700_000_000_000], [1]] },
          }],
        },
      },
    },
  };
}

describe('grafana tools', () => {
  const originalEnv = process.env;
  let calls: FetchCall[];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GRAFANA_URL = 'http://grafana:3000/';
    process.env.GRAFANA_AUTH_TOKEN = 'grafana-token';
    process.env.GRAFANA_ORG_ID = '2';
    calls = [];
    vi.stubGlobal('fetch', mockFetch(grafanaResponses(), calls));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('registers 10 Grafana tools when URL is configured', async () => {
    const { client } = await createTestClient(['grafana']);
    const result = await client.listTools();
    const names = result.tools.map(tool => tool.name);

    expect(result.tools.length).toBe(10);
    expect(names).toContain('grafana_health');
    expect(names).toContain('grafana_datasources');
    expect(names).toContain('grafana_datasource_health');
    expect(names).toContain('grafana_datasource_query');
    expect(names).toContain('grafana_dashboards_search');
    expect(names).toContain('grafana_dashboard_get');
    expect(names).toContain('grafana_folders');
    expect(names).toContain('grafana_alert_rules');
    expect(names).toContain('grafana_alerts');
    expect(names).toContain('grafana_contact_points');
  });

  it('registers 0 Grafana tools when URL is empty', async () => {
    delete process.env.GRAFANA_URL;
    const { client } = await createTestClient(['grafana']);
    await expect(client.listTools()).rejects.toThrow();
  });

  it('returns health and data source details', async () => {
    const { client } = await createTestClient(['grafana']);

    const healthResult = await client.callTool({ name: 'grafana_health', arguments: {} });
    const health = JSON.parse((healthResult.content as any)[0].text);
    expect(health.version).toBe('11.5.0');
    expect(health.database).toBe('ok');
    expect(health.orgId).toBe('2');

    const datasourcesResult = await client.callTool({ name: 'grafana_datasources', arguments: {} });
    const datasources = JSON.parse((datasourcesResult.content as any)[0].text);
    expect(datasources.count).toBe(1);
    expect(datasources.datasources[0].uid).toBe('prometheus');
    expect(datasources.datasources[0].secureJsonFields).toEqual(['httpHeaderValue1']);

    const datasourceHealthResult = await client.callTool({
      name: 'grafana_datasource_health',
      arguments: { uid: 'prometheus' },
    });
    const datasourceHealth = JSON.parse((datasourceHealthResult.content as any)[0].text);
    expect(datasourceHealth.health.status).toBe('OK');
    expect(datasourceHealth.datasource.type).toBe('prometheus');
  });

  it('summarizes dashboard search and dashboard panel queries', async () => {
    const { client } = await createTestClient(['grafana']);

    const searchResult = await client.callTool({
      name: 'grafana_dashboards_search',
      arguments: { query: 'GT7', tag: ['pit-wall'] },
    });
    const search = JSON.parse((searchResult.content as any)[0].text);
    expect(search.count).toBe(2);
    expect(search.results[1].uid).toBe('pitwall');

    const dashboardResult = await client.callTool({
      name: 'grafana_dashboard_get',
      arguments: { uid: 'pitwall' },
    });
    const dashboard = JSON.parse((dashboardResult.content as any)[0].text);
    expect(dashboard.dashboard.title).toBe('GT7 Pit Wall v2');
    expect(dashboard.dashboard.panelCount).toBe(1);
    expect(dashboard.dashboard.panels[0].targets[0].expr).toBe('gt7_fuel_pct');
  });

  it('runs data source queries through POST and summarizes data frames', async () => {
    const { client } = await createTestClient(['grafana']);

    const result = await client.callTool({
      name: 'grafana_datasource_query',
      arguments: { datasource_uid: 'prometheus', query: 'up', max_data_points: 100 },
    });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.results[0].refId).toBe('A');
    expect(content.results[0].frames[0].fields[1].name).toBe('up');
    expect(content.results[0].frames[0].sampleRows[0].up).toBe(1);

    const queryCall = calls.find(call => call.url.endsWith('/api/ds/query'));
    expect(queryCall?.init.method).toBe('POST');
    expect(queryCall?.init.headers.Authorization).toBe('Bearer grafana-token');
    expect(queryCall?.init.headers['X-Grafana-Org-Id']).toBe('2');
    expect(queryCall?.init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(queryCall?.init.body);
    expect(body.queries[0].expr).toBe('up');
    expect(body.queries[0].datasource.uid).toBe('prometheus');
  });

  it('summarizes folders, alert rules, active alerts, and contact points', async () => {
    const { client } = await createTestClient(['grafana']);

    const foldersResult = await client.callTool({ name: 'grafana_folders', arguments: {} });
    const folders = JSON.parse((foldersResult.content as any)[0].text);
    expect(folders.folders[0].title).toBe('GT7');

    const rulesResult = await client.callTool({
      name: 'grafana_alert_rules',
      arguments: { datasource_uid: 'prometheus' },
    });
    const rules = JSON.parse((rulesResult.content as any)[0].text);
    expect(rules.count).toBe(1);
    expect(rules.rules[0].data[0].model.expr).toBe('gt7_data_age_seconds > 5');

    const alertsResult = await client.callTool({ name: 'grafana_alerts', arguments: {} });
    const alerts = JSON.parse((alertsResult.content as any)[0].text);
    expect(alerts.alerts[0].fingerprint).toBe('abc123');

    const contactPointsResult = await client.callTool({ name: 'grafana_contact_points', arguments: {} });
    const contactPoints = JSON.parse((contactPointsResult.content as any)[0].text);
    expect(contactPoints.contactPoints[0].name).toBe('grafana-default-email');
    expect(contactPoints.contactPoints[0].integrations[0].name).toBe('email');
  });
});