# Env and determinism

## Why `test/env-setup.ts` exists (and why it runs first)

`src/config/env.config.ts`:

```ts
const parsed = ENVSchema.safeParse(process.env);
if (!parsed.success) { console.error(...); process.exit(1); }
export const env = deepFreeze(parsed.data);
```

This code runs **at import time**. `RedisService`, `SensitiveService`, `MailService`,
`BaseKafkaService`, the logger module, the global filter, etc. all transitively import `env` — so the
moment a spec imports one of them, env validation runs. If there is no valid `process.env`, the worker
calls `process.exit(1)` and the suite dies with a confusing error.

`test/env-setup.ts` is registered as a Vitest `setupFiles` entry (it runs before the module registry
loads any source) and fills in a syntactically valid env (`NODE_ENV=test`, postgres/redis URLs, a
64-hex `ENCRYPTION_KEY`, etc.). It uses `??=`, so integration runs can override values from the shell.

### Testing or changing env itself

- To test the validation rules, import **`ENVSchema` from `@config/env.schema`** and call
  `safeParse` — never import `env.config`. See `src/config/env.schema.spec.ts`.
- To change a single value for a unit (e.g. `SENTRY_DSN`, `KAFKA_SASL_MECHANISM`), mock the module:

  ```ts
  vi.mock('@config/env.config', () => ({ env: { SENTRY_DSN: undefined /* ... */ } }));
  import { env } from '@config/env.config';
  (env as { SENTRY_DSN?: string }).SENTRY_DSN = 'https://...'; // change per test, reset in beforeEach
  ```

  Examples: `global.filter.spec.ts`, `base-kafka-service.abstract.spec.ts`.

## `test/setup.ts` (`setupFilesAfterEnv`)

`import 'reflect-metadata'` (needed for `emitDecoratorMetadata` output when classes are created with a
plain `new`) and `Settings.defaultZone = 'utc'` (mirrors `main.ts`, keeps luxon deterministic).

## Determinism rules

- **Timers**: `vi.useFakeTimers()` when the code calls `setTimeout`/`Date.now`. Drive async flows
  with `await vi.advanceTimersByTimeAsync(ms)`. Undo it with `vi.useRealTimers()` in the test or in
  `afterEach`.
- **Randomness**: `vi.spyOn(Math, 'random').mockReturnValue(0.5)` before asserting jittered values.
- **System time**: `vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))` when asserting a timestamp
  (e.g. `context-builder.middleware.spec.ts`).
- `clearMocks` + `restoreMocks` are on in `vitest.config.ts`, so call counters and spies reset
  automatically between tests — but you still undo fake timers yourself.

## Coverage exclusions and their rationale

`collectCoverageFrom` in `vitest.config.ts` intentionally excludes:

- `main.ts`, `instrument.ts`, `**/*.module.ts` — bootstrap/wiring. Testing these means "Nest is
  configured the way the code configured it": tautological and brittle. The e2e smoke proves the app
  boots — that's the right level.
- `config/env.config.ts` — calls `process.exit` on import; the real logic is in `env.schema.ts` and it
  **is** covered.
- `infrastructure/redis/redis.service.ts` — opens live ioredis connections in its constructor; covered
  in the integration suite instead.
- `**/*.config.ts`, `*.interface.ts`, `*.enum.ts`, `*.constant.ts`, `*.declaration.ts`, barrels,
  migration/seed/scripts, data-source — static data / type-only / generated.

Branch thresholds are below statement thresholds because TypeScript's `emitDecoratorMetadata` adds
`__param`/`__metadata` helper branches that istanbul can't cover to every DI-injected constructor. Files
without an injected constructor (`shared/exceptions`, `pipes`, `schemas`, `utils`) stay at 100% branch and
must stay that way.
