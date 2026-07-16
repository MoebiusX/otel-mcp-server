/**
 * Skill registry wrapper.
 *
 * The import list is generated from `src/tools/*.ts` into
 * `skills.generated.ts`; this file owns the runtime metadata attachment that
 * should not be generated.
 */

import type { Skill } from './skill.js';
import { generatedSkills } from './skills.generated.js';
import { SKILL_VERSIONS } from './skill-versions.js';

export const allSkills: Skill[] = generatedSkills;

// Attach centralized version-support metadata to each skill (single source of
// truth in skill-versions.ts; skills opt in by having a matching id key).
for (const skill of allSkills) {
  const versions = SKILL_VERSIONS[skill.id];
  if (versions) skill.versions = versions;
}
