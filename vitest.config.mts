import { defineConfig } from 'vitest/config';

import { alias, setupFiles, swcPlugin } from './vitest.shared.mjs';

export default defineConfig({
  plugins: [swcPlugin],
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.integration-spec.ts'],
    setupFiles,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.integration-spec.ts',
        '**/*.module.ts',
        '**/*.interface.ts',
        '**/*.enum.ts',
        '**/*.constant.ts',
        '**/*.declaration.ts',
        '**/*.entity.ts',
        '**/*.repository.ts',
        '**/index.ts',
        'src/main.ts',
        'src/config/env.config.ts',
        '**/*.config.ts',
        'src/database/typeorm.data-source.ts',
        'src/database/migrations/**',
        '**/scripts/**',
        'src/infrastructure/docs/**',
        'src/infrastructure/redis/redis.service.ts',
      ],
      // * Regression floors, not targets; branch floors are lower because emitDecoratorMetadata adds
      // * uncoverable branches per DI constructor.
      thresholds: {
        statements: 95,
        branches: 80,
        functions: 95,
        lines: 95,
        'src/shared/exceptions/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/shared/pipes/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/shared/schemas/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/shared/utils/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/shared/interceptors/**': { statements: 100, branches: 85, functions: 100, lines: 100 },
        'src/shared/guards/**': { statements: 100, branches: 85, functions: 100, lines: 100 },
        'src/infrastructure/cache/**': { statements: 100, branches: 90, functions: 100, lines: 100 },
      },
    },
  },
});
