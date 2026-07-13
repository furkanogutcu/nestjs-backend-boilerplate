import type { Config } from 'jest';

// * Mirrors tsconfig `paths`; keep in sync with test/jest-e2e.json and test/jest-integration.json.
const moduleNameMapper: Config['moduleNameMapper'] = {
  '^@config/(.*)$': '<rootDir>/config/$1',
  '^@shared/(.*)$': '<rootDir>/shared/$1',
  '^@infrastructure/(.*)$': '<rootDir>/infrastructure/$1',
  '^@modules/(.*)$': '<rootDir>/modules/$1',
  '^@database/(.*)$': '<rootDir>/database/$1',
  '^@test/(.*)$': '<rootDir>/../test/$1',
};

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // * jose v6 ships ESM only; let ts-jest transpile it instead of ignoring it like the rest of node_modules.
  transformIgnorePatterns: ['/node_modules/\\.pnpm/(?!jose@)'],
  moduleNameMapper,
  testEnvironment: 'node',

  setupFiles: ['<rootDir>/../test/jest.env-setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/../test/jest.setup.ts'],

  clearMocks: true,
  restoreMocks: true,

  collectCoverageFrom: [
    '**/*.ts',
    '!**/*spec.ts',
    '!**/*.module.ts',
    '!**/*.interface.ts',
    '!**/*.enum.ts',
    '!**/*.constant.ts',
    '!**/*.declaration.ts',
    '!**/*.entity.ts',
    '!**/*.repository.ts',
    '!**/index.ts',
    '!main.ts',
    '!instrument.ts',
    '!config/env.config.ts',
    '!**/*.config.ts',
    '!database/typeorm.data-source.ts',
    '!database/migrations/**',
    '!**/scripts/**',
    '!infrastructure/docs/**',
    '!infrastructure/redis/redis.service.ts',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['text-summary', 'text', 'html', 'lcov'],
  // * Regression floors, not targets; branch floors are lower because emitDecoratorMetadata adds uncoverable branches per DI constructor.
  coverageThreshold: {
    global: { statements: 95, branches: 80, functions: 95, lines: 95 },
    '**/shared/exceptions/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
    '**/shared/pipes/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
    '**/shared/schemas/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
    '**/shared/utils/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
    '**/shared/interceptors/**': { statements: 100, branches: 85, functions: 100, lines: 100 },
    '**/shared/guards/**': { statements: 100, branches: 85, functions: 100, lines: 100 },
    '**/infrastructure/cache/**': { statements: 100, branches: 90, functions: 100, lines: 100 },
  },
};

export default config;
