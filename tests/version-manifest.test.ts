import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_VERSIONS } from '../src/skill-versions.js';
import { PROTOCOLS, PROTOCOL_IDS } from '../src/protocols.js';

/**
 * Drift guard for the generated supported-versions manifest.
 *
 * Rebuilds the JSON manifest in-memory using the same logic as
 * scripts/gen-version-manifest.ts and asserts it matches the committed
 * docs/supported-versions.json. If this fails, run `npm run gen:versions`
 * and commit the result.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function buildExpected() {
  const byProtocol = new Map<string, any[]>();
  for (const skillId of Object.keys(SKILL_VERSIONS).sort()) {
    const support = SKILL_VERSIONS[skillId];
    for (const backendName of Object.keys(support)) {
      const entry = support[backendName];
      const list = byProtocol.get(entry.protocol) ?? [];
      list.push({
        skill: skillId,
        backend: backendName,
        productVersions: entry.productVersions,
        featuresSince: { ...(entry.protocolFeaturesSince ?? {}) },
      });
      byProtocol.set(entry.protocol, list);
    }
  }

  const protocols: any[] = [];
  for (const id of PROTOCOL_IDS) {
    const backends = byProtocol.get(id);
    if (!backends || backends.length === 0) continue;
    const adapter = PROTOCOLS[id];
    protocols.push({
      id,
      name: adapter.name,
      queryLanguage: adapter.queryLanguage,
      products: [...adapter.products],
      specUrl: adapter.specUrl,
      baselineFeatures: [...adapter.baselineFeatures],
      versionedFeatures: adapter.versionedFeatures,
      backends: backends.sort((a, b) => a.backend.localeCompare(b.backend)),
    });
  }
  return { protocols };
}

describe('supported-versions manifest', () => {
  it('committed JSON matches the catalog (run `npm run gen:versions` if this fails)', async () => {
    const committedRaw = await readFile(
      path.join(repoRoot, 'docs', 'supported-versions.json'),
      'utf8',
    );
    const committed = JSON.parse(committedRaw);
    const expected = JSON.parse(JSON.stringify(buildExpected()));
    expect(committed).toEqual(expected);
  });
});
