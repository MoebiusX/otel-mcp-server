import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildToolContractManifest } from '../scripts/gen-tool-contracts.js';

/**
 * Drift guard for MCP tool contracts.
 *
 * The committed manifest is generated from the server's actual listTools()
 * response under deterministic environment profiles. If this fails, review the
 * diff as a consumer-visible contract change, then run `npm run gen:contracts`
 * when the change is intentional.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readCommittedManifest(): Promise<any> {
  const raw = await readFile(path.join(repoRoot, 'docs', 'tool-contracts.json'), 'utf8');
  return JSON.parse(raw);
}

function profile(manifest: any, name: string): any {
  return manifest.profiles.find((p: any) => p.name === name);
}

describe('MCP tool contract manifest', () => {
  it('committed JSON matches the current listTools contract (run `npm run gen:contracts` if intentional)', async () => {
    const committed = await readCommittedManifest();
    const generated = await buildToolContractManifest();
    expect(committed).toEqual(generated);
  });

  it('has no duplicate tool names within any profile', async () => {
    const manifest = await readCommittedManifest();
    for (const p of manifest.profiles) {
      const names = p.tools.map((tool: any) => tool.name);
      expect(new Set(names).size, `${p.name} duplicate tool names`).toBe(names.length);
    }
  });

  it('keeps write tools opt-in', async () => {
    const manifest = await readCommittedManifest();
    const readOnlyNames = new Set(profile(manifest, 'all-configured-read').tools.map((t: any) => t.name));
    const writeNames = new Set(profile(manifest, 'all-configured-write').tools.map((t: any) => t.name));

    expect(readOnlyNames.has('grafana_create_dashboard')).toBe(false);
    expect(readOnlyNames.has('agentrelay_send')).toBe(false);
    expect(writeNames.has('grafana_create_dashboard')).toBe(true);
    expect(writeNames.has('agentrelay_send')).toBe(true);
  });
});
