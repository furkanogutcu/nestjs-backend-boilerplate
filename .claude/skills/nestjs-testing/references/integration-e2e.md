# Integration and e2e

Two opt-in Vitest projects, separate from the fast unit run — so `pnpm test` never needs Docker:

- `pnpm test:integration` → `vitest.integration.config.ts`, matches `*.integration-spec.ts`.
- `pnpm test:e2e` → `vitest.e2e.config.ts`, matches `*.e2e-spec.ts`.

Both reuse the env-setup/setup files and the `@test/*` alias. Both require a Docker daemon
(Testcontainers). CI runs them in a job separate from the unit job.

## What goes into integration (real infrastructure), and what stays out of unit

Write an integration test **only** when a mock would lie about the behavior:

- `CacheService` against real Redis — SCAN cursor loop, `unlink` chunking, `setex` TTL semantics.
- `RateLimitService` / `RateLimiterRedis` against real Redis — atomic consume + block behavior.
- `Repository.listWithPagination` against real Postgres — `findAndCount` pagination on a real driver.
- `DatabaseService.runInTransaction` against real Postgres — rollback on throw is the whole point of it.

Everything else (exceptions, transformers, filter, interceptors, pipe, guard logic, schemas, utils,
crypto, kafka producer/consumer wiring) is better and faster as a mocked unit test.

## Integration pattern (Testcontainers)

Start an ephemeral container in `beforeAll`, connect a **real** client directly to it (bypassing the
`env` frozen at import), tear it down in `afterAll`. Use a generous `testTimeout` (set to 60s in
`vitest.integration.config.ts`).

```ts
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

let container: StartedRedisContainer;
let redis: Redis;

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start();
  redis = new Redis(container.getConnectionUrl());
});

afterAll(async () => {
  redis.disconnect();
  await container.stop();
});

// Inject the real client only by faking getClient():
const redisService = createMock<RedisService>();
redisService.getClient.mockReturnValue(redis);
const cache = new CacheService(new SensitiveService(), redisService);
```

For Postgres, use `PostgreSqlContainer`; build a `DataSource` with `container.getConnectionUri()`,
`synchronize: true`, and a throwaway entity, `initialize()` in `beforeAll`, `destroy()` in `afterAll`.

## E2E smoke (supertest)

Bootstrap the app's real global wiring (the providers `AppModule` registers — global pipe, exception
filter, response + metrics interceptors, rate-limit guard — plus security middleware and URI
versioning) with a small test controller, then assert the cross-cutting HTTP contract that unit tests
can't:

- `GET /health` → 200 `{ status: 'ok' }`.
- Unknown route → standard error envelope `{ error: { code, message, ... } }` (proves the global filter is registered).
- A successful endpoint returns a `{ data: ... }` envelope (proves the response interceptor).
- Security headers present (HSTS `max-age=31536000; includeSubDomains`), no `x-powered-by`.
- Rate-limit headers present on a guarded route.

Keep the e2e count small — it verifies wiring, not business rules.
