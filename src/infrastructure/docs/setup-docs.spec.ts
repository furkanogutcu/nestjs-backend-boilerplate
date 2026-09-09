import { createMock } from '@golevelup/ts-vitest';
import { INestApplication } from '@nestjs/common';

import { buildOpenApiDocument } from './openapi.factory';
import { setupDocs } from './setup-docs';

const mockEnv: { NODE_ENV: string } = { NODE_ENV: 'development' };

vi.mock('@config/env.config', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('./openapi.factory', () => ({ buildOpenApiDocument: vi.fn() }));

vi.mock('@scalar/nestjs-api-reference', () => ({ apiReference: vi.fn(() => vi.fn()) }));

describe('setupDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not mount the docs surface in production', () => {
    mockEnv.NODE_ENV = 'production';
    const app = createMock<INestApplication>();

    setupDocs(app);

    expect(buildOpenApiDocument).not.toHaveBeenCalled();
    expect(app.use).not.toHaveBeenCalled();
  });

  it('mounts the docs surface outside production', () => {
    mockEnv.NODE_ENV = 'development';
    const app = createMock<INestApplication>();

    setupDocs(app);

    expect(buildOpenApiDocument).toHaveBeenCalled();
    expect(app.getHttpAdapter().get).toHaveBeenCalled();
    expect(app.use).toHaveBeenCalled();
  });
});
