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
  const server = createServer({ tools: ['agentrelay'] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client };
}

function parse(result: any) {
  return JSON.parse((result.content as any)[0].text);
}

const AGENTS = [
  { id: 'a1', name: 'reviewer', handle: 'reviewer', status: 'active', type: 'agent' },
  { id: 'a2', name: 'engineer', handle: 'engineer', status: 'idle', type: 'agent' },
];

describe('agentrelay skill — gating', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AGENTRELAY_URL = 'https://relay.example.com';
    process.env.AGENTRELAY_AUTH_TOKEN = 'relay-token';
    delete process.env.MCP_ENABLE_WRITES;
    vi.stubGlobal('fetch', routedFetch([], []));
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('registers only the read tool when MCP_ENABLE_WRITES is unset', async () => {
    const { client } = await createTestClient();
    const names = (await client.listTools()).tools.map(t => t.name);
    expect(names).toEqual(['agentrelay_agents']);
    expect(names).not.toContain('agentrelay_send');
  });

  it('registers the send tool when MCP_ENABLE_WRITES=true', async () => {
    process.env.MCP_ENABLE_WRITES = 'true';
    const { client } = await createTestClient();
    const names = (await client.listTools()).tools.map(t => t.name);
    expect(names).toHaveLength(2);
    expect(names).toContain('agentrelay_agents');
    expect(names).toContain('agentrelay_send');
  });
});

describe('agentrelay_agents', () => {
  const originalEnv = process.env;
  let calls: Call[];
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AGENTRELAY_URL = 'https://relay.example.com';
    process.env.AGENTRELAY_AUTH_TOKEN = 'relay-token';
    delete process.env.MCP_ENABLE_WRITES;
    calls = [];
    vi.stubGlobal('fetch', routedFetch([{ method: 'GET', match: '/v1/agents', json: AGENTS }], calls));
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('lists connected agents and injects the bearer token', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'agentrelay_agents', arguments: {} });
    const body = parse(result);
    expect(body.count).toBe(2);
    expect(body.agents[0].handle).toBe('reviewer');
    expect(calls[0].url).toBe('https://relay.example.com/v1/agents');
    expect(calls[0].init.headers.Authorization).toBe('Bearer relay-token');
  });

  it('accepts a wrapped { agents: [...] } response shape', async () => {
    vi.stubGlobal('fetch', routedFetch([{ method: 'GET', match: '/v1/agents', json: { agents: AGENTS } }], calls));
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'agentrelay_agents', arguments: {} });
    expect(parse(result).count).toBe(2);
  });

  it('returns an error result when the API responds non-2xx', async () => {
    vi.stubGlobal('fetch', routedFetch([{ method: 'GET', match: '/v1/agents', status: 401, json: { error: 'unauthorized' } }], calls));
    const { client } = await createTestClient();
    const result: any = await client.callTool({ name: 'agentrelay_agents', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

describe('agentrelay_send', () => {
  const originalEnv = process.env;
  let calls: Call[];
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AGENTRELAY_URL = 'https://relay.example.com';
    process.env.AGENTRELAY_AUTH_TOKEN = 'relay-token';
    process.env.MCP_ENABLE_WRITES = 'true';
    calls = [];
    vi.stubGlobal('fetch', routedFetch([{ method: 'POST', match: '/v1/relay/send', json: { messageId: 'msg_1' } }], calls));
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('POSTs a message wrapping text into the payload', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'agentrelay_send', arguments: { to: 'reviewer', text: 'please review' } });
    const body = parse(result);
    expect(body.sent).toBe(true);
    expect(body.response.messageId).toBe('msg_1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://relay.example.com/v1/relay/send');
    expect(JSON.parse(calls[0].init.body)).toEqual({ to: 'reviewer', type: 'message', payload: { message: 'please review' } });
  });

  it('sends a structured payload override as-is', async () => {
    const { client } = await createTestClient();
    await client.callTool({ name: 'agentrelay_send', arguments: { to: 'engineer', type: 'task', payload: { action: 'deploy', ref: 'main' } } });
    expect(JSON.parse(calls[0].init.body)).toEqual({ to: 'engineer', type: 'task', payload: { action: 'deploy', ref: 'main' } });
  });

  it('dry_run reports the planned request without calling fetch', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({ name: 'agentrelay_send', arguments: { to: 'reviewer', text: 'hi', dry_run: true } });
    const body = parse(result);
    expect(body.dryRun).toBe(true);
    expect(body.request.method).toBe('POST');
    expect(calls).toHaveLength(0);
  });

  it('errors when neither text nor payload is provided', async () => {
    const { client } = await createTestClient();
    const result: any = await client.callTool({ name: 'agentrelay_send', arguments: { to: 'reviewer' } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
