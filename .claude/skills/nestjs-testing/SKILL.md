---
name: nestjs-testing
description: >-
  Write reliable, industry-standard tests for this NestJS backend — unit, integration
  (Testcontainers) and e2e (supertest). Use when adding or changing a service, controller, guard,
  interceptor, pipe, exception filter, param decorator, Zod schema, util, repository extension, or a
  Kafka/BullMQ/mail component, or when setting up coverage. Covers the project's exact patterns
  (AppException hierarchy, Zod response envelope, @test/helpers factories, env-on-import rule,
  determinism rules); generated tests stay consistent with the existing suite.
---

# NestJS tests

This project's tests are **`*.spec.ts` files co-located with the source** and run with Jest + ts-jest.
The entire `shared` contract layer is at ~100% coverage and the suite is fully deterministic (no real
network, DB, Redis, Kafka, or SMTP in unit specs). Keep it that way.

Before writing a test, look at the relevant recipe in `references/recipes-by-type.md` — there's a
copy-paste example for every unit type in the repo.

## The one rule you can't skip: env-on-import

`src/config/env.config.ts` validates `process.env` at import time and calls `process.exit(1)` on
failure. Because nearly every infrastructure module transitively imports `env`, **importing one of them
inside a spec crashes the Jest worker when there is no valid env.** `test/jest.env-setup.ts`
(a Jest `setupFiles` entry) guarantees this. Consequences:

- Never do `import { env } from '@config/env.config'` in a spec just to read config. To test env
  validation, test `ENVSchema` directly from `@config/env.schema` (see
  `src/config/env.schema.spec.ts`).
- If you need to change `env` for a unit (e.g. `SENTRY_DSN`, Kafka SASL), use
  `jest.mock('@config/env.config', ...)` with a mutable object — see `global.filter.spec.ts` and
  `base-kafka-service.abstract.spec.ts`.

Full rationale + fake-timer / seeded-random / luxon rules: `references/env-and-determinism.md`.

## Testing philosophy

**Coverage is an outcome, not a goal.** Don't write tests to hit a threshold; every test must catch a
behavior or a regression. Before writing (or deleting) a test, ask: _"if I delete this, which real bug
goes unnoticed?"_ If the answer is "none," the test is worthless — don't write it. Conversely, **every
meaningful scenario** of each unit (error paths, branches, boundary values) must be tested; the
happy path alone is not enough.

For a repo at the infrastructure stage, a top-light pyramid:

- **~85% unit** — pure logic and classes with mocked dependencies. Default: plain `new Service(mockA, mockB)`.
- **~10% integration** — for the 3-4 units whose only job is to talk to infrastructure, against real
  Redis/Postgres via Testcontainers (`*.integration-spec.ts`). Do **not** write an integration test
  for logic a mock fully covers.
- **~5% e2e smoke** — a single bootstrap, asserting the cross-cutting HTTP contract (supertest).

For what genuinely needs infrastructure vs. what a mock covers, see `references/integration-e2e.md`.

## How to construct the unit under test

Prefer plain instantiation — in this repo every injection is a plain constructor parameter:

| Unit type                                                     | How to construct                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| util / Zod schema / exception class                           | call / `new` directly                                         |
| service, guard, interceptor, pipe, filter, health indicator   | `new X(mockDep, ...)`                                         |
| param decorator (`Pagination`, `Search`, `OrderBy`)           | `getParamDecoratorFactory(Decorator())` then call the factory |
| controller using `@Res()`                                     | `new Controller(...mocks)`, assert on the mocked `Response`   |
| abstract base (`BaseQueueProducer`, `BaseEventConsumer`, ...) | a small concrete subclass inside the spec                     |

Only reach for `Test.createTestingModule` in integration/e2e where you want a real graph wiring.

## Mocking

For fat interfaces (`Redis`, `Response`, `ExecutionContext`, `Reflector`, TypeORM
`Repository`/`DataSource`, terminus services) use `@golevelup/ts-jest`'s `createMock<T>()`. It
auto-stubs every method as a typed `jest.fn()` — no `as any` (ESLint already forbids it). On top of
that, use the shared factories in **`@test/helpers`** (`createMockRequest/Response`,
`createMockExecutionContext`, `createMockArgumentsHost`, `createMockReflector`, `createCallHandler`,
`createMockRedis`, `createMockRepository/DataSource`, `getParamDecoratorFactory`). Signatures:
`references/helpers.md`.

## Conventions

- **AAA**: Arrange / Act / Assert, separated by a blank line.
- **`describe`** names the unit under test; one `describe` nests per method. **`it`** is
  behavior-focused, in the present tense, no "should": `it('returns null when the key is missing')`.
- Import helpers via the `@test/*` alias, never via a deep relative path.
- Spec files follow the same ESLint rules as the source (no `any`, no floating promise, import-sort,
  `return await`). `await expect(p).rejects.toThrow(...)` — never leave a floating promise.
- One spec file per source file, co-located. Parametrize repeated scenarios with `it.each` /
  `describe.each` (see `simple-exceptions.spec.ts`, `nestjs.exception-transformer.spec.ts`).

## Determinism (mandatory rules)

- `jest.useFakeTimers()` for anything that touches `setTimeout`/`Date.now` (sleep, exponential-retry,
  Kafka reconnect, metrics interceptor, context middleware). Advance with `advanceTimersByTimeAsync`.
- Fix randomness: `jest.spyOn(Math, 'random').mockReturnValue(0.5)` before asserting jitter.
- For timestamps, `jest.setSystemTime(new Date('2026-01-01T00:00:00Z'))`; luxon is pinned to UTC in
  `test/jest.setup.ts`.
- `clearMocks` + `restoreMocks` are on globally — undo the timers you set up in `afterEach`.

## Coverage

- Run `pnpm test:cov`. The thresholds in `jest.config.ts` are a **regression floor, not a target** — the
  real value is ~100% statement/line.
- Branch floors are intentionally below statement floors: `emitDecoratorMetadata` generates
  `__param`/`__metadata` helpers for every injected constructor and istanbul counts their branches as
  uncoverable. **Don't distort tests to chase these branches.**
- The contract layer (`shared/exceptions`, `pipes`, `schemas`, `utils`) is kept at 100% branch, because
  these files have no injected constructor. New code here must preserve 100%.
- Bootstrap/wiring/data (`main.ts`, `*.module.ts`, `*.config.ts`, `env.config.ts`, data-source,
  migrations, `redis.service.ts`) is intentionally out of coverage — testing it is tautological.
  Rationale: `references/env-and-determinism.md`.

## Worthless test or meaningful test?

**Test name == the scenario tested (non-negotiable):** if the `it('...')` description asserts a
scenario, the test must actually **run** that scenario. If the scenario's logic is **inside** the unit
under test and the test mocks it away, the test isn't testing that scenario — it's a mislabeled,
worthless test. Example anti-pattern: a controller calls `service.getX()` and wraps `{ x }`; a test
named "returns 0 when there is no account" has `getX` mocked to return `0` directly — since the
"no account → 0" logic lives inside the **service**, the controller test never runs it (that scenario is
tested in the service spec). If you write a scenario, set up the **input** that triggers it and assert
the **output/effect**; don't write another layer's job under your own name. When you see such a test:
either make it actually test that scenario, delete it (if it is tested elsewhere), or fix its name to
match what it actually tests.

**Don't write (worthless):**

- A test whose name doesn't run the behavior it claims (rule above) — the mock swallows the core of the scenario.
- Tests that only verify the constructor or `instanceof` — if the class has no custom logic
  (e.g. an empty TypeORM repository subclass), this test is equivalent to saying "a new object exists."
- Tests that assert a mock's default behavior: `expect(mock).not.toHaveBeenCalled()` alone is not a
  scenario — it's only meaningful when tied to a real "must not call" branch (public route, idempotency
  short-circuit, early `return`).
- A twin test that reruns the same code path with only a different return value — if it adds no branch, one test is enough.
- Re-testing the behavior of a 3rd-party like Zod / TypeORM / Nest (test which fields _your_ schema
  accepts/rejects, not Zod's `min`/`max`).

**Do write (mandatory):**

- Every `throw` and every reachable `catch`.
- Every `if/else`, ternary, and `?? fallback` branch.
- Boundary values: empty string, `null`/`undefined`, the `== now` equality boundary, `max + 1` length.
- External dependency error **and timeout** paths (fetch timeout, Redis down, DB error).
- Security-critical orderings (e.g. nonce `verify → consume → resolve`).

## Anti-patterns / pre-commit checklist

- [ ] No real network / Redis / Postgres / Kafka / SMTP inside a `*.spec.ts`.
- [ ] No `as any`; use `createMock<T>()` or a typed `@test/helpers` factory.
- [ ] Don't assert log message strings as a contract — assert _whether_ `logger.error`/`warn` was called.
- [ ] Don't test framework internals (whether it called the Nest handler) — test _your own_ branches.
- [ ] Error paths covered: every `catch`, every `?? fallback`, every `instanceof` ternary you can reach
      without imitating framework internals.
- [ ] `pnpm lint` and `pnpm typecheck` pass for the spec (ts-jest transpiles only via `isolatedModules`,
      so **the thing that type-checks your specs is `pnpm typecheck`** — run it).
- [ ] Every `it('...')` name describes the scenario the test **actually runs** — the asserted logic
      isn't mocked away (name == scenario-tested rule).
- [ ] Co-located, AAA, behavior-named, deterministic.
