import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * The kubernetes skill talks to the kube-apiserver over node:http(s), not the
 * shared fetch-based fetcher, so we mock `node:http` with an EventEmitter-based
 * fake request. Responses are keyed by URL substring (most specific first).
 */
const h = vi.hoisted(() => ({ responses: {} as Record<string, any> }));

vi.mock('node:http', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { EventEmitter } = await import('node:events');
  const request = (url: any, _opts: any, cb: any) => {
    const urlStr = url.toString();
    let body = '{}';
    let status = 404;
    for (const [pattern, data] of Object.entries(h.responses)) {
      if (urlStr.includes(pattern)) {
        body = typeof data === 'string' ? data : JSON.stringify(data);
        status = 200;
        break;
      }
    }
    const req: any = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => {
      process.nextTick(() => {
        const res: any = new EventEmitter();
        res.statusCode = status;
        cb(res);
        process.nextTick(() => {
          res.emit('data', Buffer.from(body));
          res.emit('end');
        });
      });
    };
    return req;
  };
  return { ...actual, request, default: { ...actual, request } };
});

import { createServer } from '../src/server.js';

async function createTestClient(tools: string[]) {
  const server = createServer({ tools });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(st);
  await client.connect(ct);
  return { client, server };
}

const parse = (r: any) => JSON.parse(r.content[0].text);

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.KUBERNETES_URL = 'http://k8s-test:8080'; // http → node:http path
  h.responses = {};
});
afterEach(() => { process.env = originalEnv; });

describe('kubernetes', () => {
  it('registers 5 tools when KUBERNETES_URL is set', async () => {
    const { client } = await createTestClient(['kubernetes']);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual(['k8s_api_resources', 'k8s_events', 'k8s_get', 'k8s_health', 'k8s_list']);
  });

  it('k8s_health returns version and readiness', async () => {
    h.responses = { '/version': { gitVersion: 'v1.29.0', platform: 'linux/amd64' }, '/readyz': 'ok' };
    const { client } = await createTestClient(['kubernetes']);
    const out = parse(await client.callTool({ name: 'k8s_health', arguments: {} }));
    expect(out.ready).toBe('ok');
    expect(out.version).toMatchObject({ gitVersion: 'v1.29.0', platform: 'linux/amd64' });
  });

  it('k8s_api_resources lists API groups', async () => {
    h.responses = { '/apis': { groups: [{ name: 'argoproj.io', preferredVersion: { version: 'v1alpha1' }, versions: [{ version: 'v1alpha1' }] }] } };
    const { client } = await createTestClient(['kubernetes']);
    const out = parse(await client.callTool({ name: 'k8s_api_resources', arguments: {} }));
    expect(out.groups[0]).toMatchObject({ name: 'argoproj.io', preferredVersion: 'v1alpha1' });
  });

  it('k8s_list curates CRD status (e.g. Argo Rollouts)', async () => {
    h.responses = {
      '/rollouts': {
        kind: 'RolloutList',
        items: [{
          kind: 'Rollout',
          metadata: { name: 'web', namespace: 'prod', labels: { app: 'web' }, managedFields: [{ huge: true }] },
          status: { phase: 'Healthy', replicas: 3, conditions: [{ type: 'Available', status: 'True', reason: 'AvailableReason' }] },
          spec: { strategy: {} },
        }],
      },
    };
    const { client } = await createTestClient(['kubernetes']);
    const out = parse(await client.callTool({
      name: 'k8s_list',
      arguments: { group: 'argoproj.io', version: 'v1alpha1', plural: 'rollouts', namespace: 'prod' },
    }));
    expect(out.count).toBe(1);
    expect(out.items[0]).toMatchObject({ name: 'web', namespace: 'prod', kind: 'Rollout', phase: 'Healthy' });
    expect(out.items[0].conditions[0]).toMatchObject({ type: 'Available', status: 'True' });
    expect(out.items[0].status).toMatchObject({ replicas: 3 }); // conditions pulled out, rest retained
    expect(out.items[0].spec).toBeUndefined(); // include_spec defaults false
  });

  it('k8s_get includes spec by default', async () => {
    h.responses = { '/rollouts/web': { kind: 'Rollout', metadata: { name: 'web', namespace: 'prod' }, status: { phase: 'Healthy' }, spec: { replicas: 3 } } };
    const { client } = await createTestClient(['kubernetes']);
    const out = parse(await client.callTool({
      name: 'k8s_get',
      arguments: { group: 'argoproj.io', version: 'v1alpha1', plural: 'rollouts', name: 'web', namespace: 'prod' },
    }));
    expect(out).toMatchObject({ name: 'web', namespace: 'prod', phase: 'Healthy' });
    expect(out.spec).toMatchObject({ replicas: 3 });
  });

  it('k8s_events curates and filters by type', async () => {
    h.responses = {
      '/events': {
        items: [{
          type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container',
          involvedObject: { kind: 'Pod', name: 'p1' }, metadata: { namespace: 'ns' }, count: 3, lastTimestamp: '2026-01-01T00:00:00Z',
        }],
      },
    };
    const { client } = await createTestClient(['kubernetes']);
    const out = parse(await client.callTool({ name: 'k8s_events', arguments: { type: 'Warning' } }));
    expect(out.count).toBe(1);
    expect(out.events[0]).toMatchObject({ type: 'Warning', reason: 'BackOff', object: 'Pod/p1', namespace: 'ns', count: 3 });
  });

  it('returns an error result on a non-2xx response', async () => {
    h.responses = {}; // nothing matches → 404
    const { client } = await createTestClient(['kubernetes']);
    const out = await client.callTool({ name: 'k8s_list', arguments: { plural: 'pods' } });
    expect(out.isError).toBe(true);
  });
});
