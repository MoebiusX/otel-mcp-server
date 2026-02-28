/**
 * Restart Script - Clean shutdown and restart of all services
 * Run with: npm run restart
 */

import { execSync, spawn } from 'child_process';

console.log('\n🔄 RESTARTING ALL SERVICES\n');
console.log('='.repeat(50));

// Step 1: Kill all Node processes
console.log('\n🛑 Step 1: Stopping all Node processes...');
try {
    execSync('taskkill /F /IM node.exe', { stdio: 'pipe' });
    console.log('   ✅ Node processes terminated');
} catch (e) {
    console.log('   ⚠️  No Node processes running');
}

// Step 2: Wait for ports to free up
console.log('\n⏳ Step 2: Waiting for ports to release...');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    await sleep(3000);
    console.log('   ✅ Ports should be free now');

    // Step 3: Start fresh
    console.log('\n🚀 Step 3: Starting fresh development environment...\n');
    console.log('='.repeat(50));

    // Use npm run dev to start everything
    const child = spawn('npm', ['run', 'dev'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: true
    });

    child.on('error', (err) => {
        console.error('Failed to start:', err.message);
        process.exit(1);
    });

    // Forward signals
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
}

main();
