import { resolve } from 'node:path';

import swc from 'unplugin-swc';

const root = process.cwd();

// * Mirrors tsconfig `paths`; keep the two in sync.
export const alias = {
  '@config': resolve(root, 'src/config'),
  '@shared': resolve(root, 'src/shared'),
  '@infrastructure': resolve(root, 'src/infrastructure'),
  '@modules': resolve(root, 'src/modules'),
  '@database': resolve(root, 'src/database'),
  '@test': resolve(root, 'test'),
};

// ! NestJS resolves constructor dependencies from `emitDecoratorMetadata`, which Vitest's default esbuild
// ! transform drops. SWC keeps it — without this plugin every DI-backed test fails to instantiate.
export const swcPlugin = swc.vite({ module: { type: 'es6' } });

export const setupFiles = [resolve(root, 'test/env-setup.ts'), resolve(root, 'test/setup.ts')];
