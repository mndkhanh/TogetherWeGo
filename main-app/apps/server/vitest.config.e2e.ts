import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// E2E tests need the local stack running: `pnpm db:up && pnpm db:migrate`.
// Locally they read apps/server/.env; in CI the variables come from the workflow.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test' },
  },
});
