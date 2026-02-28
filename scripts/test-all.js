#!/usr/bin/env node
/**
 * Super Test Runner - Runs all test suites (unit, integration, E2E)
 * Usage: npm run test:all
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function header(title) {
    const line = '═'.repeat(60);
    console.log('');
    log(line, colors.cyan);
    log(`  ${title}`, colors.bright + colors.cyan);
    log(line, colors.cyan);
    console.log('');
}

function runCommand(command, args, label) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        log(`▶ Running: ${command} ${args.join(' ')}`, colors.dim);

        const proc = spawn(command, args, {
            cwd: rootDir,
            stdio: 'inherit',
            shell: true,
        });

        proc.on('close', (code) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            if (code === 0) {
                log(`✓ ${label} passed (${duration}s)`, colors.green);
            } else {
                log(`✗ ${label} failed with exit code ${code} (${duration}s)`, colors.red);
            }
            resolve({ label, code, duration: parseFloat(duration) });
        });

        proc.on('error', (err) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`✗ ${label} error: ${err.message} (${duration}s)`, colors.red);
            resolve({ label, code: 1, duration: parseFloat(duration), error: err.message });
        });
    });
}

async function main() {
    const startTime = Date.now();
    const results = [];
    const args = process.argv.slice(2);

    // Parse flags
    const skipUnit = args.includes('--skip-unit');
    const skipIntegration = args.includes('--skip-integration');
    const skipE2E = args.includes('--skip-e2e');
    const headed = args.includes('--headed');
    const coverage = args.includes('--coverage');

    header('🧪 SUPER TEST RUNNER');
    log('Running all test suites...', colors.yellow);

    if (skipUnit) log('  • Unit tests: SKIPPED', colors.dim);
    else log('  • Unit tests: vitest', colors.dim);

    if (skipIntegration) log('  • Integration tests: SKIPPED', colors.dim);
    else log('  • Integration tests: vitest (integration)', colors.dim);

    if (skipE2E) log('  • E2E tests: SKIPPED', colors.dim);
    else log(`  • E2E tests: playwright${headed ? ' (headed)' : ''}`, colors.dim);

    // ─────────────────────────────────────────────────────────────
    // 1. E2E CONTEXT PROPAGATION TESTS (Custom OTEL tests)
    // ─────────────────────────────────────────────────────────────
    if (!skipE2E) {
        header('� E2E CONTEXT PROPAGATION TESTS');
        const contextResult = await runCommand('node', ['scripts/e2e-test.js'], 'OTEL Context Propagation');
        results.push(contextResult);
    }

    // ─────────────────────────────────────────────────────────────
    // 2. E2E TESTS (Playwright)
    // ─────────────────────────────────────────────────────────────
    if (!skipE2E) {
        header('🌐 E2E TESTS (Playwright)');
        // Use list reporter to prevent HTML report server from blocking
        const e2eArgs = ['playwright', 'test', '--reporter=list'];
        if (headed) e2eArgs.push('--headed');
        const e2eResult = await runCommand('npx', e2eArgs, 'E2E Tests');
        results.push(e2eResult);
    }

    // ─────────────────────────────────────────────────────────────
    // 3. INTEGRATION TESTS  
    // ─────────────────────────────────────────────────────────────
    if (!skipIntegration) {
        header('🔗 INTEGRATION TESTS');
        // Vitest uses file pattern directly, not --testPathPattern
        const integrationResult = await runCommand(
            'npx',
            ['vitest', 'run', '--reporter=verbose', 'tests/integration'],
            'Integration Tests'
        );
        results.push(integrationResult);
    }

    // ─────────────────────────────────────────────────────────────
    // 4. UNIT TESTS (last - stability flags in package.json)
    // ─────────────────────────────────────────────────────────────
    if (!skipUnit) {
        header('📦 UNIT TESTS');
        // Stability flags (--pool=forks, --no-file-parallelism) are in package.json
        const unitArgs = coverage ? ['run', 'test:coverage'] : ['run', 'test'];
        unitArgs.push('--', '--reporter=verbose');
        const unitResult = await runCommand('npm', unitArgs, 'Unit Tests');
        results.push(unitResult);
    }

    // ─────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────
    header('📊 TEST SUMMARY');

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const passed = results.filter(r => r.code === 0);
    const failed = results.filter(r => r.code !== 0);

    for (const result of results) {
        const icon = result.code === 0 ? '✓' : '✗';
        const color = result.code === 0 ? colors.green : colors.red;
        log(`  ${icon} ${result.label}: ${result.duration}s`, color);
    }

    console.log('');
    log(`Total time: ${totalDuration}s`, colors.dim);
    log(`Passed: ${passed.length}/${results.length}`, passed.length === results.length ? colors.green : colors.yellow);

    if (failed.length > 0) {
        console.log('');
        log('Failed suites:', colors.red);
        for (const f of failed) {
            log(`  • ${f.label}`, colors.red);
        }
    }

    console.log('');
    if (failed.length === 0) {
        log('🎉 All tests passed!', colors.bright + colors.green);
        process.exit(0);
    } else {
        log(`💥 ${failed.length} test suite(s) failed`, colors.bright + colors.red);
        process.exit(1);
    }
}

main().catch((err) => {
    log(`Fatal error: ${err.message}`, colors.red);
    process.exit(1);
});
