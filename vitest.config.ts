import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run TypeScript unit sources; never the compiled copies in out/ or the VS Code E2E suite.
    include: ['src/**/*.test.ts'],
    exclude: ['out/**', 'out-e2e/**', 'test-e2e/**', 'node_modules/**'],
    // NOTE: vitest's worker runtime cannot initialize when `npm test` is spawned by an agent via
    // run_command (no controlling terminal anywhere in the console-less VS Code/Electron process tree,
    // on Node 25) — fails the same way on vitest 1.x AND 4.x, every pool. So agents verify with build +
    // lint and Claude runs this suite (normal terminal / CI work fine). Default (parallel forks) here.
  },
});
