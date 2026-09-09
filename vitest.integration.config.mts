import { defineConfig } from 'vitest/config';

import { alias, setupFiles, swcPlugin } from './vitest.shared.mjs';

export default defineConfig({
  plugins: [swcPlugin],
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration-spec.ts', 'test/**/*.integration-spec.ts'],
    setupFiles,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 60000,
    hookTimeout: 180000,
    // * Each suite owns a container; running files in parallel would exhaust Docker and race on ports.
    fileParallelism: false,
  },
});
