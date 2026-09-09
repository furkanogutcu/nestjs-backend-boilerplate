import { defineConfig } from 'vitest/config';

import { alias, setupFiles, swcPlugin } from './vitest.shared.mjs';

export default defineConfig({
  plugins: [swcPlugin],
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
