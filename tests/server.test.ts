import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

describe('createServer', () => {
  const config = loadConfig();

  it('creates a server with all tool groups by default', () => {
    const server = createServer(config);
    expect(server).toBeDefined();
  });

  it('creates a server with selective tool groups', () => {
    const server = createServer(config, { tools: ['traces', 'metrics'] });
    expect(server).toBeDefined();
  });

  it('creates a server with only logs', () => {
    const server = createServer(config, { tools: ['logs'] });
    expect(server).toBeDefined();
  });

  it('creates a server with empty tools array', () => {
    const server = createServer(config, { tools: [] });
    expect(server).toBeDefined();
  });
});
