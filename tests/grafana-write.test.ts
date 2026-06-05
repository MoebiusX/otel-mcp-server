import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

interface Call {
  method: string;
  url: string;
  init?: any;
}

interface Route {
  method?: string;
  match: string;
  status?: number;
  json?: any;
}

/** Method- and URL-aware fetch mock. First matching route wins; unmatched → 404. */
function routedFetch(routes: Route[], calls: Call[]) {
  return vi.fn(async (url: string | URL | Request, init?: any) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    const urlStr = typeof url === 'string' ? url : url.toString();
    calls.push({ method, url: urlStr, init });
    for (const r of routes) {
      if ((!r.method || r.method === method) && urlStr.includes(r.match)) {
        const status = r.status ?? 200;
        return { ok: status < 400, status, statusText: `status-${status}`, json: async () => r.json ?? {} };
      }
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  });
}

async function createTestClient() {
  const server = createServer({ tools: ['grafana'] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function parse(result: any) {
  return JSON.parse((result.content as any)[0].text);
}

const EXISTING_DASH = {
  dashboard: { uid: 'pitwall', title: 'GT7 Pit Wall', version: 6 },
  meta: { folderUid: 'gt7' },
};

describe('grafana write tools — gating', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GRAFANA_URL = 'http://grafana:3000/';
    process.env.GRAFANA_AUTH_TOKEN = 'grafana-token';
    delete process.env.MCP_ENABLE_WRITES;
    vi.stubGlobal('fetch', routedFetch([], []));
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('does not register write tools when MCP_ENABLE_WRITES is unset', async () => {
    const { client } = await createTestClient();
    const names = (await client.listTools()).tools.map(t => t.name);
    expect(names).toHaveLength(10);
    expect(names).not.toContain('grafana_create_dashboard');
    expect(names).not.toContain('grafana_delete_dashboard');
    expect(names).not.toContain('grafana_create_folder');
  });

  it('registers the 3 write tools when MCP_ENABLE_WRITES=true', async () => {
    process.env.MCP_ENABLE_WRITES = 'true';
    const { client } = await createTestClient();
    const names = (await client.listTools()).tools.map(t => t.name);
    expect(names).toHaveLength(13);
    expect(names).toContain('grafana_create_dashboard');
    expect(names).toContain('grafana_delete_dashboard');
    expect(names).toContain('grafana_create_folder');
  });
});

describe('grafana_create_dashboard', () => {
  const originalEnv = process.env;
  let calls: Call[];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GRAFANA_URL = 'http://grafana:3000/';
    process.env.GRAFANA_AUTH_TOKEN = 'grafana-token';
    process.env.GRAFANA_ORG_ID = '2';
    process.env.MCP_ENABLE_WRITES = '1';
    calls = [];
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('create mode inserts a new dashboard (overwrite=false) after a pre-check', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'POST', match: '/api/dashboards/db', json: { status: 'success', uid: 'new-dash', id: 9, version: 1, url: '/d/new-dash' } },
      // GET /api/dashboards/uid/new-dash → falls through to 404 (does not exist)
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({
      name: 'grafana_create_dashboard',
      arguments: { dashboard: { uid: 'new-dash', title: 'New Dash' } },
    });
    const out = parse(res);
    expect(out.uid).toBe('new-dash');
    expect(out.status).toBe('success');
    expect(out.mode).toBe('create');

    const precheck = calls.find(c => c.method === 'GET' && c.url.includes('/api/dashboards/uid/new-dash'));
    expect(precheck).toBeTruthy();
    const post = calls.find(c => c.method === 'POST' && c.url.includes('/api/dashboards/db'));
    expect(post).toBeTruthy();
    const body = JSON.parse(post!.init.body);
    expect(body.overwrite).toBe(false);
    expect(body.dashboard.id).toBeUndefined();
    expect(post!.init.headers.Authorization).toBe('Bearer grafana-token');
    expect(post!.init.headers['X-Grafana-Org-Id']).toBe('2');
  });

  it('create mode returns a conflict (with version) when the UID already exists', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'GET', match: '/api/dashboards/uid/pitwall', json: EXISTING_DASH },
      { method: 'POST', match: '/api/dashboards/db', json: { status: 'success' } },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({
      name: 'grafana_create_dashboard',
      arguments: { dashboard: { uid: 'pitwall', title: 'GT7 Pit Wall' } },
    });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(/conflict/i);
    expect((res.content as any)[0].text).toMatch(/version 6/);
    expect(calls.some(c => c.method === 'POST' && c.url.includes('/api/dashboards/db'))).toBe(false);
  });

  it('upsert mode overwrites without a pre-check (overwrite=true)', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'POST', match: '/api/dashboards/db', json: { status: 'success', uid: 'pitwall', version: 7 } },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({
      name: 'grafana_create_dashboard',
      arguments: { dashboard: { uid: 'pitwall', title: 'GT7 Pit Wall' }, mode: 'upsert', message: 'reconcile' },
    });
    const out = parse(res);
    expect(out.version).toBe(7);
    expect(calls.some(c => c.method === 'GET' && c.url.includes('/api/dashboards/uid/'))).toBe(false);
    const post = calls.find(c => c.method === 'POST');
    const body = JSON.parse(post!.init.body);
    expect(body.overwrite).toBe(true);
    expect(body.message).toBe('reconcile');
  });

  it('update mode fails when the dashboard does not exist', async () => {
    vi.stubGlobal('fetch', routedFetch([], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({
      name: 'grafana_create_dashboard',
      arguments: { dashboard: { uid: 'ghost', title: 'Ghost' }, mode: 'update' },
    });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(/does not exist/i);
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('dry_run validates without writing', async () => {
    vi.stubGlobal('fetch', routedFetch([], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({
      name: 'grafana_create_dashboard',
      arguments: { dashboard: { uid: 'new-dash', title: 'New Dash' }, dry_run: true },
    });
    const out = parse(res);
    expect(out.dryRun).toBe(true);
    expect(out.wouldApply.title).toBe('New Dash');
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('rejects a dashboard without a title', async () => {
    vi.stubGlobal('fetch', routedFetch([], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({
      name: 'grafana_create_dashboard',
      arguments: { dashboard: { uid: 'x' } },
    });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(/title is required/i);
  });
});

describe('grafana_delete_dashboard', () => {
  const originalEnv = process.env;
  let calls: Call[];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GRAFANA_URL = 'http://grafana:3000/';
    process.env.GRAFANA_AUTH_TOKEN = 'grafana-token';
    process.env.MCP_ENABLE_WRITES = 'yes';
    calls = [];
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('deletes an existing dashboard', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'GET', match: '/api/dashboards/uid/pitwall', json: EXISTING_DASH },
      { method: 'DELETE', match: '/api/dashboards/uid/pitwall', json: { title: 'GT7 Pit Wall', message: 'Dashboard deleted' } },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({ name: 'grafana_delete_dashboard', arguments: { uid: 'pitwall' } });
    const out = parse(res);
    expect(out.deleted).toBe(true);
    expect(out.uid).toBe('pitwall');
    expect(calls.some(c => c.method === 'DELETE')).toBe(true);
  });

  it('errors when the dashboard is not found', async () => {
    vi.stubGlobal('fetch', routedFetch([], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({ name: 'grafana_delete_dashboard', arguments: { uid: 'ghost' } });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(/not found/i);
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  it('dry_run reports the target without deleting', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'GET', match: '/api/dashboards/uid/pitwall', json: EXISTING_DASH },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({ name: 'grafana_delete_dashboard', arguments: { uid: 'pitwall', dry_run: true } });
    const out = parse(res);
    expect(out.dryRun).toBe(true);
    expect(out.wouldDelete.uid).toBe('pitwall');
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  });
});

describe('grafana_create_folder', () => {
  const originalEnv = process.env;
  let calls: Call[];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GRAFANA_URL = 'http://grafana:3000/';
    process.env.GRAFANA_AUTH_TOKEN = 'grafana-token';
    process.env.MCP_ENABLE_WRITES = 'on';
    calls = [];
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('create mode inserts a new folder', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'POST', match: '/api/folders', json: { uid: 'team-a', title: 'Team A', version: 1, url: '/dashboards/f/team-a' } },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({ name: 'grafana_create_folder', arguments: { uid: 'team-a', title: 'Team A' } });
    const out = parse(res);
    expect(out.created).toBe(true);
    expect(out.uid).toBe('team-a');
    const post = calls.find(c => c.method === 'POST');
    expect(JSON.parse(post!.init.body)).toEqual({ uid: 'team-a', title: 'Team A' });
  });

  it('create mode conflicts when the folder UID already exists', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'GET', match: '/api/folders/team-a', json: { uid: 'team-a', title: 'Team A', version: 3 } },
      { method: 'POST', match: '/api/folders', json: { uid: 'team-a' } },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({ name: 'grafana_create_folder', arguments: { uid: 'team-a', title: 'Team A' } });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toMatch(/conflict/i);
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });

  it('upsert mode updates an existing folder via PUT', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'GET', match: '/api/folders/team-a', json: { uid: 'team-a', title: 'Old', version: 3 } },
      { method: 'PUT', match: '/api/folders/team-a', json: { uid: 'team-a', title: 'Team A', version: 4 } },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({ name: 'grafana_create_folder', arguments: { uid: 'team-a', title: 'Team A', mode: 'upsert' } });
    const out = parse(res);
    expect(out.updated).toBe(true);
    expect(out.version).toBe(4);
    const put = calls.find(c => c.method === 'PUT');
    expect(JSON.parse(put!.init.body)).toEqual({ title: 'Team A', overwrite: true });
  });

  it('upsert mode creates the folder when the UID is absent', async () => {
    vi.stubGlobal('fetch', routedFetch([
      { method: 'POST', match: '/api/folders', json: { uid: 'team-b', title: 'Team B', version: 1 } },
    ], calls));
    const { client } = await createTestClient();

    const res = await client.callTool({ name: 'grafana_create_folder', arguments: { uid: 'team-b', title: 'Team B', mode: 'upsert' } });
    const out = parse(res);
    expect(out.created).toBe(true);
    expect(calls.some(c => c.method === 'PUT')).toBe(false);
    expect(calls.some(c => c.method === 'POST')).toBe(true);
  });
});
