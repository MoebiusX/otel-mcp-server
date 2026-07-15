import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      // Source only — exclude generated code and pure type/entry modules that
      // carry no testable logic.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/skills.generated.ts',
        'src/skill-versions.ts',
        'src/versions.ts',
        'src/version.ts',
      ],
      reporter: ['text', 'text-summary'],
      // Enforced on the authentication surface introduced by the JIT /
      // enterprise-managed-authorization work. `npm run test:coverage` fails
      // the run if any of these regress below threshold.
      thresholds: {
        'src/jit.ts': { statements: 90, lines: 90, functions: 90 },
        'src/enterprise-auth.ts': { statements: 90, lines: 90, functions: 90 },
        'src/transports/jit-endpoints.ts': { statements: 90, lines: 90, functions: 90 },
        'src/auth.ts': { statements: 90, lines: 90, functions: 90 },
      },
    },
  },
});
