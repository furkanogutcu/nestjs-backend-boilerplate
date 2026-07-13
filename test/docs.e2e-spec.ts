import { createMock } from '@golevelup/ts-jest';
import { Controller, Get, HttpStatus, INestApplication, Param } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RateLimiterRes } from 'rate-limiter-flexible';
import request from 'supertest';
import { z } from 'zod';

import { versioningConfig } from '@config/app.config';
import { setupDocs } from '@infrastructure/docs/setup-docs';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { SecurityModule } from '@infrastructure/security/security.module';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { SubjectRateLimiterGuard } from '@shared/guards/subject-rate-limit.guard';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';
import { AppZodValidationPipe } from '@shared/pipes/app-zod-validation.pipe';

jest.mock('@scalar/nestjs-api-reference', () => ({
  // eslint-disable-next-line no-restricted-syntax -- Express handler signature is fixed (req, res[, next])
  apiReference: () => (_req: unknown, res: { type: (value: string) => { send: (body: string) => void } }) =>
    res.type('html').send('<!doctype html><html><body><script id="scalar-api-reference"></script></body></html>'),
}));

const itemSchema = z.object({ id: z.string(), name: z.string() });

const DOCS_AUTH = `Basic ${Buffer.from(`${process.env.METRICS_AUTH_USER}:${process.env.METRICS_AUTH_PASSWORD}`).toString('base64')}`;

@Controller('docs-demo')
class DocsDemoController {
  @Get()
  @ResponseDto({ schema: z.object({ ok: z.boolean() }) })
  list(): { ok: boolean } {
    return { ok: true };
  }

  @Get(':id')
  @ResponseDto({ schema: itemSchema, errors: [HttpStatus.NOT_FOUND] })
  findOne(@Param('id') id: string): { id: string; name: string } {
    return { id, name: 'demo' };
  }
}

describe('Docs pipeline (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const rateLimitService = createMock<RateLimitService>();
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 1, msBeforeNext: 60000 }));

    const moduleRef = await Test.createTestingModule({
      imports: [SecurityModule],
      controllers: [DocsDemoController],
      providers: [
        { provide: APP_PIPE, useClass: AppZodValidationPipe },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useClass: SubjectRateLimiterGuard },
        { provide: RateLimitService, useValue: rateLimitService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(contextBuilder);
    app.enableVersioning(versioningConfig);
    setupDocs(app);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('gates the docs behind basic-auth when operator credentials are configured', async () => {
    await request(app.getHttpServer()).get('/api/docs-json').expect(401);
    await request(app.getHttpServer()).get('/api/docs').expect(401);
  });

  it('serves a valid OpenAPI spec at /api/docs-json with the versioned paths', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .set('Authorization', DOCS_AUTH)
      .expect(200);

    expect(response.body.openapi).toMatch(/^3\./);
    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/docs-demo', '/api/v1/docs-demo/{id}']),
    );
  });

  it('documents only the cross-cutting errors by default, with accurate per-status codes', async () => {
    const { body: spec } = await request(app.getHttpServer())
      .get('/api/docs-json')
      .set('Authorization', DOCS_AUTH)
      .expect(200);
    const list = spec.paths['/api/v1/docs-demo'].get;

    expect(list.responses['200'].content['application/json'].schema.properties.data).toBeDefined();
    expect(Object.keys(list.responses)).toEqual(expect.arrayContaining(['200', '400', '429', '500']));
    expect(Object.keys(list.responses)).not.toContain('404');
    expect(list.responses['400'].content['application/json'].schema.properties.error.properties.code.example).toBe(
      'validation_failed',
    );
  });

  it('adds the opted-in 404 with its accurate code on the detail endpoint', async () => {
    const { body: spec } = await request(app.getHttpServer())
      .get('/api/docs-json')
      .set('Authorization', DOCS_AUTH)
      .expect(200);
    const detail = spec.paths['/api/v1/docs-demo/{id}'].get;

    expect(Object.keys(detail.responses)).toContain('404');
    expect(detail.responses['404'].content['application/json'].schema.properties.error.properties.code.example).toBe(
      'resource_not_found',
    );
  });

  it('relaxes CSP on the docs page but keeps it strict on the API', async () => {
    const docs = await request(app.getHttpServer()).get('/api/docs').set('Authorization', DOCS_AUTH).expect(200);
    expect(docs.headers['content-security-policy']).toContain('cdn.jsdelivr.net');

    const api = await request(app.getHttpServer()).get('/api/v1/docs-demo').expect(200);
    expect(api.body).toEqual({ data: { ok: true } });
    expect(api.headers['content-security-policy'] ?? '').not.toContain('cdn.jsdelivr.net');
  });
});
