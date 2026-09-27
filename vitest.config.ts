import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    env: {
      LAUNCHPILOT_FAST: '1',
    },
  },
  resolve: {
    alias: {
      '@launchpilot/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@': resolve(__dirname, 'packages/web/src'),
    },
  },
});
