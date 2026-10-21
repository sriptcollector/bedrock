import { defineConfig } from 'vitest/config';
// `npm run test:long` (vitest --mode long) turns on the slow tests (300 MB attachment, bigger storms).
export default defineConfig(({ mode }) => ({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    env: mode === 'long' || process.env.BEDROCK_LONG_TESTS ? { BEDROCK_LONG_TESTS: '1' } : {},
  },
}));
