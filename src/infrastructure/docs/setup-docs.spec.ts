import { createMock } from '@golevelup/ts-jest';
import { INestApplication } from '@nestjs/common';

import { buildOpenApiDocument } from './openapi.factory';
import { setupDocs } from './setup-docs';

const mockEnv: { NODE_ENV: string } = { NODE_ENV: 'development' };

jest.mock('@config/env.config', () => ({
  get env() {
    return mockEnv;
  },
}));

jest.mock('./openapi.factory', () => ({ buildOpenApiDocument: jest.fn() }));

jest.mock('@scalar/nestjs-api-reference', () => ({ apiReference: jest.fn(() => jest.fn()) }));

describe('setupDocs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
