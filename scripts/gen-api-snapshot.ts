#!/usr/bin/env node
/**
 * Generate a snapshot of the TypeScript declaration files that are published
 * through the npm package's `dist` directory.
 *
 * Until package `exports` are tightened, downstream consumers can deep-import
 * any declaration emitted under dist. This snapshot makes that broad current
 * surface visible and reviewable without changing runtime behavior.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'dist');
const docsDir = path.join(repoRoot, 'docs');

export interface ApiDeclarationEntry {
  path: string;
  content: string;
}

export interface ApiSnapshotManifest {
  schemaVersion: 1;
  source: 'dist/**/*.d.ts';
  package: {
    name: string;
    main?: string;
    types?: string;
    files?: string[];
  };
  declarations: ApiDeclarationEntry[];
}

async function walkDeclarationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkDeclarationFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function normalizeDeclaration(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trimEnd() + '\n';
}

async function packageMetadata(): Promise<ApiSnapshotManifest['package']> {
  const raw = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  return {
    name: pkg.name,
    main: pkg.main,
    types: pkg.types,
    files: Array.isArray(pkg.files) ? [...pkg.files] : undefined,
  };
}

export async function buildApiSnapshotManifest(): Promise<ApiSnapshotManifest> {
  const declarationFiles = await walkDeclarationFiles(distDir);
  const declarations: ApiDeclarationEntry[] = [];

  for (const file of declarationFiles) {
    declarations.push({
      path: path.relative(repoRoot, file).replace(/\\/g, '/'),
      content: normalizeDeclaration(await readFile(file, 'utf8')),
    });
  }

  return {
    schemaVersion: 1,
    source: 'dist/**/*.d.ts',
    package: await packageMetadata(),
    declarations,
  };
}

async function main(): Promise<void> {
  const manifest = await buildApiSnapshotManifest();
  await mkdir(docsDir, { recursive: true });
  await writeFile(
    path.join(docsDir, 'api-snapshot.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(
    `Wrote docs/api-snapshot.json (${manifest.declarations.length} declarations).\n`,
  );
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`gen-api-snapshot failed: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
