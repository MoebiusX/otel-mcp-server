/**
 * Single source of truth for the server version.
 *
 * Read from package.json at runtime so the banner, /health, and
 * mcp_server_info metric never drift from the published package version.
 * Uses createRequire (built-in, zero-dependency) which resolves the
 * sibling package.json from both src (tests) and dist (published) layouts.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const VERSION: string = pkg.version;
