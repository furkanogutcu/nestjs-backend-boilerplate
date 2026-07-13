import { createMock } from '@golevelup/ts-jest';
import { Controller, Get, INestApplication, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RateLimiterRes } from 'rate-limiter-flexible';
import request from 'supertest';
import { z } from 'zod';

import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { SecurityModule } from '@infrastructure/security/security.module';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { SubjectRateLimiterGuard } from '@shared/guards/subject-rate-limit.guard';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';
import { AppZodValidationPipe } from '@shared/pipes/app-zod-validation.pipe';

@Controller('demo')
class DemoController {
  @Get()
  @ResponseDto({ schema: z.object({ ok: z.boolean() }) })
  ok(): { ok: boolean } {
    return { ok: true };
  }

  @Get('boom')
  boom(): never {
    throw new AppNotFoundException({ resourceName: 'Widget' });
  }
}

describe('App (e2e smoke)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const rateLimitService = createMock<RateLimitService>();
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 1, msBeforeNext: 60000 }));

    const moduleRef = await Test.createTestingModule({
      imports: [SecurityModule],
      controllers: [DemoController],
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
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'api/v' });
    app.getHttpAdapter().getInstance().disable('x-powered-by');

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps successful responses in a data envelope and sets cross-cutting headers', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/demo').expect(200);

    expect(response.body).toEqual({ data: { ok: true } });
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('serves the API under the configured version prefix', async () => {
    await request(app.getHttpServer()).get('/demo').expect(404);
    await request(app.getHttpServer()).get('/api/v1/demo').expect(200);
  });

  it('returns the standard error envelope for an unknown route', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

    expect(response.body.error).toMatchObject({ code: 'resource_not_found' });
  });

  it('formats thrown AppExceptions through the global filter', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/demo/boom').expect(404);

    expect(response.body.error).toMatchObject({ code: 'resource_not_found', message: 'Widget not found.' });
  });
});
