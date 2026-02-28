/**
 * Configuration Validation Script
 * 
 * Pre-flight check for all required environment variables and K8s manifests.
 * Run before starting the dev environment to catch config errors early.
 * 
 * Usage:
 *   node scripts/validate-config.js              # Default: docker mode
 *   node scripts/validate-config.js docker       # Docker Compose validation
 *   node scripts/validate-config.js k8s          # Kubernetes validation
 * 
 * Exit codes:
 *   0 = All validations passed
 *   1 = One or more validations failed
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// Colors for terminal output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
};

// ============================================
// LOAD .env FILE
// ============================================

function loadEnvFile() {
    const envPath = path.join(rootDir, '.env');
    if (!existsSync(envPath)) {
        console.error(`${colors.red}❌ .env file not found at ${envPath}${colors.reset}`);
        console.error(`${colors.dim}   Copy .env.example to .env and configure it.${colors.reset}`);
        return false;
    }

    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').trim();
            if (key && value && !process.env[key]) {
                process.env[key] = value;
            }
        }
    });
    return true;
}

// ============================================
// VALIDATION RULES - DOCKER
// ============================================

/**
 * Required variables for Docker Compose
 * These use the :? syntax in docker-compose.yml
 */
const dockerComposeRequired = [
    {
        name: 'KONG_PG_PASSWORD',
        description: 'Kong PostgreSQL database password',
        suggestion: 'Add KONG_PG_PASSWORD=your_password to .env',
    },
    {
        name: 'RABBITMQ_PASSWORD',
        description: 'RabbitMQ password',
        suggestion: 'Add RABBITMQ_PASSWORD=your_password to .env',
    },
    {
        name: 'DB_PASSWORD',
        description: 'Application database password',
        suggestion: 'Add DB_PASSWORD=your_password to .env',
    },
];

/**
 * Required variables for application server
 */
const serverRequired = [
    {
        name: 'JWT_SECRET',
        description: 'JWT signing secret',
        minLength: 16,
        suggestion: 'Add JWT_SECRET=your_secret_at_least_16_chars to .env',
    },
];

/**
 * Variables that should be valid URLs
 */
const urlValidations = [
    { name: 'RABBITMQ_URL', description: 'RabbitMQ connection URL' },
    { name: 'KONG_GATEWAY_URL', description: 'Kong Gateway URL', optional: true },
    { name: 'KONG_ADMIN_URL', description: 'Kong Admin URL', optional: true },
];

// ============================================
// VALIDATION RULES - KUBERNETES
// ============================================

const k8sSecrets = [
    {
        name: 'krystalinex-secrets',
        namespace: 'default',
        keys: ['database-url', 'rabbitmq-url', 'jwt-secret'],
        description: 'Main application secrets',
    },
    {
        name: 'krystalinex-db-secrets',
        namespace: 'default',
        keys: ['postgres-password', 'password'],
        description: 'PostgreSQL database credentials',
    },
    {
        name: 'krystalinex-rabbitmq-secrets',
        namespace: 'default',
        keys: ['rabbitmq-password'],
        description: 'RabbitMQ credentials',
    },
];

const k8sFiles = [
    {
        path: 'k8s/charts/krystalinex/values.yaml',
        description: 'Helm values file',
    },
    {
        path: 'k8s/charts/krystalinex/values-local.yaml',
        description: 'Local dev Helm values',
    },
    {
        path: 'k8s/charts/krystalinex/Chart.yaml',
        description: 'Helm chart definition',
    },
];

// ============================================
// VALIDATION FUNCTIONS
// ============================================

function validateRequired(rules) {
    const errors = [];

    for (const rule of rules) {
        const value = process.env[rule.name];

        if (!value || value.trim() === '') {
            errors.push({
                variable: rule.name,
                message: `Missing required variable: ${rule.description}`,
                suggestion: rule.suggestion,
            });
            continue;
        }

        if (rule.minLength && value.length < rule.minLength) {
            errors.push({
                variable: rule.name,
                message: `${rule.name} must be at least ${rule.minLength} characters (got ${value.length})`,
                suggestion: rule.suggestion,
            });
        }
    }

    return errors;
}

function validateUrls(rules) {
    const errors = [];

    for (const rule of rules) {
        const value = process.env[rule.name];

        if (!value && rule.optional) {
            continue;
        }

        if (!value) {
            errors.push({
                variable: rule.name,
                message: `Missing URL: ${rule.description}`,
                suggestion: `Add ${rule.name}=http://localhost:PORT to .env`,
            });
            continue;
        }

        // Special handling for amqp:// URLs
        if (rule.name === 'RABBITMQ_URL') {
            if (!value.startsWith('amqp://') && !value.startsWith('amqps://')) {
                errors.push({
                    variable: rule.name,
                    message: `${rule.name} must start with amqp:// or amqps://`,
                    suggestion: `Example: amqp://user:password@localhost:5672`,
                });
            }
            continue;
        }

        // Validate HTTP URLs
        try {
            new URL(value);
        } catch {
            errors.push({
                variable: rule.name,
                message: `${rule.name} is not a valid URL: ${value}`,
                suggestion: `Check the format of ${rule.name}`,
            });
        }
    }

    return errors;
}

function checkKubectlAvailable() {
    try {
        execSync('kubectl version --client', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function checkHelmAvailable() {
    try {
        execSync('helm version --short', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function checkK8sContext() {
    try {
        const context = execSync('kubectl config current-context', { encoding: 'utf-8' }).trim();
        return context;
    } catch {
        return null;
    }
}

function checkK8sSecret(secretName, namespace = 'default') {
    try {
        execSync(`kubectl get secret ${secretName} -n ${namespace}`, { stdio: 'ignore' });
        return { exists: true };
    } catch {
        return { exists: false };
    }
}

function validateHelmTemplate() {
    try {
        execSync('helm template krystalinex ./k8s/charts/krystalinex -f ./k8s/charts/krystalinex/values-local.yaml', {
            cwd: rootDir,
            stdio: 'pipe',
        });
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.stderr?.toString() || e.message };
    }
}

// ============================================
// DOCKER VALIDATION
// ============================================

function printValidationResult(name, hasError, detail = '') {
    if (hasError) {
        console.log(`  ${colors.red}❌ ${name}${colors.reset}`);
    } else {
        console.log(`  ${colors.green}✅ ${name}${colors.reset} ${colors.dim}${detail}${colors.reset}`);
    }
}

export function validateDocker(options = { verbose: true }) {
    const { verbose } = options;
    const allErrors = [];

    if (verbose) {
        console.log(`${colors.cyan}🔍 Validating Docker configuration...${colors.reset}\n`);
    }

    // Load .env file
    if (!loadEnvFile()) {
        return false;
    }

    // Docker Compose required variables
    if (verbose) {
        console.log(`${colors.dim}Checking Docker Compose requirements...${colors.reset}`);
    }
    const dockerErrors = validateRequired(dockerComposeRequired);
    allErrors.push(...dockerErrors);

    for (const rule of dockerComposeRequired) {
        const value = process.env[rule.name];
        const hasError = dockerErrors.some(e => e.variable === rule.name);
        if (verbose) {
            printValidationResult(rule.name, hasError, value ? '(***)' : '');
        }
    }

    if (verbose) console.log('');

    // Server required variables
    if (verbose) {
        console.log(`${colors.dim}Checking server requirements...${colors.reset}`);
    }
    const serverErrors = validateRequired(serverRequired);
    allErrors.push(...serverErrors);

    for (const rule of serverRequired) {
        const value = process.env[rule.name];
        const hasError = serverErrors.some(e => e.variable === rule.name);
        if (verbose) {
            printValidationResult(rule.name, hasError, `(${value?.length || 0} chars)`);
        }
    }

    if (verbose) console.log('');

    // URL validations
    if (verbose) {
        console.log(`${colors.dim}Checking URL formats...${colors.reset}`);
    }
    const urlErrors = validateUrls(urlValidations);
    allErrors.push(...urlErrors);

    for (const rule of urlValidations) {
        const value = process.env[rule.name];
        const hasError = urlErrors.some(e => e.variable === rule.name);
        if (verbose) {
            if (!value && rule.optional) {
                console.log(`  ${colors.dim}⏭️  ${rule.name} (optional, not set)${colors.reset}`);
            } else {
                const maskedValue = value?.replace(/:[^:@]+@/, ':***@');
                printValidationResult(rule.name, hasError, `(${maskedValue})`);
            }
        }
    }

    if (verbose) console.log('');

    // Report results
    if (allErrors.length > 0) {
        if (verbose) {
            console.log(`${colors.red}❌ Docker validation failed with ${allErrors.length} error(s):${colors.reset}\n`);
            for (const error of allErrors) {
                console.log(`  ${colors.red}• ${error.variable}:${colors.reset} ${error.message}`);
                if (error.suggestion) {
                    console.log(`    ${colors.dim}→ ${error.suggestion}${colors.reset}`);
                }
            }
            console.log('');
        }
        return false;
    }

    if (verbose) {
        console.log(`${colors.green}✅ All Docker configuration checks passed!${colors.reset}\n`);
    }
    return true;
}

// ============================================
// KUBERNETES VALIDATION
// ============================================

export function validateK8s(options = { verbose: true }) {
    const { verbose } = options;
    const errors = [];
    const warnings = [];

    if (verbose) {
        console.log(`${colors.cyan}🔍 Validating Kubernetes configuration...${colors.reset}\n`);
    }

    // Check prerequisites
    if (verbose) {
        console.log(`${colors.dim}Checking prerequisites...${colors.reset}`);
    }

    const hasKubectl = checkKubectlAvailable();
    const hasHelm = checkHelmAvailable();

    if (verbose) {
        printValidationResult('kubectl installed', !hasKubectl);
        printValidationResult('helm installed', !hasHelm);
    }

    if (!hasKubectl) {
        errors.push({ variable: 'kubectl', message: 'kubectl is not installed or not in PATH' });
    }
    if (!hasHelm) {
        errors.push({ variable: 'helm', message: 'helm is not installed or not in PATH' });
    }

    if (verbose) console.log('');

    // Check K8s context
    if (hasKubectl) {
        if (verbose) {
            console.log(`${colors.dim}Checking Kubernetes context...${colors.reset}`);
        }
        const context = checkK8sContext();
        if (context) {
            if (verbose) {
                console.log(`  ${colors.green}✅ Current context:${colors.reset} ${colors.bold}${context}${colors.reset}`);
            }
        } else {
            warnings.push({ message: 'No Kubernetes context configured' });
            if (verbose) {
                console.log(`  ${colors.yellow}⚠️  No Kubernetes context configured${colors.reset}`);
            }
        }
        if (verbose) console.log('');
    }

    // Check Helm chart files
    if (verbose) {
        console.log(`${colors.dim}Checking Helm chart files...${colors.reset}`);
    }

    for (const file of k8sFiles) {
        const fullPath = path.join(rootDir, file.path);
        const exists = existsSync(fullPath);
        if (!exists) {
            errors.push({ variable: file.path, message: `Missing: ${file.description}` });
        }
        if (verbose) {
            printValidationResult(file.path, !exists);
        }
    }

    if (verbose) console.log('');

    // Validate Helm template (dry-run)
    if (hasHelm && !errors.some(e => e.variable.includes('Chart'))) {
        if (verbose) {
            console.log(`${colors.dim}Validating Helm template...${colors.reset}`);
        }
        const templateResult = validateHelmTemplate();
        if (templateResult.valid) {
            if (verbose) {
                console.log(`  ${colors.green}✅ Helm template renders successfully${colors.reset}`);
            }
        } else {
            errors.push({ variable: 'helm template', message: 'Template render failed', detail: templateResult.error });
            if (verbose) {
                console.log(`  ${colors.red}❌ Helm template render failed${colors.reset}`);
                if (templateResult.error) {
                    console.log(`    ${colors.dim}${templateResult.error.slice(0, 200)}${colors.reset}`);
                }
            }
        }
        if (verbose) console.log('');
    }

    // Check K8s secrets (if connected to cluster)
    if (hasKubectl && checkK8sContext()) {
        if (verbose) {
            console.log(`${colors.dim}Checking Kubernetes secrets...${colors.reset}`);
        }

        for (const secret of k8sSecrets) {
            const result = checkK8sSecret(secret.name, secret.namespace);
            if (!result.exists) {
                warnings.push({ message: `Secret ${secret.name} not found in namespace ${secret.namespace}` });
                if (verbose) {
                    console.log(`  ${colors.yellow}⚠️  ${secret.name}${colors.reset} ${colors.dim}(not found - will be created on deploy)${colors.reset}`);
                }
            } else {
                if (verbose) {
                    console.log(`  ${colors.green}✅ ${secret.name}${colors.reset} ${colors.dim}(exists)${colors.reset}`);
                }
            }
        }
        if (verbose) console.log('');
    }

    // Report results
    if (errors.length > 0) {
        if (verbose) {
            console.log(`${colors.red}❌ Kubernetes validation failed with ${errors.length} error(s):${colors.reset}\n`);
            for (const error of errors) {
                console.log(`  ${colors.red}• ${error.variable}:${colors.reset} ${error.message}`);
            }
            console.log('');
        }
        return false;
    }

    if (warnings.length > 0 && verbose) {
        console.log(`${colors.yellow}⚠️  ${warnings.length} warning(s) (non-blocking)${colors.reset}\n`);
    }

    if (verbose) {
        console.log(`${colors.green}✅ All Kubernetes configuration checks passed!${colors.reset}\n`);
    }
    return true;
}

// ============================================
// CONFIGURATION COMPARISON (all mode)
// ============================================

/**
 * Configuration variables to compare between Docker and K8s
 */
const configVariables = [
    // Database
    { name: 'Database Host', dockerEnv: 'DB_HOST', k8sPath: 'postgresql.primary.service.name', dockerDefault: 'localhost', k8sDefault: 'krystalinex-postgresql' },
    { name: 'Database Port', dockerEnv: 'DB_PORT', k8sPath: 'postgresql.service.port', dockerDefault: '5433', k8sDefault: '5432' },
    { name: 'Database User', dockerEnv: 'DB_USER', k8sPath: 'postgresql.auth.username', dockerDefault: 'exchange', k8sDefault: 'exchange' },
    { name: 'Database Name', dockerEnv: 'DB_NAME', k8sPath: 'postgresql.auth.database', dockerDefault: 'crypto_exchange', k8sDefault: 'crypto_exchange' },
    { name: 'Database Password', dockerEnv: 'DB_PASSWORD', k8sSecret: 'krystalinex-db-secrets:password', sensitive: true },

    // RabbitMQ
    { name: 'RabbitMQ User', dockerEnv: 'RABBITMQ_USER', k8sPath: 'rabbitmq.auth.username', dockerDefault: 'admin', k8sDefault: 'admin' },
    { name: 'RabbitMQ Password', dockerEnv: 'RABBITMQ_PASSWORD', k8sSecret: 'krystalinex-rabbitmq-secrets:rabbitmq-password', sensitive: true },
    { name: 'RabbitMQ URL', dockerEnv: 'RABBITMQ_URL', k8sSecret: 'krystalinex-secrets:rabbitmq-url', sensitive: true },

    // Kong
    { name: 'Kong PG User', dockerEnv: 'KONG_PG_USER', k8sPath: 'kongPostgresql.auth.username', dockerDefault: 'kong', k8sDefault: 'kong' },
    { name: 'Kong PG Password', dockerEnv: 'KONG_PG_PASSWORD', k8sSecret: 'krystalinex-kong-secrets:password', sensitive: true },

    // Application
    { name: 'JWT Secret', dockerEnv: 'JWT_SECRET', k8sSecret: 'krystalinex-secrets:jwt-secret', sensitive: true },
    { name: 'Node Environment', dockerEnv: 'NODE_ENV', k8sPath: 'server.env.NODE_ENV', dockerDefault: 'development', k8sDefault: 'production' },
    { name: 'Server Port', dockerEnv: 'PORT', k8sPath: 'server.service.port', dockerDefault: '5000', k8sDefault: '5000' },

    // Observability
    { name: 'Kong Gateway URL', dockerEnv: 'KONG_GATEWAY_URL', k8sPath: 'kong.service.ports.proxy', dockerDefault: 'http://localhost:8000', k8sDefault: '8000' },
    { name: 'Kong Admin URL', dockerEnv: 'KONG_ADMIN_URL', k8sPath: 'kong.service.ports.admin', dockerDefault: 'http://localhost:8001', k8sDefault: '8001' },
    { name: 'Jaeger URL', dockerEnv: 'JAEGER_URL', k8sPath: 'jaeger.service.ports.ui', dockerDefault: 'http://localhost:16686', k8sDefault: '16686' },
];

function getK8sSecretValue(secretSpec) {
    const [secretName, key] = secretSpec.split(':');
    try {
        const result = execSync(
            `kubectl get secret ${secretName} -o jsonpath="{.data.${key}}" 2>/dev/null`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        if (result) {
            // Base64 decode
            return Buffer.from(result, 'base64').toString('utf-8');
        }
        return null;
    } catch {
        return null;
    }
}

function getK8sValuesPath(valuePath) {
    // Read from values.yaml and extract the value
    try {
        const valuesPath = path.join(rootDir, 'k8s/charts/krystalinex/values.yaml');
        const content = readFileSync(valuesPath, 'utf-8');
        // Simple YAML value extraction (works for simple paths)
        const parts = valuePath.split('.');
        let current = content;
        for (const part of parts) {
            const regex = new RegExp(`^\\s*${part}:\\s*(.+)$`, 'm');
            const match = current.match(regex);
            if (match) {
                return match[1].trim();
            }
        }
        return null;
    } catch {
        return null;
    }
}

function maskValue(value, sensitive) {
    if (!value) return '-';
    if (sensitive && value.length > 0) {
        // Mask passwords/secrets
        if (value.includes('@')) {
            return value.replace(/:[^:@]+@/, ':***@');
        }
        return value.length > 4 ? value.slice(0, 2) + '***' + value.slice(-2) : '***';
    }
    return value;
}

function padRight(str, len) {
    return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padLeft(str, len) {
    return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

export function compareConfigs() {
    console.log(`${colors.cyan}📊 Configuration Comparison: Docker vs Kubernetes${colors.reset}\n`);

    // Load .env file for Docker values
    loadEnvFile();

    // Check if kubectl is available for K8s values
    const hasKubectl = checkKubectlAvailable();
    const k8sContext = hasKubectl ? checkK8sContext() : null;

    if (k8sContext) {
        console.log(`${colors.dim}K8s context: ${k8sContext}${colors.reset}\n`);
    } else {
        console.log(`${colors.yellow}⚠️  K8s not connected - showing defaults from values.yaml${colors.reset}\n`);
    }

    // Table header
    const colWidths = { name: 20, docker: 35, k8s: 35 };
    console.log(`${colors.bold}${padRight('Variable', colWidths.name)} │ ${padRight('Docker (.env)', colWidths.docker)} │ ${padRight('K8s (secrets/values)', colWidths.k8s)}${colors.reset}`);
    console.log('─'.repeat(colWidths.name) + '─┼─' + '─'.repeat(colWidths.docker) + '─┼─' + '─'.repeat(colWidths.k8s));

    let mismatches = 0;
    const results = [];

    for (const variable of configVariables) {
        // Get Docker value
        let dockerValue = process.env[variable.dockerEnv] || variable.dockerDefault || '-';

        // Get K8s value
        let k8sValue;
        if (variable.k8sSecret) {
            k8sValue = k8sContext ? getK8sSecretValue(variable.k8sSecret) : null;
            if (!k8sValue) k8sValue = variable.k8sDefault || '(secret)';
        } else if (variable.k8sPath) {
            k8sValue = getK8sValuesPath(variable.k8sPath) || variable.k8sDefault || '-';
        } else {
            k8sValue = variable.k8sDefault || '-';
        }

        // Mask sensitive values
        const dockerDisplay = maskValue(dockerValue, variable.sensitive);
        const k8sDisplay = maskValue(k8sValue, variable.sensitive);

        // Check for value mismatches (only for non-sensitive, comparable values)
        let mismatchIndicator = '';
        if (!variable.sensitive && dockerValue !== '-' && k8sValue !== '-') {
            // Normalize for comparison (e.g., URL vs port number)
            const dockerNorm = dockerValue.replace(/^https?:\/\/[^:]+:?/, '');
            const k8sNorm = k8sValue.toString();
            if (dockerNorm !== k8sNorm && !dockerNorm.includes(k8sNorm) && !k8sNorm.includes(dockerNorm)) {
                mismatchIndicator = ` ${colors.yellow}⚠${colors.reset}`;
                mismatches++;
            }
        }

        // Print row
        const nameCol = padRight(variable.name, colWidths.name);
        const dockerCol = padRight(dockerDisplay.slice(0, colWidths.docker - 2), colWidths.docker);
        const k8sCol = padRight(k8sDisplay.slice(0, colWidths.k8s - 2), colWidths.k8s) + mismatchIndicator;

        console.log(`${nameCol} │ ${dockerCol} │ ${k8sCol}`);

        results.push({ name: variable.name, docker: dockerValue, k8s: k8sValue, sensitive: variable.sensitive });
    }

    console.log('─'.repeat(colWidths.name) + '─┴─' + '─'.repeat(colWidths.docker) + '─┴─' + '─'.repeat(colWidths.k8s));
    console.log('');

    // Summary
    if (mismatches > 0) {
        console.log(`${colors.yellow}⚠️  ${mismatches} potential difference(s) detected${colors.reset}`);
        console.log(`${colors.dim}   (Some differences are expected, e.g., localhost vs service names)${colors.reset}`);
    } else {
        console.log(`${colors.green}✅ All comparable values match${colors.reset}`);
    }

    console.log('');
    console.log(`${colors.dim}Legend: - = not set, (secret) = K8s secret exists but not decoded, ⚠ = different values${colors.reset}\n`);

    return true;
}

// ============================================
// MAIN VALIDATION (combined for backward compat)
// ============================================

export function validateConfig(options = { verbose: true, mode: 'docker' }) {
    const mode = options.mode || 'docker';
    if (mode === 'k8s') {
        return validateK8s(options);
    }
    if (mode === 'all') {
        return compareConfigs();
    }
    return validateDocker(options);
}

// ============================================
// CLI ENTRY POINT
// ============================================

const isMainModule = process.argv[1] &&
    (process.argv[1].endsWith('validate-config.js') ||
        process.argv[1].includes('validate-config'));

if (isMainModule) {
    const mode = process.argv[2] || 'docker';

    if (mode !== 'docker' && mode !== 'k8s' && mode !== 'all') {
        console.log(`${colors.cyan}Usage:${colors.reset}`);
        console.log(`  node scripts/validate-config.js [docker|k8s|all]`);
        console.log('');
        console.log(`${colors.dim}Modes:${colors.reset}`);
        console.log(`  docker  - Validate Docker Compose configuration (default)`);
        console.log(`  k8s     - Validate Kubernetes/Helm configuration`);
        console.log(`  all     - Compare Docker vs K8s configuration values`);
        process.exit(1);
    }

    if (mode !== 'all') {
        console.log(`${colors.bold}Mode: ${mode.toUpperCase()}${colors.reset}\n`);
    }
    const success = validateConfig({ verbose: true, mode });
    process.exit(success ? 0 : 1);
}
