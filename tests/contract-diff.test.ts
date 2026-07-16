import { describe, it, expect } from 'vitest';
import {
  bumpExceeds,
  diffToolContracts,
  maxBump,
  type ToolContractManifest,
} from '../src/contract-diff.js';

function manifest(tool: any): ToolContractManifest {
  return {
    schemaVersion: 1,
    source: 'mcp/listTools',
    profiles: [{
      name: 'default',
      tools: [tool],
    }],
  };
}

function tool(overrides: any = {}) {
  return {
    name: 'metrics_query',
    description: 'Execute query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
    ...overrides,
  };
}

describe('contract semver diff', () => {
  it('reports none when manifests match', () => {
    const before = manifest(tool());
    const after = manifest(tool());

    expect(diffToolContracts(before, after)).toEqual({
      recommendedBump: 'none',
      changes: [],
    });
  });

  it('classifies description-only changes as patch', () => {
    const report = diffToolContracts(
      manifest(tool()),
      manifest(tool({ description: 'Execute instant query.' })),
    );

    expect(report.recommendedBump).toBe('patch');
    expect(report.changes.map((c) => c.kind)).toEqual(['tool.description.changed']);
  });

  it('classifies added tools and optional args as minor', () => {
    const before = manifest(tool());
    const after: ToolContractManifest = {
      ...before,
      profiles: [{
        name: 'default',
        tools: [
          {
            ...tool(),
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                time: { type: 'string' },
              },
              required: ['query'],
            },
          },
          {
            name: 'metrics_targets',
            description: 'List targets.',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }],
    };

    const report = diffToolContracts(before, after);

    expect(report.recommendedBump).toBe('minor');
    expect(report.changes.map((c) => c.kind).sort()).toEqual([
      'arg.added.optional',
      'tool.added',
    ]);
  });

  it('classifies removed tools as major', () => {
    const before: ToolContractManifest = {
      ...manifest(tool()),
      profiles: [{
        name: 'default',
        tools: [tool(), { name: 'metrics_targets', inputSchema: {} }],
      }],
    };
    const after = manifest(tool());

    const report = diffToolContracts(before, after);

    expect(report.recommendedBump).toBe('major');
    expect(report.changes[0].kind).toBe('tool.removed');
  });

  it('classifies required args and requiredness tightening as major', () => {
    const before = manifest(tool());
    const after = manifest(tool({
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          target: { type: 'string' },
        },
        required: ['query', 'target'],
      },
    }));

    const report = diffToolContracts(before, after);

    expect(report.recommendedBump).toBe('major');
    expect(report.changes.map((c) => c.kind)).toContain('arg.added.required');
  });

  it('classifies enum narrowing as major and enum widening as minor', () => {
    const before = manifest(tool({
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['all', 'firing'] },
        },
      },
    }));

    expect(diffToolContracts(before, manifest(tool({
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['firing'] },
        },
      },
    }))).recommendedBump).toBe('major');

    expect(diffToolContracts(before, manifest(tool({
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['all', 'firing', 'pending'] },
        },
      },
    }))).recommendedBump).toBe('minor');
  });

  it('classifies default and type changes as major', () => {
    expect(diffToolContracts(
      manifest(tool({
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number', default: 50 } },
        },
      })),
      manifest(tool({
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number', default: 100 } },
        },
      })),
    ).recommendedBump).toBe('major');

    expect(diffToolContracts(
      manifest(tool({
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number' } },
        },
      })),
      manifest(tool({
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'string' } },
        },
      })),
    ).recommendedBump).toBe('major');
  });

  it('compares bump ordering for CLI max checks', () => {
    expect(maxBump('patch', 'minor')).toBe('minor');
    expect(maxBump('major', 'minor')).toBe('major');
    expect(bumpExceeds('major', 'minor')).toBe(true);
    expect(bumpExceeds('minor', 'major')).toBe(false);
  });
});
