import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function manifest(extraProperties: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    source: 'mcp/listTools',
    profiles: [{
      name: 'default',
      tools: [{
        name: 'metrics_query',
        description: 'Execute query.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            ...extraProperties,
          },
          required: ['query'],
        },
      }],
    }],
  };
}

async function writeManifest(name: string, value: unknown): Promise<string> {
  const dir = path.join(tmpdir(), `otel-contract-semver-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

describe('check-contract-semver CLI', () => {
  it('prints JSON and exits zero when max allows the recommended bump', async () => {
    const base = await writeManifest('base', manifest());
    const current = await writeManifest('current', manifest({ time: { type: 'string' } }));

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/check-contract-semver.ts', '--base', base, '--current', current, '--allowed-bump', 'minor', '--format', 'json'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).recommendedBump).toBe('minor');
  });

  it('exits non-zero when max is exceeded', async () => {
    const base = await writeManifest('base', manifest());
    const current = await writeManifest('current', manifest({
      target: { type: 'string' },
    }));
    const parsed = JSON.parse(await readFile(current, 'utf8'));
    parsed.profiles[0].tools[0].inputSchema.required.push('target');
    await writeFile(current, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/check-contract-semver.ts', '--base', base, '--current', current, '--allowed-bump', 'minor'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Recommended contract semver bump: major');
  });

  it('accepts a positional allowed bump for npm-run compatibility', async () => {
    const base = await writeManifest('base', manifest());
    const current = await writeManifest('current', manifest({ time: { type: 'string' } }));

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/check-contract-semver.ts', '--base', base, '--current', current, 'minor'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Recommended contract semver bump: minor');
  });
});
