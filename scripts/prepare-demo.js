#!/usr/bin/env node
/**
 * Demo Preparation Script
 * 
 * Pre-warms the system for investor demos by:
 * 1. Checking infrastructure health
 * 2. Verifying database connectivity
 * 3. Testing API endpoints
 * 4. Warming up service connections
 * 
 * Usage: node scripts/prepare-demo.js
 * 
 * NOTE: This does NOT create fake data - only verifies system readiness.
 * Real data should come from actual user interactions.
 */

const http = require('http');
const https = require('https');

const KONG_URL = process.env.KONG_URL || 'http://localhost:8000';
const JAEGER_URL = process.env.JAEGER_URL || 'http://localhost:16686';
const MAILDEV_URL = process.env.MAILDEV_URL || 'http://localhost:1080';

// Color output helpers
const colors = {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

// Simple HTTP request wrapper
function httpGet(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Health check for a service
async function checkService(name, url, expectedStatus = 200) {
    try {
        const response = await httpGet(url);
        if (response.status === expectedStatus || response.status === 200) {
            console.log(`  ${colors.green('✓')} ${name}: ${colors.green('healthy')}`);
            return true;
        } else {
            console.log(`  ${colors.yellow('⚠')} ${name}: ${colors.yellow(`status ${response.status}`)}`);
            return false;
        }
    } catch (error) {
        console.log(`  ${colors.red('✗')} ${name}: ${colors.red('not reachable')} (${error.message})`);
        return false;
    }
}

// Main function
async function main() {
    console.log('\n' + colors.bold(colors.cyan('🔧 KrystalineX Demo Preparation')) + '\n');
    console.log('This script verifies system readiness for investor demos.\n');
    console.log(colors.bold('Checking Infrastructure:'));

    const results = {
        api: await checkService('API Gateway (Kong)', `${KONG_URL}/api/v1/public/status`),
        jaeger: await checkService('Jaeger UI', `${JAEGER_URL}/api/services`),
        maildev: await checkService('MailDev', `${MAILDEV_URL}/healthz`),
        binance: await checkService('Binance API', 'https://api.binance.com/api/v3/ping'),
    };

    console.log('\n' + colors.bold('Warming Up Services:'));

    // Make a few requests to warm up the service
    try {
        await httpGet(`${KONG_URL}/api/v1/price`);
        console.log(`  ${colors.green('✓')} Price feed: ${colors.green('initialized')}`);
    } catch {
        console.log(`  ${colors.yellow('⚠')} Price feed: ${colors.yellow('will initialize on first request')}`);
    }

    try {
        await httpGet(`${KONG_URL}/api/v1/public/trades?limit=5`);
        console.log(`  ${colors.green('✓')} Trade feed: ${colors.green('initialized')}`);
    } catch {
        console.log(`  ${colors.yellow('⚠')} Trade feed: ${colors.yellow('will initialize on first request')}`);
    }

    // Summary
    console.log('\n' + colors.bold('Summary:'));

    const allHealthy = Object.values(results).every(Boolean);

    if (allHealthy) {
        console.log(colors.green('\n  ✅ All systems ready for demo!\n'));
        console.log('  Start the app with: ' + colors.cyan('npm run dev'));
        console.log('  Then navigate to: ' + colors.cyan('http://localhost:5000'));
        console.log('\n  Demo credentials:');
        console.log('    Email: demo@krystaline.io');
        console.log('    Password: Demo123!\n');
    } else {
        console.log(colors.yellow('\n  ⚠️ Some services need attention.\n'));
        console.log('  Try running: ' + colors.cyan('docker compose up -d'));
        console.log('  Then wait 60 seconds and try again.\n');
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(colors.red('\nError: ' + error.message));
    process.exit(1);
});
