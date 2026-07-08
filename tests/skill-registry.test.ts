import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { allSkills } from '../src/skills.js';
import { createSkillHelpers } from '../src/skill.js';
import { PROTOCOLS, isProtocolId } from '../src/protocols.js';
import { parseVersion } from '../src/versions.js';

/**
 * Registry integrity — guards against the drift that creeps in as the skill
 * count grows: hand-maintained `tools` counts, duplicate ids, and colliding
 * tool names across skills.
 *
 * `register` is side-effect-free apart from declaring tools (it only builds
 * URLs/fetchers), so we can drive it with a stub server that records calls.
 * Some skills (elasticsearch/alertmanager/grafana) only register their tools
 * when their backend URL is configured, so we set every backend URL first to
 * exercise the full tool set.
 */

const BACKEND_URLS = [
  'JAEGER_URL', 'PROMETHEUS_URL', 'LOKI_URL', 'APP_API_URL', 'ELASTICSEARCH_URL',
  'ALERTMANAGER_URL', 'GRAFANA_URL', 'CILIUM_URL', 'BEYLA_PROMETHEUS_URL', 'KUBERNETES_URL', 'CLICKHOUSE_URL',
  'PYROSCOPE_URL', 'OPA_URL', 'ENVOY_ADMIN_URL', 'CONSUL_URL',
  'KONG_ADMIN_URL', 'TRAEFIK_URL', 'INFLUX_URL', 'OPENTSDB_URL', 'GRAYLOG_URL',
  'PINPOINT_URL', 'FLUENTBIT_URL', 'BEATS_URL',
  'VECTOR_URL', 'ALLOY_URL', 'AGENTRELAY_URL', 'VMALERT_URL',
];

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of BACKEND_URLS) {
    savedEnv[k] = process.env[k];
    process.env[k] = `http://localhost-test/${k}`;
  }
});

afterAll(() => {
  for (const k of BACKEND_URLS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function registeredToolNames(skill: (typeof allSkills)[number]): string[] {
  const names: string[] = [];
  const stubServer: any = {
    tool: (name: string) => names.push(name),
    resource: () => {},
  };
  skill.register(stubServer, createSkillHelpers());
  return names;
}

describe('skill registry integrity', () => {
  it('every skill declares its actual tool count', () => {
    const mismatches = allSkills
      .map((s) => ({ id: s.id, declared: s.tools, actual: registeredToolNames(s).length }))
      .filter((r) => r.declared !== r.actual);
    expect(mismatches).toEqual([]);
  });

  it('skill ids are unique', () => {
    const ids = allSkills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tool names are globally unique across skills', () => {
    const all = allSkills.flatMap((s) => registeredToolNames(s));
    const dupes = all.filter((n, i) => all.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('every skill has non-empty id, name, description, and backends', () => {
    for (const s of allSkills) {
      expect(s.id, `${s.id} id`).toBeTruthy();
      expect(s.name, `${s.id} name`).toBeTruthy();
      expect(s.description, `${s.id} description`).toBeTruthy();
      expect(s.backends.length, `${s.id} backends`).toBeGreaterThan(0);
    }
  });
});

describe('skill version-support metadata', () => {
  const versioned = allSkills.filter((s) => s.versions);

  it('every skill declares version support', () => {
    const missing = allSkills.filter((s) => !s.versions).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('each backend entry references a known protocol and non-empty must tier', () => {
    for (const s of versioned) {
      for (const [backendName, entry] of Object.entries(s.versions!)) {
        const where = `${s.id}/${backendName}`;
        expect(isProtocolId(entry.protocol), `${where} protocol`).toBe(true);
        expect(entry.productVersions.must.length, `${where} must`).toBeGreaterThan(0);
      }
    }
  });

  it('all declared product version tokens are non-empty strings', () => {
    for (const s of versioned) {
      for (const [backendName, entry] of Object.entries(s.versions!)) {
        const tiers = [
          ...entry.productVersions.must,
          ...(entry.productVersions.should ?? []),
          ...(entry.productVersions.optional ?? []),
        ];
        for (const t of tiers) {
          expect(typeof t, `${s.id}/${backendName} token`).toBe('string');
          expect(t.trim().length, `${s.id}/${backendName} token`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('protocolFeaturesSince keys are valid protocol features with parseable since-versions', () => {
    for (const s of versioned) {
      for (const [backendName, entry] of Object.entries(s.versions!)) {
        const since = entry.protocolFeaturesSince ?? {};
        const valid = Object.keys(PROTOCOLS[entry.protocol].versionedFeatures);
        for (const [feature, ver] of Object.entries(since)) {
          const where = `${s.id}/${backendName}/${feature}`;
          expect(valid, `${where} known feature`).toContain(feature);
          expect(parseVersion(ver as string), `${where} since`).not.toBeNull();
        }
      }
    }
  });
});

