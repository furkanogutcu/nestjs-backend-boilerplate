# Recipes by unit type

Copy-paste starting points. Each mirrors a real spec in the repo — open that spec for all scenarios.

## Service with mocked dependencies — `cache.service.spec.ts`

```ts
import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Redis } from 'ioredis';
import { createMockRedis } from '@test/helpers';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let redis: DeepMocked<Redis>;
  let service: CacheService;

  beforeEach(() => {
    redis = createMockRedis();
    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    service = new CacheService(createMock<SensitiveService>(), redisService);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); // assert it was called, not its text
  });

  it('returns null and logs when redis throws', async () => {
    redis.get.mockRejectedValue(new Error('connection lost'));
    await expect(service.get('orders')).resolves.toBeNull();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
```

## Exception filter — `global.filter.spec.ts`

`new GlobalExceptionFilter()`, drive it with `createMockArgumentsHost({ request, response })`, read the
body back from `response.json.mock.calls.at(-1)?.[0]`. Mock `@sentry/nestjs` and `@config/env.config`
(for the `SENTRY_DSN` traceId branches). Cover: `headersSent` early return, the full `toAppException`
chain, transformer→internal fallbacks, Sentry capture, header redaction, and the catch-block fallback
(`response.json.mockImplementationOnce(() => { throw ... })`).

## Interceptor — `response.interceptor.spec.ts`, `metrics.interceptor.spec.ts`

```ts
import { lastValueFrom } from 'rxjs';
import { createCallHandler, createMockExecutionContext, createMockReflector } from '@test/helpers';

const result = await lastValueFrom(
  new ResponseInterceptor(createMockReflector(schema)).intercept(
    createMockExecutionContext(),
    createCallHandler(payload),
  ),
);
```

For error paths, `createCallHandler(new Error('boom'))` makes `handle()` emit an error; assert with
`await expect(lastValueFrom(...)).rejects.toThrow('boom')`.

## Pipe — `app-zod-validation.pipe.spec.ts`

`new AppZodValidationPipe(schema)` and `pipe.transform(value, { type: 'body' })`. To reach the rethrow
branches, spy on `ZodValidationPipe.prototype.transform` and throw a non-Zod error, or throw a
`ZodValidationException` whose `getZodError()` is stubbed to a non-ZodError value.

## Guard — `rate-limit.guard.spec.ts`

`new RateLimiterGuard(createMockReflector(rule), rateLimitService)`. Pass the rule via the reflector;
assert the headers on the mocked `Response` and verify that `AppTooManyRequestException` is thrown when
the service rejects with a real `new RateLimiterRes(...)` (don't mock `rate-limiter-flexible` here —
`instanceof` must work).

## Param decorator — `pagination/search/order-by.decorator.spec.ts`

Extract the factory and call it directly:

```ts
import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

const factory = getParamDecoratorFactory(Search<Product>(['name'])); // pass the *applied* decorator
const ctx = createMockExecutionContext({ request: createMockRequest({ query: { q: 'wheat' } }) });
factory(undefined, ctx);
```

`Pagination` is used as `@Pagination()` → pass `Pagination()`. `Search`/`OrderBy` are factories →
pass `Search(['name'])`. Assert the TypeORM `FindOperator` via its public getters: `.type`,
`.objectLiteralParameters`, `.getSql?.(alias)`.

## Zod schema — `*.schema.spec.ts`

Call `.parse` for happy paths, `.safeParse(...).success === false` for rejections; use `it.each` for the
rejection table. Assert defaults, coercion, `.max()` upper bounds, and `.transform()` output.

## Controller using `@Res()` — `health.controller.spec.ts`

`new Controller(...mocks)`, pass `createMockResponse()`, assert `response.status(...).json(...)` —
never a return value. To run the indicator lambdas inside `healthCheckService.check([...])`, give the
mock an implementation that calls them: `check.mockImplementation(async (fns) => {
await Promise.all(fns.map(async (fn) => await fn())); return {} as HealthCheckResult; })`.

## Health indicator — `redis.health-indicator.spec.ts`

Stub `healthIndicatorService.check(key)` to return an object with `up`/`down` vi.fn's; drive
`redisService.getClient().ping()` to `'PONG'` / another value / reject and assert which one is called.

## Util with timers — `exponential-retry.util.spec.ts`, `sleep.util.spec.ts`

Use `vi.mock('./sleep.util')` (or fake timers) + `vi.spyOn(Math, 'random').mockReturnValue(0.5)` so
that backoff delays are exact (deterministic). Assert the delays with `sleepMock.mock.calls.map((c) => c[0])`.

## Abstract base via subclass — `base-queue.producer.spec.ts`, `base-event-consumer.abstract.spec.ts`

Inside the spec, define a minimal concrete subclass that implements the abstract members and exposes the
protected method you need, then test through it.

## Kafka / external clients — `kafka-producer.service.spec.ts`, `kafka-consumer.service.spec.ts`

Spy on the kafkajs prototype: `vi.spyOn(Kafka.prototype, 'producer').mockReturnValue(producerMock)`.
For reconnect logic, use fake timers and `advanceTimersByTimeAsync(5000)`. To test message mapping,
extract the `eachMessage` callback from `consumer.run.mock.calls[0][0]`.
