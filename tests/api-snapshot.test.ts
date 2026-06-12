import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApiSnapshotManifest } from '../scripts/gen-api-snapshot.js';

/**
 * Drift guard for npm-facing TypeScript declarations.
 *
 * This intentionally snapshots every declaration emitted into `dist`, because
 * the current package shape publishes the whole dist directory. If this fails,
 * run `npm run build` first; when the declaration change is intentional, run
 * `npm run gen:api-snapshot` and review the diff as an API-surface change.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readCommittedManifest(): Promise<any> {
  const raw = await readFile(path.join(repoRoot, 'docs', 'api-snapshot.json'), 'utf8');
  return JSON.parse(raw);
}

describe('npm API declaration snapshot', () => {
  it('committed JSON matches the current dist declarations (run build + gen:api-snapshot if intentional)', async () => {
    const committed = await readCommittedManifest();
    const generated = await buildApiSnapshotManifest();
    expect(committed).toEqual(generated);
  });

  it('package metadata points TypeScript consumers at a snapshotted root declaration', async () => {
    const manifest = await readCommittedManifest();
    const declarationPaths = new Set(manifest.declarations.map((d: any) => d.path));

    expect(manifest.package.files).toContain('dist');
    expect(manifest.package.types).toBe('dist/index.d.ts');
    expect(declarationPaths.has(manifest.package.types)).toBe(true);
  });

  it('keeps core public extension points visible in the snapshot', async () => {
    const manifest = await readCommittedManifest();
    const declarationPaths = new Set(manifest.declarations.map((d: any) => d.path));

    expect(declarationPaths.has('dist/server.d.ts')).toBe(true);
    expect(declarationPaths.has('dist/skill.d.ts')).toBe(true);
    expect(declarationPaths.has('dist/skills.d.ts')).toBe(true);
  });
});
