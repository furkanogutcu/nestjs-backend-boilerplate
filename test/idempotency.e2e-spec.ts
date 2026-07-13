import { createMock } from '@golevelup/ts-jest';
import { Controller, INestApplication, Post } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import request from 'supertest';
import { z } from 'zod';

import { IdempotencyService } from '@infrastructure/idempotency/idempotency.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { SensitiveService } from '@infrastructure/sensitive/sensitive.service';
import { Idempotent } from '@shared/decorators/idempotent.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { IdempotencyPrincipalSource } from '@shared/enums/idempotency-principal-source.enum';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { CacheControlInterceptor } from '@shared/interceptors/cache-control.interceptor';
import { IdempotencyInterceptor } from '@shared/interceptors/idempotency.interceptor';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';
import { AppZodValidationPipe } from '@shared/pipes/app-zod-validation.pipe';

@Controller('idem')
class IdemTestController {
  private counter = 0;

  @Post()
  @Idempotent({ scope: 'test:idem', principalSource: IdempotencyPrincipalSource.Anonymous, responseTtlSeconds: 120 })
  @ResponseDto({ schema: z.object({ value: z.number() }) })
  create(): { value: number } {
    this.counter += 1;

    return { value: this.counter };
  }
}

const KEY = 'a'.repeat(24);

describe('Idempotency (e2e)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let app: INestApplication;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());

    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);

    const moduleRef = await Test.createTestingModule({
      controllers: [IdemTestController],
      providers: [
        IdempotencyService,
        SensitiveService,
        { provide: RedisService, useValue: redisService },
        { provide: APP_PIPE, useClass: AppZodValidationPipe },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(contextBuilder);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
    await container.stop();
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('replays the first response verbatim on a retry with the same key (handler runs once)', async () => {
    const first = await request(app.getHttpServer()).post('/idem').set('Idempotency-Key', KEY).expect(201);
    const second = await request(app.getHttpServer()).post('/idem').set('Idempotency-Key', KEY).expect(201);

    expect(first.body).toEqual({ data: { value: expect.any(Number) } });
    expect(second.body).toEqual(first.body);
    expect(second.headers['cache-control']).toBe('no-store');
  });

  it('computes separately for distinct keys', async () => {
    const a = await request(app.getHttpServer()).post('/idem').set('Idempotency-Key', KEY).expect(201);
    const b = await request(app.getHttpServer()).post('/idem').set('Idempotency-Key', 'b'.repeat(24)).expect(201);

    expect(b.body.data.value).not.toEqual(a.body.data.value);
  });

  it('runs the handler every time when no key is supplied (passthrough)', async () => {
    const first = await request(app.getHttpServer()).post('/idem').expect(201);
    const second = await request(app.getHttpServer()).post('/idem').expect(201);

    expect(second.body.data.value).not.toEqual(first.body.data.value);
  });

  it('rejects an out-of-bounds Idempotency-Key with 400', async () => {
    const response = await request(app.getHttpServer()).post('/idem').set('Idempotency-Key', 'short').expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('rejects a sub-threshold anonymous Idempotency-Key with 400 (entropy floor)', async () => {
    // * 20 chars: below the anonymous entropy floor (>=24).
    const response = await request(app.getHttpServer())
      .post('/idem')
      .set('Idempotency-Key', 'a'.repeat(20))
      .expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('deduplicates concurrent requests with the same key to a single computation', async () => {
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/idem').set('Idempotency-Key', KEY),
      request(app.getHttpServer()).post('/idem').set('Idempotency-Key', KEY),
    ]);

    const statuses = [first.status, second.status].sort();
    expect([
      [201, 201],
      [201, 409],
    ]).toContainEqual(statuses);

    const computedValues = [first, second].filter((r) => r.status === 201).map((r) => r.body.data.value);
    expect(new Set(computedValues).size).toBe(1);

    for (const response of [first, second]) {
      if (response.status === 409) {
        expect(response.body.error).toMatchObject({ code: 'idempotency_request_in_progress' });
      }
    }

    const replay = await request(app.getHttpServer()).post('/idem').set('Idempotency-Key', KEY).expect(201);
    expect(replay.body.data.value).toBe(computedValues[0]);
  });

  it('fails closed with 503 and does not run the handler when Redis is unavailable', async () => {
    const server = app.getHttpServer();
    const before = (await request(server).post('/idem').set('Idempotency-Key', 'c'.repeat(24)).expect(201)).body.data
      .value;

    const getSpy = jest.spyOn(redis, 'get').mockRejectedValue(new Error('connection refused'));
    const failed = await request(server).post('/idem').set('Idempotency-Key', 'd'.repeat(24)).expect(503);
    expect(failed.body.error).toMatchObject({ code: 'service_unavailable' });
    getSpy.mockRestore();

    // * The handler advanced exactly once (the healthy call below), proving the 503 request never ran it.
    const after = (await request(server).post('/idem').set('Idempotency-Key', 'e'.repeat(24)).expect(201)).body.data
      .value;
    expect(after).toBe(before + 1);
  });
});
