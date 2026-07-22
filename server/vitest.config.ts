import { defineConfig } from 'vitest/config';

// Migration/invariant tests run against a REAL PostgreSQL test database
// (per decision 0001 §5). They are inherently serial — each spins the schema
// up and down against the same isolated `selves_test` database — so a single
// worker avoids cross-test interference.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
