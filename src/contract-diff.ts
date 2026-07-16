/**
 * Semver classifier for MCP tool-contract manifests.
 *
 * The manifest is generated from `listTools()`, so differences here are
 * consumer-facing MCP contract changes. This module stays pure so the CLI and
 * unit tests share the exact same classification logic.
 */

export type SemverBump = 'none' | 'patch' | 'minor' | 'major';

export interface ToolContractManifest {
  schemaVersion: number;
  source: string;
  profiles: ToolContractProfile[];
}

export interface ToolContractProfile {
  name: string;
  tools: ToolContract[];
}

export interface ToolContract {
  name: string;
  description?: string;
  inputSchema?: JsonSchemaObject;
  execution?: unknown;
}

export interface JsonSchemaObject {
  type?: unknown;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

export interface JsonSchemaProperty {
  type?: unknown;
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

export interface ContractChange {
  bump: Exclude<SemverBump, 'none'>;
  kind: string;
  path: string;
  message: string;
}

export interface ContractDiffReport {
  recommendedBump: SemverBump;
  changes: ContractChange[];
}

const BUMP_RANK: Record<SemverBump, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

export function maxBump(a: SemverBump, b: SemverBump): SemverBump {
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b;
}

export function bumpExceeds(actual: SemverBump, allowed: SemverBump): boolean {
  return BUMP_RANK[actual] > BUMP_RANK[allowed];
}

export function diffToolContracts(
  before: ToolContractManifest,
  after: ToolContractManifest,
): ContractDiffReport {
  const changes: ContractChange[] = [];
  const beforeProfiles = byName(before.profiles);
  const afterProfiles = byName(after.profiles);

  for (const [profileName, oldProfile] of beforeProfiles) {
    const newProfile = afterProfiles.get(profileName);
    if (!newProfile) {
      changes.push(change(
        'major',
        'profile.removed',
        profilePath(profileName),
        `Removed contract profile "${profileName}".`,
      ));
      continue;
    }
    diffProfile(profileName, oldProfile, newProfile, changes);
  }

  for (const [profileName] of afterProfiles) {
    if (!beforeProfiles.has(profileName)) {
      changes.push(change(
        'minor',
        'profile.added',
        profilePath(profileName),
        `Added contract profile "${profileName}".`,
      ));
    }
  }

  return summarize(changes);
}

function diffProfile(
  profileName: string,
  before: ToolContractProfile,
  after: ToolContractProfile,
  changes: ContractChange[],
): void {
  const beforeTools = byName(before.tools);
  const afterTools = byName(after.tools);

  for (const [toolName, oldTool] of beforeTools) {
    const newTool = afterTools.get(toolName);
    const path = `${profilePath(profileName)}.tools.${toolName}`;
    if (!newTool) {
      changes.push(change('major', 'tool.removed', path, `Removed tool "${toolName}".`));
      continue;
    }
    diffTool(path, oldTool, newTool, changes);
  }

  for (const [toolName] of afterTools) {
    if (!beforeTools.has(toolName)) {
      changes.push(change(
        'minor',
        'tool.added',
        `${profilePath(profileName)}.tools.${toolName}`,
        `Added tool "${toolName}".`,
      ));
    }
  }
}

function diffTool(
  path: string,
  before: ToolContract,
  after: ToolContract,
  changes: ContractChange[],
): void {
  if (before.description !== after.description) {
    changes.push(change(
      'patch',
      'tool.description.changed',
      `${path}.description`,
      'Changed tool description.',
    ));
  }

  if (stableStringify(before.execution) !== stableStringify(after.execution)) {
    changes.push(change(
      'patch',
      'tool.execution.changed',
      `${path}.execution`,
      'Changed tool execution metadata.',
    ));
  }

  diffInputSchema(path, before.inputSchema ?? {}, after.inputSchema ?? {}, changes);
}

function diffInputSchema(
  path: string,
  before: JsonSchemaObject,
  after: JsonSchemaObject,
  changes: ContractChange[],
): void {
  const beforeProps = before.properties ?? {};
  const afterProps = after.properties ?? {};
  const beforeRequired = new Set(before.required ?? []);
  const afterRequired = new Set(after.required ?? []);

  for (const [argName, oldProp] of Object.entries(beforeProps)) {
    const newProp = afterProps[argName];
    const argPath = `${path}.inputSchema.properties.${argName}`;
    if (!newProp) {
      changes.push(change('major', 'arg.removed', argPath, `Removed argument "${argName}".`));
      continue;
    }

    if (!sameContractValue(oldProp.type, newProp.type)) {
      changes.push(change(
        'major',
        'arg.type.changed',
        `${argPath}.type`,
        `Changed type for argument "${argName}".`,
      ));
    }

    diffEnum(argPath, argName, oldProp.enum, newProp.enum, changes);

    if (!sameContractValue(oldProp.default, newProp.default)) {
      changes.push(change(
        'major',
        'arg.default.changed',
        `${argPath}.default`,
        `Changed default for argument "${argName}".`,
      ));
    }

    const wasRequired = beforeRequired.has(argName);
    const isRequired = afterRequired.has(argName);
    if (wasRequired && !isRequired) {
      changes.push(change(
        'minor',
        'arg.required.removed',
        `${argPath}.required`,
        `Made argument "${argName}" optional.`,
      ));
    } else if (!wasRequired && isRequired) {
      changes.push(change(
        'major',
        'arg.required.added',
        `${argPath}.required`,
        `Made argument "${argName}" required.`,
      ));
    }
  }

  for (const [argName] of Object.entries(afterProps)) {
    if (!Object.prototype.hasOwnProperty.call(beforeProps, argName)) {
      const bump = afterRequired.has(argName) ? 'major' : 'minor';
      changes.push(change(
        bump,
        bump === 'major' ? 'arg.added.required' : 'arg.added.optional',
        `${path}.inputSchema.properties.${argName}`,
        `Added ${bump === 'major' ? 'required' : 'optional'} argument "${argName}".`,
      ));
    }
  }
}

function diffEnum(
  argPath: string,
  argName: string,
  before: unknown[] | undefined,
  after: unknown[] | undefined,
  changes: ContractChange[],
): void {
  if (!before && !after) return;
  if (!before && after) {
    changes.push(change(
      'major',
      'arg.enum.added',
      `${argPath}.enum`,
      `Added enum restriction for argument "${argName}".`,
    ));
    return;
  }
  if (before && !after) {
    changes.push(change(
      'minor',
      'arg.enum.removed',
      `${argPath}.enum`,
      `Removed enum restriction for argument "${argName}".`,
    ));
    return;
  }

  const oldValues = new Set((before ?? []).map(stableStringify));
  const newValues = new Set((after ?? []).map(stableStringify));
  const removed = [...oldValues].filter((value) => !newValues.has(value));
  const added = [...newValues].filter((value) => !oldValues.has(value));

  if (removed.length > 0) {
    changes.push(change(
      'major',
      'arg.enum.narrowed',
      `${argPath}.enum`,
      `Removed enum value(s) from argument "${argName}".`,
    ));
  }
  if (added.length > 0) {
    changes.push(change(
      'minor',
      'arg.enum.widened',
      `${argPath}.enum`,
      `Added enum value(s) to argument "${argName}".`,
    ));
  }
}

function byName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

function profilePath(profileName: string): string {
  return `profiles.${profileName}`;
}

function change(
  bump: Exclude<SemverBump, 'none'>,
  kind: string,
  path: string,
  message: string,
): ContractChange {
  return { bump, kind, path, message };
}

function summarize(changes: ContractChange[]): ContractDiffReport {
  return {
    recommendedBump: changes.reduce<SemverBump>(
      (acc, item) => maxBump(acc, item.bump),
      'none',
    ),
    changes: changes.sort((a, b) =>
      BUMP_RANK[b.bump] - BUMP_RANK[a.bump] ||
      a.path.localeCompare(b.path) ||
      a.kind.localeCompare(b.kind),
    ),
  };
}

function sameContractValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}
