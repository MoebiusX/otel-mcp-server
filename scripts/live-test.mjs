#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const composeFile = path.join(repoRoot, 'docker-compose.live.yml');
const matrixFile = path.join(repoRoot, 'tests', 'live-test-matrix.json');
const resultsDir = path.join(repoRoot, '.live-test-results');

const defaultProject = 'otel-mcp-live';
const defaultImage = 'otel-mcp-server:live-test';
const apiKey = 'otel-mcp-live-test-key';
const authKeys = JSON.stringify({ keys: [{ id: 'live-test', key: apiKey, description: 'Local live-test harness' }] });

function parseArgs(argv) {
  const options = {
    profile: 'standard',
    skills: [],
    keepFixtures: false,
    keepContainersOnFail: false,
    noBuild: false,
    fixtureMode: 'isolated',
    project: defaultProject,
    image: defaultImage,
    timeoutMs: 180000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile') options.profile = argv[++i] || options.profile;
    else if (arg === '--skill') options.skills.push(...(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean));
    else if (arg === '--keep-fixtures') options.keepFixtures = true;
    else if (arg === '--keep-containers-on-fail') options.keepContainersOnFail = true;
    else if (arg === '--no-build') options.noBuild = true;
    else if (arg === '--fixture-mode') options.fixtureMode = argv[++i] || options.fixtureMode;
    else if (arg === '--project') options.project = argv[++i] || options.project;
    else if (arg === '--image') options.image = argv[++i] || options.image;
    else if (arg === '--timeout') options.timeoutMs = parseDuration(argv[++i] || '180s');
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseDuration(value) {
  const match = String(value).match(/^(\d+)(ms|s|m)?$/);
  if (!match) return 180000;
  const amount = Number(match[1]);
  const unit = match[2] || 'ms';
  if (unit === 'm') return amount * 60_000;
  if (unit === 's') return amount * 1000;
  return amount;
}

function printHelp() {
  console.log(`
Live-test each otel-mcp-server skill against local Docker fixtures.

Usage:
  npm run test:live -- [options]

Options:
  --profile <name>              Fixture profile to run (default: standard)
  --skill <id[,id...]>          Run one or more skills instead of the whole matrix
  --keep-fixtures               Leave docker compose fixtures running after the run
  --keep-containers-on-fail     Leave failed MCP skill containers for inspection
  --no-build                    Reuse existing dist/ and Docker image
  --fixture-mode <mode>         isolated, sequential, or all (default: isolated)
  --timeout <duration>          Default wait timeout, e.g. 180s, 3m, 90000ms
  --project <name>              Docker Compose project name (default: ${defaultProject})
  --image <tag>                 Docker image tag (default: ${defaultImage})
`);
}

function commandName(command) {
  if (process.platform === 'win32' && command === 'npm') return 'npm.cmd';
  return command;
}

function run(command, args, options = {}) {
  const { allowFailure = false, quiet = false, env = process.env } = options;
  return new Promise((resolve, reject) => {
    if (!quiet) console.log(`$ ${command} ${args.join(' ')}`);
    const executable = commandName(command);
    const useShell = process.platform === 'win32' && executable.endsWith('.cmd');
    const child = spawn(commandName(command), args, {
      cwd: repoRoot,
      env,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (!quiet) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', code => {
      const result = { code, stdout, stderr };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}\n${stderr || stdout}`));
    });
  });
}

function docker(args, options) {
  return run('docker', args, options);
}

function composeArgs(options, args) {
  return ['compose', '-f', composeFile, '-p', options.project, ...args];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForUrl(check, defaultTimeoutMs) {
  const timeoutMs = check.timeoutMs || defaultTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(check.url, 3000);
      if (response.ok) return { ok: true };
      lastError = `HTTP ${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1000);
  }

  if (check.optional) {
    console.warn(`Optional fixture ${check.id} did not become ready: ${lastError}`);
    return { ok: false, optional: true, error: lastError };
  }

  throw new Error(`Fixture ${check.id} was not ready at ${check.url}: ${lastError}`);
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url, 3000);
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function loadMatrix() {
  return JSON.parse(await readFile(matrixFile, 'utf8'));
}

async function loadSkills() {
  const modulePath = pathToFileURL(path.join(repoRoot, 'dist', 'skills.js')).href;
  return (await import(modulePath)).allSkills;
}

async function buildIfNeeded(options) {
  if (options.noBuild) return;
  await run('npm', ['run', 'build']);
  await docker(['build', '-t', options.image, '.']);
}

function composeProfileArgs(profile) {
  return profile.composeProfiles.flatMap(name => ['--profile', name]);
}

function serviceNameForCheck(check) {
  return check.service || check.id;
}

function fixtureChecksForSkill(config, profile) {
  const checksByService = new Map((profile.readiness || []).map(check => [serviceNameForCheck(check), check]));
  return (config.fixtures || []).map(service => {
    const check = checksByService.get(service);
    if (!check) throw new Error(`No readiness check is configured for fixture service ${service}`);
    return check;
  });
}

async function startFixtureChecks(options, profile, checks) {
  const profileArgs = composeProfileArgs(profile);
  for (const check of checks) {
    const service = serviceNameForCheck(check);
    console.log(`Fixture ${service}: pull`);
    await docker(composeArgs(options, [...profileArgs, 'pull', '--quiet', service]));
    console.log(`Fixture ${service}: start`);
    await docker(composeArgs(options, [...profileArgs, 'up', '-d', '--no-deps', service]));
    process.stdout.write(`Waiting for ${check.id}... `);
    await waitForUrl(check, options.timeoutMs);
    process.stdout.write('ready\n');
  }
}

async function stopFixtureChecks(options, profile, checks) {
  if (options.keepFixtures) return;
  const profileArgs = composeProfileArgs(profile);
  for (const check of [...checks].reverse()) {
    const service = serviceNameForCheck(check);
    console.log(`Fixture ${service}: stop`);
    await docker(composeArgs(options, [...profileArgs, 'stop', service]), { allowFailure: true, quiet: true });
    console.log(`Fixture ${service}: remove`);
    await docker(composeArgs(options, [...profileArgs, 'rm', '-f', '-v', service]), { allowFailure: true, quiet: true });
  }
}

async function startFixtures(options, profile) {
  console.log(`Starting live-test fixtures for profile "${options.profile}"...`);
  const profileArgs = composeProfileArgs(profile);

  if (options.fixtureMode === 'all') {
    await docker(composeArgs(options, [...profileArgs, 'up', '-d', '--remove-orphans']));
  } else if (options.fixtureMode === 'sequential') {
    await startFixtureChecks(options, profile, profile.readiness || []);
    return;
  } else {
    throw new Error(`Unknown fixture mode: ${options.fixtureMode}`);
  }

  for (const check of profile.readiness || []) {
    process.stdout.write(`Waiting for ${check.id}... `);
    await waitForUrl(check, options.timeoutMs);
    process.stdout.write('ready\n');
  }
}

async function stopFixtures(options) {
  if (options.keepFixtures) {
    console.log('Leaving live-test fixtures running because --keep-fixtures was set.');
    return;
  }
  await docker(composeArgs(options, ['down', '-v', '--remove-orphans']), { allowFailure: true });
}

async function removeContainer(name) {
  await docker(['rm', '-f', name], { allowFailure: true, quiet: true });
}

async function getContainerPort(name) {
  const result = await docker([
    'inspect',
    '-f',
    '{{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}',
    name,
  ], { quiet: true });
  return result.stdout.trim();
}

async function containerLogs(name) {
  const result = await docker(['logs', '--tail', '120', name], { allowFailure: true, quiet: true });
  return `${result.stdout}${result.stderr}`.trim();
}

function sanitizeContainerName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

async function callSmokeTool(baseUrl, smoke) {
  const client = new Client({ name: 'otel-mcp-live-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });

  await client.connect(transport);
  try {
    const toolsResult = await client.listTools();
    const started = performance.now();
    const toolResult = await client.callTool({ name: smoke.tool, arguments: smoke.args || {} });
    const durationMs = Math.round(performance.now() - started);
    const contentText = (toolResult.content || [])
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
    const isError = Boolean(toolResult.isError) || contentText.startsWith('Error:');
    let parsed = null;
    try {
      parsed = contentText ? JSON.parse(contentText) : null;
    } catch {
      parsed = contentText;
    }
    return { tools: toolsResult.tools, durationMs, isError, text: contentText, parsed };
  } finally {
    await client.close();
  }
}

function summarizeResult(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 300);
  if (Array.isArray(value)) return { type: 'array', count: value.length };
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 8)) {
    if (Array.isArray(item)) out[key] = { type: 'array', count: item.length };
    else if (item && typeof item === 'object') out[key] = { type: 'object', keys: Object.keys(item).slice(0, 8) };
    else out[key] = item;
  }
  return out;
}

function compact(value, maxLength = 180) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const oneLine = (text || 'null').replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 3)}...` : oneLine;
}

function formatSmoke(result) {
  if (!result.smoke) return '';
  const sent = compact(result.smoke.args || {}, 100);
  const response = compact(result.smoke.response ?? result.smoke.summary ?? null, 220);
  return `tested=${result.id}/${result.smoke.tool} sent=${sent} response=${response}`;
}

function formatResultLine(result) {
  const marker = result.status === 'passed' ? 'PASS' : result.status === 'failed' ? 'FAIL' : 'SKIP';
  const prefix = `${marker.padEnd(4)} ${result.id.padEnd(16)}`;

  if (result.status === 'passed') {
    const toolCounts = result.expectedToolCount == null ? '' : ` tools=${result.toolCount}/${result.expectedToolCount}`;
    return `${prefix} ${formatSmoke(result)} duration=${result.smoke.durationMs}ms${toolCounts}`;
  }

  if (result.status === 'failed') {
    const smoke = formatSmoke(result);
    const detail = smoke ? `${smoke} error=${compact(result.error || 'failed', 220)}` : `error=${compact(result.error || 'failed', 260)}`;
    return `${prefix} ${detail}`;
  }

  return `${prefix} skipped=${compact(result.reason || 'No live-test fixture configured', 260)}`;
}

async function testSkill({ id, declared, config, profile, options }) {
  const started = performance.now();
  const containerName = sanitizeContainerName(`${options.project}-mcp-${id}`);
  let smoke = null;

  if (!config || !config.profiles?.includes(options.profile)) {
    return {
      id,
      name: declared?.name || id,
      status: 'skipped',
      reason: config?.skipReason || `No live-test fixture for profile ${options.profile}`,
      durationMs: 0,
    };
  }

  await removeContainer(containerName);
  const env = {
    ...profile.env,
    MCP_AUTH_KEYS: authKeys,
    MCP_TIMEOUT_MS: '10000',
  };

  const dockerRunArgs = [
    'run',
    '-d',
    '--name', containerName,
    '--network', profile.network,
    '--publish', '127.0.0.1::3001',
  ];
  for (const [key, value] of Object.entries(env)) dockerRunArgs.push('--env', `${key}=${value}`);
  dockerRunArgs.push(options.image, '--http', '3001', '--tools', id);

  try {
    await docker(dockerRunArgs, { quiet: true });
    const port = await getContainerPort(containerName);
    if (!port) throw new Error(`Docker did not publish port 3001 for ${containerName}`);

    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForJson(`${baseUrl}/health`, options.timeoutMs);
    if (health.auth !== 'enabled') throw new Error('MCP HTTP auth was not enabled');

    const healthSkill = (health.skills || []).find(skill => skill.id === id);
    if (!healthSkill) throw new Error(`Skill ${id} was not listed in /health`);
    if (!healthSkill.available) throw new Error(`Skill ${id} was listed but not available`);

    smoke = await callSmokeTool(baseUrl, config.smoke);
    const toolNames = smoke.tools.map(tool => tool.name);
    if (!toolNames.includes(config.smoke.tool)) throw new Error(`Smoke tool ${config.smoke.tool} was not registered`);
    if (declared && smoke.tools.length !== declared.tools) {
      throw new Error(`Expected ${declared.tools} tools, got ${smoke.tools.length}: ${toolNames.join(', ')}`);
    }
    if (smoke.isError) throw new Error(`Smoke tool returned an error: ${smoke.text}`);

    const metricsResponse = await fetchWithTimeout(`${baseUrl}/metrics`, 3000);
    const metricsText = await metricsResponse.text();
    if (!metricsResponse.ok) throw new Error(`Metrics endpoint returned HTTP ${metricsResponse.status}`);
    if (!metricsText.includes('mcp_auth_attempts_total')) throw new Error('Metrics endpoint did not include auth attempts');
    if (config.metricsContains && !metricsText.includes(config.metricsContains)) {
      throw new Error(`Metrics endpoint did not include ${config.metricsContains}`);
    }

    await removeContainer(containerName);
    return {
      id,
      name: declared?.name || id,
      status: 'passed',
      toolCount: smoke.tools.length,
      expectedToolCount: declared?.tools ?? null,
      smoke: {
        tool: config.smoke.tool,
        args: config.smoke.args || {},
        durationMs: smoke.durationMs,
        response: summarizeResult(smoke.parsed),
        summary: summarizeResult(smoke.parsed),
      },
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const logs = await containerLogs(containerName);
    if (!options.keepContainersOnFail) await removeContainer(containerName);
    return {
      id,
      name: declared?.name || id,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      smoke: config?.smoke ? {
        tool: config.smoke.tool,
        args: config.smoke.args || {},
        durationMs: smoke?.durationMs ?? null,
        response: smoke ? summarizeResult(smoke.parsed) : null,
        summary: smoke ? summarizeResult(smoke.parsed) : null,
      } : undefined,
      logs,
      durationMs: Math.round(performance.now() - started),
    };
  }
}

function printSummary(results) {
  const counts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  console.log('\nLive-test summary');
  console.log(`  Passed:  ${counts.passed || 0}`);
  console.log(`  Failed:  ${counts.failed || 0}`);
  console.log(`  Skipped: ${counts.skipped || 0}`);
  console.log('');

  for (const result of results) console.log(formatResultLine(result));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const matrix = await loadMatrix();
  const profile = matrix.profiles[options.profile];
  if (!profile) throw new Error(`Unknown live-test profile: ${options.profile}`);

  await buildIfNeeded(options);
  const allSkills = await loadSkills();
  const skillById = new Map(allSkills.map(skill => [skill.id, skill]));

  for (const requested of options.skills) {
    if (!skillById.has(requested)) throw new Error(`Unknown skill: ${requested}`);
  }

  const selectedIds = options.skills.length ? options.skills : allSkills.map(skill => skill.id);
  const started = new Date();
  const results = [];
  const sharedFixtures = options.fixtureMode !== 'isolated';

  let fixturesStarted = false;
  try {
    if (sharedFixtures) {
      fixturesStarted = true;
      await startFixtures(options, profile);
    }

    for (const id of selectedIds) {
      console.log(`\nTesting ${id}...`);
      const config = matrix.skills[id];
      let fixtureChecks = [];
      let result;
      try {
        fixtureChecks =
          options.fixtureMode === 'isolated' && config?.profiles?.includes(options.profile)
            ? fixtureChecksForSkill(config, profile)
            : [];
        if (fixtureChecks.length > 0) await startFixtureChecks(options, profile, fixtureChecks);
        result = await testSkill({
          id,
          declared: skillById.get(id),
          config,
          profile,
          options,
        });
      } catch (error) {
        result = {
          id,
          name: skillById.get(id)?.name || id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          durationMs: 0,
        };
      } finally {
        if (options.fixtureMode === 'isolated' && fixtureChecks.length > 0) {
          await stopFixtureChecks(options, profile, fixtureChecks);
        }
      }

      if (fixtureChecks.length > 0) result.fixtures = fixtureChecks.map(serviceNameForCheck);
      results.push(result);
      console.log(formatResultLine(result));
    }
  } finally {
    if (fixturesStarted || options.fixtureMode === 'isolated') await stopFixtures(options);
  }

  const report = {
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    profile: options.profile,
    fixtureMode: options.fixtureMode,
    image: options.image,
    selectedSkills: selectedIds,
    results,
  };

  await mkdir(resultsDir, { recursive: true });
  const reportPath = path.join(resultsDir, `live-test-${started.toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await pruneOldReports(resultsDir, 20);

  printSummary(results);
  console.log(`\nReport: ${path.relative(repoRoot, reportPath)}`);

  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function pruneOldReports(dir, keep) {
  try {
    const entries = await readdir(dir);
    const reports = entries.filter(name => /^live-test-.*\.json$/.test(name)).sort();
    const excess = reports.length - keep;
    if (excess <= 0) return;
    await Promise.all(
      reports.slice(0, excess).map(name => unlink(path.join(dir, name)).catch(() => {})),
    );
  } catch {
    // Best-effort retention; ignore errors so a report-write success isn't masked.
  }
}