import { describe, it, expect } from 'vitest';
import { applyAliasArgs, aliasDescription, registerTool } from '../src/compat.js';

describe('tool compatibility facade', () => {
  it('maps legacy argument names without mutating the input', () => {
    const input = { promql: 'up', time: '123' };
    const mapped = applyAliasArgs(input, {
      name: 'prometheus_query',
      mapsTo: 'metrics_query',
      argMap: { promql: 'query' },
    });

    expect(mapped).toEqual({ query: 'up', time: '123' });
    expect(input).toEqual({ promql: 'up', time: '123' });
  });

  it('does not let legacy argument names override canonical values', () => {
    const mapped = applyAliasArgs(
      { promql: 'legacy', query: 'canonical' },
      {
        name: 'prometheus_query',
        mapsTo: 'metrics_query',
        argMap: { promql: 'query' },
      },
    );

    expect(mapped).toEqual({ query: 'canonical' });
  });

  it('registers canonical tools and aliases through one path', async () => {
    const registered: any[] = [];
    const server = {
      tool: (
        name: string,
        description: string,
        inputSchema: Record<string, unknown>,
        handler: (args: any) => unknown,
      ) => registered.push({ name, description, inputSchema, handler }),
    };

    registerTool(server, {
      name: 'metrics_query',
      description: 'Execute an instant PromQL query.',
      inputSchema: { query: 'zod-ish' },
      handler: (args) => ({ args }),
      aliases: [{
        name: 'prometheus_query',
        mapsTo: 'metrics_query',
        argMap: { promql: 'query' },
        deprecatedSince: '1.8.0',
        removeAfter: '2.0.0',
      }],
    });

    expect(registered.map((tool) => tool.name)).toEqual([
      'metrics_query',
      'prometheus_query',
    ]);
    expect(registered[1].description).toContain('Deprecated alias for metrics_query');
    await expect(registered[1].handler({ promql: 'up' })).resolves.toEqual({
      args: { query: 'up' },
    });
  });

  it('rejects aliases that point at a different canonical tool', () => {
    expect(() => registerTool({
      tool: () => {},
    }, {
      name: 'metrics_query',
      description: 'Execute an instant PromQL query.',
      inputSchema: {},
      handler: () => ({}),
      aliases: [{ name: 'logs_query_old', mapsTo: 'logs_query' }],
    })).toThrow(/expected "metrics_query"/);
  });

  it('renders deprecation windows in alias descriptions', () => {
    expect(aliasDescription({
      name: 'prometheus_query',
      mapsTo: 'metrics_query',
      deprecatedSince: '1.8.0',
      removeAfter: '2.0.0',
    }, 'metrics_query')).toBe(
      'Deprecated alias for metrics_query. Deprecated since 1.8.0. Earliest removal: 2.0.0.',
    );
  });
});
