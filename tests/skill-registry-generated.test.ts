import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSkillRegistrySource } from '../scripts/gen-skill-registry.js';

/**
 * Drift guard for the generated skill import registry.
 *
 * If this fails after adding/removing a tool module, run `npm run gen:skills`
 * and commit the regenerated `src/skills.generated.ts`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('generated skill registry', () => {
  it('matches src/tools/*.ts skill exports', async () => {
    const committed = await readFile(
      path.join(repoRoot, 'src', 'skills.generated.ts'),
      'utf8',
    );
    const generated = await buildSkillRegistrySource();
    expect(committed).toBe(generated);
  });
});
