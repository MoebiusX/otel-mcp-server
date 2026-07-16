#!/usr/bin/env node
/**
 * Compare MCP tool-contract manifests and classify the semver impact.
 *
 * Defaults to comparing the committed manifest at `HEAD` against the working
 * tree manifest. For release/PR checks, pass `--base-ref origin/develop` after
 * fetching. Use `--allowed-bump patch|minor|major` to make CI fail when the
 * recommended bump exceeds an expected release type.
 */

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  bumpExceeds,
  diffToolContracts,
  type ContractDiffReport,
  type SemverBump,
  type ToolContractManifest,
} from '../src/contract-diff.js';
import { buildToolContractManifest } from './gen-tool-contracts.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_MANIFEST = 'docs/tool-contracts.json';

interface CliOptions {
  base?: string;
  current?: string;
  baseRef?: string;
  currentGenerated: boolean;
  format: 'text' | 'json';
  max?: SemverBump;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    currentGenerated: false,
    format: 'text',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case '--base':
        opts.base = next();
        break;
      case '--current':
        opts.current = next();
        break;
      case '--base-ref':
        opts.baseRef = next();
        break;
      case '--current-generated':
        opts.currentGenerated = true;
        break;
      case '--format':
        opts.format = parseFormat(next());
        break;
      case '--max':
      case '--max-bump':
      case '--allowed-bump':
        opts.max = parseBump(next());
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (isBump(arg) && !opts.max) {
          opts.max = arg;
          break;
        }
        if (isFormat(arg) && opts.format === 'text') {
          opts.format = arg;
          break;
        }
        if (!opts.base && !opts.baseRef && looksLikeGitRef(arg)) {
          opts.baseRef = arg;
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.base && opts.baseRef) {
    throw new Error('Use only one of --base or --base-ref.');
  }
  if (opts.current && opts.currentGenerated) {
    throw new Error('Use only one of --current or --current-generated.');
  }

  return opts;
}

async function manifestFromFile(file: string): Promise<ToolContractManifest> {
  const raw = await readFile(path.resolve(repoRoot, file), 'utf8');
  return JSON.parse(raw) as ToolContractManifest;
}

function manifestFromGit(ref: string, file = DEFAULT_MANIFEST): ToolContractManifest {
  const result = spawnSync('git', ['show', `${ref}:${file}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to read ${file} from ${ref}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return JSON.parse(result.stdout) as ToolContractManifest;
}

async function loadBase(opts: CliOptions): Promise<ToolContractManifest> {
  if (opts.base) return manifestFromFile(opts.base);
  return manifestFromGit(opts.baseRef ?? 'HEAD');
}

async function loadCurrent(opts: CliOptions): Promise<ToolContractManifest> {
  if (opts.currentGenerated) return buildToolContractManifest();
  return manifestFromFile(opts.current ?? DEFAULT_MANIFEST);
}

function renderText(report: ContractDiffReport): string {
  const lines: string[] = [];
  lines.push(`Recommended contract semver bump: ${report.recommendedBump}`);
  if (report.changes.length === 0) {
    lines.push('No MCP tool contract changes detected.');
    return lines.join('\n');
  }

  const counts = report.changes.reduce<Record<string, number>>((acc, item) => {
    acc[item.bump] = (acc[item.bump] ?? 0) + 1;
    return acc;
  }, {});
  lines.push(
    `Changes: ${report.changes.length}` +
      ` (major: ${counts.major ?? 0}, minor: ${counts.minor ?? 0}, patch: ${counts.patch ?? 0})`,
  );
  lines.push('');

  for (const item of report.changes) {
    lines.push(`- [${item.bump}] ${item.kind} ${item.path}: ${item.message}`);
  }
  return lines.join('\n');
}

function parseFormat(value: string): CliOptions['format'] {
  if (isFormat(value)) return value;
  throw new Error(`Invalid --format "${value}". Use text or json.`);
}

function parseBump(value: string): SemverBump {
  if (isBump(value)) return value;
  throw new Error(`Invalid semver bump "${value}". Use none, patch, minor, or major.`);
}

function isFormat(value: string): value is CliOptions['format'] {
  return value === 'text' || value === 'json';
}

function isBump(value: string): value is SemverBump {
  return value === 'none' || value === 'patch' || value === 'minor' || value === 'major';
}

function looksLikeGitRef(value: string): boolean {
  return /^[A-Za-z0-9._/@-]+$/.test(value);
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run check:contracts -- [base-ref] [allowed-bump] [options]

Options:
  --base <file>             Base manifest file (default: HEAD:docs/tool-contracts.json)
  --base-ref <git-ref>      Base Git ref containing docs/tool-contracts.json
  --current <file>          Current manifest file (default: docs/tool-contracts.json)
  --current-generated       Compare against freshly generated current contracts
  --allowed-bump <bump>     Fail if recommended bump exceeds none|patch|minor|major
  --format <text|json>      Output format (default: text)
  -h, --help                Show this help

Notes:
  With npm, prefer a positional allowed bump:
    npm run check:contracts -- minor
  Compare against a fetched base ref:
    npm run check:contracts -- origin/develop minor
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const report = diffToolContracts(await loadBase(opts), await loadCurrent(opts));
  process.stdout.write(
    opts.format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderText(report)}\n`,
  );

  if (opts.max && bumpExceeds(report.recommendedBump, opts.max)) {
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`check-contract-semver failed: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
