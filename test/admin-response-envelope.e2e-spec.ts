import { createMock } from '@golevelup/ts-vitest';
import { INestApplication, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { FeatureFlagsService } from '@infrastructure/feature-flags/services/feature-flags.service';
import { AdminFeatureFlagsController } from '@modules/admin/feature-flags/admin-feature-flags.controller';
import { AdminRolesController } from '@modules/admin/roles/admin-roles.controller';
import { AdminRolesService } from '@modules/admin/roles/services/admin-roles.service';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';

// ! Controller unit tests never run ResponseInterceptor, so only these cases catch a mismatched @ResponseDto.
describe('Admin response envelopes (e2e)', () => {
  let app: INestApplication;
  const adminRolesService = createMock<AdminRolesService>();
  const featureFlagsService = createMock<FeatureFlagsService>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminRolesController, AdminFeatureFlagsController],
      providers: [
        { provide: AdminRolesService, useValue: adminRolesService },
        { provide: FeatureFlagsService, useValue: featureFlagsService },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'api/v' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serialises a role list into a data envelope', async () => {
    adminRolesService.list.mockResolvedValue([
      {
        role: { id: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789', name: 'support', description: null, isSystem: false },
        permissions: ['users:read'],
      },
    ] as never);

    const response = await request(app.getHttpServer()).get('/api/v1/admin/roles').expect(200);

    expect(response.body).toEqual({
      data: [
        {
          id: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789',
          name: 'support',
          description: null,
          is_system: false,
          permissions: ['users:read'],
        },
      ],
    });
  });

  it('serialises a permission list into a data envelope', async () => {
    adminRolesService.listPermissions.mockResolvedValue([{ name: 'users:read', description: 'List users.' }] as never);

    const response = await request(app.getHttpServer()).get('/api/v1/admin/permissions').expect(200);

    expect(response.body).toEqual({ data: [{ name: 'users:read', description: 'List users.' }] });
  });

  it('serialises a feature flag list into a data envelope', async () => {
    featureFlagsService.list.mockResolvedValue([
      { key: 'new-checkout', enabled: true, description: null, updatedAt: new Date('2026-01-01T00:00:00.000Z') },
    ] as never);

    const response = await request(app.getHttpServer()).get('/api/v1/admin/feature-flags').expect(200);

    expect(response.body).toEqual({
      data: [{ key: 'new-checkout', enabled: true, description: null, updated_at: '2026-01-01T00:00:00.000Z' }],
    });
  });

  it('returns 500 when a route returns something its schema does not describe', async () => {
    adminRolesService.list.mockResolvedValue([{ role: { id: 'not-a-uuid' }, permissions: [] }] as never);

    await request(app.getHttpServer()).get('/api/v1/admin/roles').expect(500);
  });
});
