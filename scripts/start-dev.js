
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { validateConfig } from './validate-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = config.rootDir;

const isWindows = config.isWindows;
const npmCmd = config.npmCmd;
const npxCmd = config.npxCmd;

// Pre-flight configuration validation
if (!validateConfig()) {
    console.error('❌ Configuration validation failed. Please fix the errors above and try again.');
    process.exit(1);
}

console.log('🚀 Starting Krystaline Exchange Development Environment...');

async function checkDocker() {
    try {
        execSync('docker info', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

async function startDockerServices() {
    console.log('📦 Starting Docker services (Kong, RabbitMQ, Jaeger, OTEL, Grafana, Exporters)...');
    // Only start infrastructure services (not kx-exchange or frontend - those run natively)
    const services = [
        'kong-database', 'kong-migrations', 'kong-gateway',
        'rabbitmq', 'app-database', 'jaeger', 'otel-collector',
        'prometheus', 'maildev', 'ollama', 'alertmanager',
        // Unified Observability stack
        'loki', 'promtail', 'grafana',
        // Metrics exporters for holistic observability
        'postgres-exporter', 'kong-postgres-exporter', 'node-exporter',
        // On-call / incident management
        'goalert-db', 'goalert'
    ];
    const child = spawn('docker-compose', ['up', '-d', ...services], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: true
    });

    return new Promise((resolve, reject) => {
        child.on('exit', (code) => {
            if (code === 0) {
                console.log('✅ Docker services started');
                resolve();
            } else {
                reject(new Error('Failed to start Docker services'));
            }
        });
    });
}

async function waitForServices() {
    console.log('⏳ Waiting for services to be ready...');

    // Wait for Kong Admin API (use internal URL for Docker health check)
    for (let i = 0; i < config.timeouts.kongAdmin; i++) {
        try {
            execSync(`curl -s ${config.kong.internalAdminUrl}/status`, { stdio: 'ignore' });
            console.log('   ✅ Kong Admin API ready');
            break;
        } catch (e) {
            if (i === config.timeouts.kongAdmin - 1) console.log('   ⚠️  Kong Admin API not responding (may still be starting)');
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Wait for Kong Proxy - critical for frontend API calls (use internal URL for Docker health check)
    for (let i = 0; i < config.timeouts.kongProxy; i++) {
        try {
            // Just check connectivity - Kong returns 404 for unknown routes but that's fine
            execSync(`curl -s --max-time 2 ${config.kong.internalGatewayUrl}/ > ${isWindows ? 'NUL' : '/dev/null'} 2>&1`, { stdio: 'ignore' });
            console.log(`   ✅ Kong Proxy ready (${config.kong.gatewayUrl})`);
            break;
        } catch (e) {
            if (i === config.timeouts.kongProxy - 1) console.log('   ⚠️  Kong Proxy not responding');
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Wait for RabbitMQ
    for (let i = 0; i < config.timeouts.rabbitmq; i++) {
        try {
            execSync(`curl -s ${config.rabbitmq.managementUrl}`, { stdio: 'ignore' });
            console.log('   ✅ RabbitMQ ready');
            break;
        } catch (e) {
            if (i === config.timeouts.rabbitmq - 1) console.log('   ⚠️  RabbitMQ not responding');
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Wait for PostgreSQL (app-database)
    for (let i = 0; i < config.timeouts.postgres; i++) {
        try {
            // Use node to check TCP connectivity
            const net = await import('net');
            const isReady = await new Promise((resolve) => {
                const socket = new net.default.Socket();
                socket.setTimeout(1000);
                socket.on('connect', () => { socket.destroy(); resolve(true); });
                socket.on('error', () => { socket.destroy(); resolve(false); });
                socket.on('timeout', () => { socket.destroy(); resolve(false); });
                socket.connect(config.database.port, config.database.host);
            });
            if (isReady) {
                console.log(`   ✅ PostgreSQL ready (${config.database.host}:${config.database.port})`);
                break;
            }
            throw new Error('not ready');
        } catch (e) {
            if (i === config.timeouts.postgres - 1) console.log('   ⚠️  PostgreSQL not responding');
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

async function configureKongPlugins() {
    console.log('🔧 Configuring Kong plugins...');
    try {
        // Enable OTEL plugin
        execSync('node scripts/enable-kong-otel.js', { cwd: rootDir, stdio: 'pipe' });
        console.log('   ✅ Kong OpenTelemetry plugin enabled');
    } catch (e) {
        console.log('   ⚠️  Failed to enable Kong OTEL plugin (may already be configured)');
    }
    try {
        // Enable CORS plugin
        execSync('node scripts/enable-kong-cors.js', { cwd: rootDir, stdio: 'pipe' });
        console.log('   ✅ Kong CORS plugin enabled');
    } catch (e) {
        console.log('   ⚠️  Failed to enable Kong CORS plugin (may already be configured)');
    }
}

function startProcess(name, cmd, args, color) {
    const child = spawn(cmd, args, {
        cwd: rootDir,
        shell: true,
        env: { ...process.env, NODE_ENV: 'development', FORCE_COLOR: '1', STORAGE_TYPE: 'postgres' }
    });

    child.stdout?.on('data', (data) => {
        process.stdout.write(`${color}[${name}]${'\x1b[0m'} ${data}`);
    });

    child.stderr?.on('data', (data) => {
        process.stderr.write(`${color}[${name}]${'\x1b[0m'} ${data}`);
    });

    return child;
}

/**
 * Wait for server to be healthy before starting dependent services
 */
async function waitForServer(maxWaitSec) {
    const timeout = maxWaitSec || config.timeouts.server;
    console.log('   ⏳ Waiting for Server to be ready...');
    for (let i = 0; i < timeout; i++) {
        try {
            execSync(`curl -s ${config.server.healthUrl}`, { stdio: 'ignore' });
            console.log(`   ✅ Server ready (${config.server.url})`);
            return true;
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    console.log('   ⚠️  Server health check timed out - proceeding anyway');
    return false;
}

async function main() {
    // Check Docker
    const dockerUp = await checkDocker();
    if (!dockerUp) {
        console.error('❌ Docker is not running. Please start Docker and try again.');
        process.exit(1);
    }

    // Start Docker services
    try {
        await startDockerServices();
        await waitForServices();
        await configureKongPlugins();
    } catch (e) {
        console.error('❌ Failed to start Docker services:', e.message);
        process.exit(1);
    }

    console.log('\n🚀 Starting application components...\n');

    // Start all components
    const processes = [];

    // Server (payment-api)
    processes.push(startProcess('SERVER', npmCmd, ['run', 'dev:server'], '\x1b[36m'));

    // Wait for server to be healthy before starting dependent services
    await waitForServer(60);

    // Payment Processor (kx-matcher) - depends on RabbitMQ queues from server
    processes.push(startProcess('MATCHER', npxCmd, ['tsx', 'payment-processor/index.ts'], '\x1b[33m'));

    // Matcher connects quickly, small delay sufficient
    await new Promise(r => setTimeout(r, 1000));

    // Vite frontend - depends on server for API proxy
    processes.push(startProcess('VITE', npxCmd, ['vite', '--host'], '\x1b[35m'));

    console.log('\n✨ All components starting! Open http://localhost:5173\n');
    console.log('   📊 Jaeger UI: http://localhost:16686');
    console.log('   📈 Grafana:   http://localhost:3000 (admin/admin)');
    console.log('   🐰 RabbitMQ:  http://localhost:15672');
    console.log('   🦍 Kong Admin: http://localhost:8001');
    console.log('   📧 MailDev:   http://localhost:1080');
    console.log('   🚨 On-Call:   http://localhost:8081 (GoAlert)\n');

    // Handle cleanup on exit
    const cleanup = () => {
        console.log('\n🛑 Shutting down...');
        processes.forEach(p => {
            try { p.kill(); } catch (e) { }
        });
        process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

main().catch(console.error);
