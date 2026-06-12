#!/usr/bin/env node
/**
 * Generate the MCP tool-contract manifest from the server's public listTools()
 * output.
 *
 * This freezes the consumer-visible contract surface: tool names, descriptions,
 * input JSON Schemas, execution metadata, and listing order under deterministic
 * environment profiles. The output is intentionally transport-agnostic and has
 * no timestamps so CI can use it as a drift guard.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/server.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const docsDir = path.join(repoRoot, 'docs');

type EnvPatch = Record<string, string | undefined>;

export interface ToolContractProfile {
  name: string;
  description: string;
  environment: Record<string, string>;
  tools: unknown[];
}

export interface ToolContractManifest {
  schemaVersion: 1;
  source: 'mcp/listTools';
  profiles: ToolContractProfile[];
}

const BACKEND_URL_ENV: Record<string, string> = {
  APP_API_URL: 'http://localhost-test/app-api',
  JAEGER_URL: 'http://localhost-test/jaeger',
  TRACES_JAEGER_URL: 'http://localhost-test/traces-jaeger',
  TEMPO_URL: 'http://localhost-test/tempo',
  TRACES_TEMPO_URL: 'http://localhost-test/traces-tempo',
  ZIPKIN_URL: 'http://localhost-test/zipkin',
  TRACES_ZIPKIN_URL: 'http://localhost-test/traces-zipkin',
  SKYWALKING_URL: 'http://localhost-test/skywalking',
  TRACES_SKYWALKING_URL: 'http://localhost-test/traces-skywalking',
  PROMETHEUS_URL: 'http://localhost-test/prometheus',
  LOKI_URL: 'http://localhost-test/loki',
  ELASTICSEARCH_URL: 'http://localhost-test/elasticsearch',
  ALERTMANAGER_URL: 'http://localhost-test/alertmanager',
  GRAFANA_URL: 'http://localhost-test/grafana',
  CILIUM_URL: 'http://localhost-test/cilium',
  KUBERNETES_URL: 'http://localhost-test/kubernetes',
  CLICKHOUSE_URL: 'http://localhost-test/clickhouse',
  PYROSCOPE_URL: 'http://localhost-test/pyroscope',
  OPA_URL: 'http://localhost-test/opa',
  ENVOY_ADMIN_URL: 'http://localhost-test/envoy',
  CONSUL_URL: 'http://localhost-test/consul',
  KONG_ADMIN_URL: 'http://localhost-test/kong',
  TRAEFIK_URL: 'http://localhost-test/traefik',
  INFLUX_URL: 'http://localhost-test/influx',
  OPENTSDB_URL: 'http://localhost-test/opentsdb',
  GRAYLOG_URL: 'http://localhost-test/graylog',
  PINPOINT_URL: 'http://localhost-test/pinpoint',
  FLUENTBIT_URL: 'http://localhost-test/fluentbit',
  BEATS_URL: 'http://localhost-test/beats',
  VECTOR_URL: 'http://localhost-test/vector',
  ALLOY_URL: 'http://localhost-test/alloy',
  AGENTRELAY_URL: 'http://localhost-test/agentrelay',
  VMALERT_URL: 'http://localhost-test/vmalert',
};

const PROFILE_CONTROL_ENV = [
  'GRAFANA_DEFAULT_FROM',
  'GRAFANA_MAX_ITEMS',
  'GRAFANA_ORG_ID',
  'INFLUX_VERSION',
  'LOKI_TENANT_ID',
  'MCP_BACKENDS',
  'MCP_ENABLE_WRITES',
  'PROMETHEUS_PATH_PREFIX',
  'TRACES_PROVIDER',
];

const PROFILES: Array<{ name: string; description: string; env: EnvPatch }> = [
  {
    name: 'default',
    description: 'Default startup contract with optional backend URLs and write tools disabled.',
    env: {},
  },
  {
    name: 'all-configured-read',
    description: 'All backend skills configured with write tools disabled.',
    env: BACKEND_URL_ENV,
  },
  {
    name: 'all-configured-write',
    description: 'All backend skills configured with opt-in write tools enabled.',
    env: { ...BACKEND_URL_ENV, MCP_ENABLE_WRITES: 'true' },
  },
];

function relevantEnvKeys(): string[] {
  const explicit = new Set([
    ...Object.keys(BACKEND_URL_ENV),
    ...PROFILE_CONTROL_ENV,
  ]);
  for (const key of Object.keys(process.env)) {
    if (
      key === 'MCP_BACKENDS' ||
      key === 'MCP_ENABLE_WRITES' ||
      /_URL(__.+)?$/.test(key) ||
      /_(DEFAULT_FROM|MAX_ITEMS|ORG_ID|PATH_PREFIX|PRODUCT|TENANT_ID|VERSION)$/.test(key)
    ) {
      explicit.add(key);
    }
  }
  return [...explicit].sort();
}

async function withProfileEnv<T>(patch: EnvPatch, fn: () => Promise<T>): Promise<T> {
  const keys = relevantEnvKeys();
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortObject((value as Record<string, unknown>)[key]);
  }
  return out;
}

async function listToolsForProfile(env: EnvPatch): Promise<unknown[]> {
  return withProfileEnv(env, async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'tool-contract-generator', version: '1.0.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.listTools();
      return result.tools.map((tool) => sortObject(tool));
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });
}

export async function buildToolContractManifest(): Promise<ToolContractManifest> {
  const profiles: ToolContractProfile[] = [];
  for (const profile of PROFILES) {
    profiles.push({
      name: profile.name,
      description: profile.description,
      environment: Object.fromEntries(
        Object.entries(profile.env)
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      tools: await listToolsForProfile(profile.env),
    });
  }

  return {
    schemaVersion: 1,
    source: 'mcp/listTools',
    profiles,
  };
}

async function main(): Promise<void> {
  const manifest = await buildToolContractManifest();
  await mkdir(docsDir, { recursive: true });
  await writeFile(
    path.join(docsDir, 'tool-contracts.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(
    `Wrote docs/tool-contracts.json ` +
      `(${manifest.profiles.map((p) => `${p.name}: ${p.tools.length}`).join(', ')} tools).\n`,
  );
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`gen-tool-contracts failed: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
