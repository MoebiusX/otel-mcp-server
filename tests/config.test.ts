import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns sensible defaults', () => {
    const config = loadConfig();
    expect(config.jaegerUrl).toBe('http://localhost:16686');
    expect(config.prometheusUrl).toBe('http://localhost:9090');
    expect(config.lokiUrl).toBe('http://localhost:3100');
    expect(config.appApiUrl).toBe('http://localhost:5000');
    expect(config.prometheusPathPrefix).toBe('');
    expect(config.timeoutMs).toBe(15_000);
  });

  it('reads URLs from env vars', () => {
    process.env.JAEGER_URL = 'http://jaeger:16686';
    process.env.PROMETHEUS_URL = 'http://prom:9090';
    process.env.LOKI_URL = 'http://loki:3100';
    process.env.APP_API_URL = 'http://api:5000';

    const config = loadConfig();
    expect(config.jaegerUrl).toBe('http://jaeger:16686');
    expect(config.prometheusUrl).toBe('http://prom:9090');
    expect(config.lokiUrl).toBe('http://loki:3100');
    expect(config.appApiUrl).toBe('http://api:5000');
  });

  it('reads Prometheus path prefix', () => {
    process.env.PROMETHEUS_PATH_PREFIX = '/prometheus';
    const config = loadConfig();
    expect(config.prometheusPathPrefix).toBe('/prometheus');
  });

  it('reads custom timeout', () => {
    process.env.MCP_TIMEOUT_MS = '30000';
    const config = loadConfig();
    expect(config.timeoutMs).toBe(30_000);
  });

  it('includes backend auth config', () => {
    process.env.JAEGER_AUTH_TOKEN = 'j-token';
    const config = loadConfig();
    expect(config.auth).toBeDefined();
    expect(config.auth.jaeger.authorization).toBe('Bearer j-token');
  });
});
