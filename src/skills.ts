/**
 * Skill registry — imports all skills and exports them as an ordered array.
 *
 * To add a new telemetry source:
 *  1. Create a skill file in src/tools/ (see skill.ts for the interface)
 *  2. Import it below and add to the allSkills array
 */

import { skill as traces } from './tools/traces.js';
import { skill as metrics } from './tools/metrics.js';
import { skill as logs } from './tools/logs.js';
import { skill as elasticsearch } from './tools/elasticsearch.js';
import { skill as alertmanager } from './tools/alertmanager.js';
import { skill as grafana } from './tools/grafana.js';
import { skill as cilium } from './tools/cilium.js';
import { skill as kubernetes } from './tools/kubernetes.js';
import { skill as clickhouse } from './tools/clickhouse.js';
import { skill as pyroscope } from './tools/pyroscope.js';
import { skill as opa } from './tools/opa.js';
import { skill as envoy } from './tools/envoy.js';
import { skill as consul } from './tools/consul.js';
import { skill as kong } from './tools/kong.js';
import { skill as traefik } from './tools/traefik.js';
import { skill as influx } from './tools/influxdb.js';
import { skill as opentsdb } from './tools/opentsdb.js';
import { skill as graylog } from './tools/graylog.js';
import { skill as pinpoint } from './tools/pinpoint.js';
import { skill as pipeline } from './tools/pipeline.js';
import { skill as zkProofs } from './tools/zk-proofs.js';
import { skill as system } from './tools/system.js';
import type { Skill } from './skill.js';
import { SKILL_VERSIONS } from './skill-versions.js';

export const allSkills: Skill[] = [
  traces,
  metrics,
  logs,
  elasticsearch,
  alertmanager,
  grafana,
  cilium,
  kubernetes,
  clickhouse,
  pyroscope,
  opa,
  envoy,
  consul,
  kong,
  traefik,
  influx,
  opentsdb,
  graylog,
  pinpoint,
  pipeline,
  zkProofs,
  system,
];

// Attach centralized version-support metadata to each skill (single source of
// truth in skill-versions.ts; skills opt in by having a matching id key).
for (const skill of allSkills) {
  const versions = SKILL_VERSIONS[skill.id];
  if (versions) skill.versions = versions;
}
