/// <reference types="vitest/globals" />

declare module 'vitest' {
  export const describe: typeof import('vitest')['describe'];
  export const it: typeof import('vitest')['it'];
  export const expect: typeof import('vitest')['expect'];
  export const beforeEach: typeof import('vitest')['beforeEach'];
  export const afterEach: typeof import('vitest')['afterEach'];
  export const beforeAll: typeof import('vitest')['beforeAll'];
  export const afterAll: typeof import('vitest')['afterAll'];
  export const vi: typeof import('vitest')['vi'];
}
