import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { allSkills } from '../src/skills.js';
import { createSkillHelpers } from '../src/skill.js';

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
  'ALERTMANAGER_URL', 'GRAFANA_URL', 'CILIUM_URL', 'KUBERNETES_URL', 'CLICKHOUSE_URL',
  'PYROSCOPE_URL', 'OPA_URL', 'ZIPKIN_URL', 'ENVOY_ADMIN_URL', 'CONSUL_URL',
  'KONG_ADMIN_URL', 'TRAEFIK_URL', 'INFLUX_URL', 'OPENTSDB_URL', 'GRAYLOG_URL',
  'TEMPO_URL', 'SKYWALKING_URL', 'PINPOINT_URL', 'FLUENTBIT_URL', 'BEATS_URL',
  'VECTOR_URL', 'ALLOY_URL',
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
