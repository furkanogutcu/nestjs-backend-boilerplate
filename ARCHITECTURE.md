# Architecture

This document has three parts: **(1) Conventions** — where and how code is written (consulted on every
change); **(2) Infrastructure design** — how and why the database, authorisation, audit and storage layers are built;
**(3) Process** — release and versioning.

## Table of contents

**Part 1 — Conventions**

- Directory structure · Layer responsibilities · Domain module template · What goes where
- Background jobs (BullMQ) · Tests
- Naming conventions · Path aliases · Import ordering · Code style · API documentation · Postman collection (Portman)

**Part 2 — Infrastructure design**

- Database infrastructure — Postgres, connection routing, backups/PITR, WAL/replica, observability
- Authorisation — permissions as code, roles as data, the permission cache
- Audit log — what is recorded, the append-only grant, retention
- Object storage — signed uploads, public/private prefixes
- Graceful shutdown — the drain sequence

**Part 3 — Process**

- Releases and versioning

> Note: Part headings are for navigation; the dependency flow between parts does not change
> (`modules → infrastructure → shared → config`).

---

# Part 1 — Conventions

> Where and how code is written. Every new piece of code follows these.

## Directory structure

```
src/
├─ main.ts  app.module.ts  instrument.ts
├─ config/            # static config objects + env loading/validation
├─ shared/            # pure, framework-level building blocks (no business logic, minimal DI)
│   ├─ decorators/  pipes/  guards/  interceptors/  middlewares/
│   ├─ exceptions/   # exception classes + enums/ + filters/ + transformers/ + interfaces/
│   ├─ responses/  utils/  interfaces/  declarations/
│   ├─ enums/        # cross-cutting enums
│   ├─ constants/    # cross-cutting constants
│   └─ schemas/      # cross-cutting Zod schemas (pagination, search, order-by)
├─ infrastructure/    # DI modules wrapping technical capabilities / external systems
│   ├─ database/  redis/  cache/  queues/  mail/  storage/  audit/  feature-flags/
│   ├─ logger/  observability/  security/  rate-limit/  health/  sensitive/  lifecycle/
│   └─ infrastructure.module.ts   # aggregates and re-exports the infra modules
├─ modules/           # ONLY business / domain modules (users, auth, ...)
└─ database/          # datasource, migration, strategy, script, repo extension
```

> Empty folders are tracked with `.gitkeep`; when a folder gains a real file, the `.gitkeep` is deleted.

## Layer responsibilities

| Layer             | Contains                                                                                                               | Has DI?              | Depends on                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------ |
| `config/`         | Plain config objects, env schema/validation                                                                            | No                   | nothing application-specific         |
| `shared/`         | Decorators, pipes, filters, guards, interceptors, exceptions, utils, response wrappers, shared enums/constants/schemas | Mostly none          | `config`                             |
| `infrastructure/` | Technical capability modules (db, redis, cache, queues, mail, storage, audit, feature flags, observability, security…) | Yes                  | `config`, `shared`                   |
| `modules/`        | Domain features                                                                                                        | Yes                  | `config`, `shared`, `infrastructure` |
| `database/`       | TypeORM datasource, migrations, strategy, repo extension                                                               | No (open to the CLI) | `config`                             |

Dependencies flow one way: `modules → infrastructure → shared → config`. Never the reverse.

## Domain module template

A **single NestJS module** per domain. The main files (`*.module.ts`, controller) sit flat at the module
root; collections are moved into subfolders **only as the need arises**. Sub-features (e.g. `profile`)
have their own controller/service in a subfolder of the same module — **they do not get their own NestJS module**.

**Service and repository threshold:** A single service + single repository may sit flat at the module root
(the simple `users` example below). When a module grows to **2+ services** or **2+ repositories**, all of
them are **gathered** into `services/` and `repositories/` subfolders respectively (the root retains only
`*.module.ts` + controller). All of them are moved, including the primary service — there is no
"which one is primary" decision.

```
modules/users/
├─ users.module.ts            # single module; registers everything below (including profile.*)
├─ users.controller.ts
├─ users.service.ts
├─ users.repository.ts
├─ entities/user.entity.ts
├─ schemas/
│   ├─ create-user.request.ts
│   ├─ update-user.request.ts
│   └─ user.response.ts
├─ enums/  constants/  interfaces/    # domain-specific (when needed)
├─ jobs/                      # BullMQ producers/processors for this domain
├─ subscribers/               # TypeORM subscribers for this domain's entities
└─ profile/                   # sub-feature (same module)
    ├─ profile.controller.ts
    ├─ profile.service.ts
    └─ schemas/
        ├─ update-profile.request.ts
        └─ profile.response.ts
```

When a module grows (2+ services/repositories) it is gathered with `services/` and `repositories/`; if a
sub-feature has its own set of services, the same rule applies within it (e.g. `auth`):

```
modules/auth/                   # grown module: multiple services + multiple repositories
├─ auth.module.ts
├─ auth.controller.ts
├─ services/                    # all of the module's services (including the primary)
│   ├─ auth.service.ts
│   ├─ session.service.ts
│   ├─ revocation.service.ts
│   └─ token.service.ts
├─ repositories/                # all of the module's repositories
│   ├─ users.repository.ts
│   ├─ sessions.repository.ts
│   └─ oauth-accounts.repository.ts
├─ entities/  schemas/  enums/  constants/  interfaces/  guards/  decorators/  utils/
└─ oauth/                       # sub-feature (own controller; a set of services inside)
    ├─ oauth.controller.ts
    ├─ services/                #   oauth.service + provider verifiers
    └─ certs/
```

**When it is a separate module rather than a subfolder:** only for a separate bounded context — its own
entities, its own lifecycle, something that could reasonably turn into a separate service (e.g. `auth`,
`notifications`, `billing`). Profile is part of the user domain, so it stays inside `users`.

## Cross-cutting providers (guard / interceptor / pipe / filter) registration

Global cross-cutting providers (`APP_GUARD` / `APP_INTERCEPTOR` / `APP_PIPE` / `APP_FILTER`)
are **global in effect** (Nest applies them to all routes regardless of which module declares them),
but the **class is instantiated in the DI context of the module that declares it**. There is therefore
**no** rule that "everything goes in `app.module.ts`" — it conflicts with NestJS's DI model, and moving a
provider that depends on a bounded context's internal services to the root module would force those
services to be **exported (an encapsulation leak)**.

**Execution order at two levels:**

- **Type level (fixed, never mixes):** `Middleware → Guards → Interceptors(pre) → Pipes → Handler →
Interceptors(post) → Filters`. The registration location does not change this.
- **Within the same type (implicit):** the relative order of multiple global guards/interceptors depends,
  for APP\_\*, on **module resolution order** → the order of same-type providers spread across different
  modules **cannot be relied upon**.

**Rule — what determines the order determines the placement:**

| Case                                                                                                            | Registration location                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Order-coupled** (its correctness depends on its order relative to others of the same type)                    | **`app.module.ts`**, in a single contiguous array, with **explicit order**; annotate the position with a comment |
| **Order-independent** (its position in the chain does not change the result) **and** feature-internal dependent | in the owning **feature module** (DI/encapsulation); APP\_\* still promotes to global                            |
| App-wide, dependencies only on `shared`/`infrastructure`                                                        | `app.module.ts` (class file in `shared/<type>s/`)                                                                |

The class file always sits under the owning module's `interceptors/`/`guards/`/… (or `shared/` if
app-wide), as `kebab-case.<type>.ts`. **Never spread an order-coupled one across modules** — the risk of a
mix-up arises structurally from exactly that, and the rule prevents precisely this.

**Global provider registry (authoritative list — update this when adding a new global provider):**

| Provider                  | Type        | Registration location (order) | Order dependency                                                           |
| ------------------------- | ----------- | ----------------------------- | -------------------------------------------------------------------------- |
| `AppZodValidationPipe`    | pipe        | `app.module` (1)              | single                                                                     |
| `GlobalExceptionFilter`   | filter      | `app.module` (1)              | single                                                                     |
| `MetricsInterceptor`      | interceptor | `app.module` (1)              | order-coupled (outermost: measures the entire request)                     |
| `CacheControlInterceptor` | interceptor | `app.module` (2)              | order-coupled — establishes the no-store default before idempotency replay |
| `ResponseInterceptor`     | interceptor | `app.module` (3)              | order-coupled                                                              |
| `IdempotencyInterceptor`  | interceptor | `app.module` (4)              | order-coupled                                                              |
| `RequireHttpsGuard`       | guard       | `app.module` (1)              | **order-coupled** — before auth                                            |
| `IpRateLimiterGuard`      | guard       | `app.module` (2)              | **order-coupled** — before auth (IP)                                       |
| `AuthGuard`               | guard       | `app.module` (3)              | **order-coupled** — establishes `request.user`                             |
| `SubjectRateLimiterGuard` | guard       | `app.module` (4)              | **order-coupled** — after auth (subject)                                   |

> The guard chain order is critical and is protected by `test/rate-limit-ordering.e2e-spec.ts`.

## What goes where

| Item                                                                                                     | Location                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Controller / module                                                                                      | `modules/<x>/` (root)                                                                            |
| Service / repository                                                                                     | if single, `modules/<x>/` (root); if 2+, `modules/<x>/services/` and `modules/<x>/repositories/` |
| DB entity, TypeORM subscriber                                                                            | `modules/<x>/entities/`, `modules/<x>/subscribers/`                                              |
| Domain request/response schemas                                                                          | `modules/<x>/schemas/`                                                                           |
| Domain enum / constant / interface                                                                       | `modules/<x>/{enums,constants,interfaces}/`                                                      |
| Concrete BullMQ producer + processor                                                                     | the owner's `jobs/` folder — `modules/<x>/jobs/` or `infrastructure/<cap>/jobs/`                 |
| Queue name registration                                                                                  | `shared/enums/queue.enum.ts` (`AppQueue`)                                                        |
| A permission a route enforces                                                                            | `modules/auth/rbac/permission.enum.ts` (then grant it to a role from the admin API)              |
| An auditable action                                                                                      | `infrastructure/audit/audit-action.enum.ts`                                                      |
| Reusable building block (decorator, pipe, filter, guard, interceptor, exception, util, response wrapper) | `shared/`                                                                                        |
| Cross-cutting Zod schema (pagination, search, order-by)                                                  | `shared/schemas/`                                                                                |
| Cross-cutting enum / constant (used by ≥2 layers/modules)                                                | `shared/enums/`, `shared/constants/`                                                             |
| Enum / constant specific to a single infra capability (e.g. storage prefixes, audit actions)             | that capability's module — `infrastructure/<cap>/{enums,constants}/`                             |
| Technical capability module + base classes (queue producers, scheduled processors, abstracts)            | `infrastructure/`                                                                                |
| Static config / env                                                                                      | `config/`                                                                                        |
| Datasource, migration, strategy, repo extension                                                          | `database/`                                                                                      |
| Domain/capability ops script (+ DI bootstrap context)                                                    | the owner's `scripts/` folder — `modules/<x>/scripts/` or `infrastructure/<cap>/scripts/`        |

Practical rule: the **mechanism** (mail sender, queue registration, storage client, base producer/processor)
lives under `infrastructure/`; its **domain usage** (which job, which permission, which template) lives inside
the relevant domain module.

Rule for enum/constant location: those that are genuinely **cross-cutting** (consumed by ≥2 layers or ≥2
modules) stay in `shared/`; types used by **only a single infra capability** live in that capability's
module (module cohesion increases, `shared/` does not bloat). E.g. `StorageVisibility` and the storage key
prefixes live under `infrastructure/storage/` — only storage uses them. Counter-example:
`AppQueue` (`shared/enums/queue.enum.ts`) stays in `shared/` because it is registered by both infra and
domain modules (a single queue-name registry).

## Background jobs (BullMQ)

- The queue **framework** lives under `infrastructure/queues/`: the Bull connection, `BaseQueueProducer`,
  and two scheduled processor bases — `BaseScheduledProcessor` (with a cron pattern; e.g. prune jobs) and
  `BaseIntervalProcessor` (with a fixed `intervalMs` tick).
- Queue **names** are defined in a single place, `shared/enums/queue.enum.ts` (`AppQueue`) — a single
  registration, ensuring no collisions in the global Redis namespace and that every queue is discoverable.
- A queue's concrete **producer + processor live together in the `jobs/` folder of that queue's owner**;
  the module that registers the queue also provides those two (`BullModule.registerQueue`):
  - infra capability → `infrastructure/<cap>/jobs/` (e.g. `infrastructure/mail/jobs/`)
  - domain feature → `modules/<x>/jobs/`

## Tests

- **Unit**: co-located `*.spec.ts` next to the file under test (NestJS default).
  E.g. `modules/users/users.service.spec.ts`, `modules/users/profile/profile.controller.spec.ts`.
  Picked up by `vitest.config.ts` (`include: src/**/*.spec.ts`).
- **Integration**: co-located `*.integration-spec.ts`, run against real Postgres/Redis containers via
  `vitest.integration.config.ts`.
- **End-to-end**: `test/*.e2e-spec.ts` via `vitest.e2e.config.ts`; because e2e runs the entire HTTP app.
- Shared e2e helpers/factories/mocks live under `test/`.

## Naming conventions

- Files: `kebab-case.<type>.ts` — e.g. `users.controller.ts`, `create-user.request.ts`,
  `user.response.ts`, `queue.enum.ts`, `sensitive-headers.constant.ts`, `global.filter.ts`.
- Zod schemas: `*.request.ts` / `*.response.ts` for request/response; `*.schema.ts` for a
  standalone/shared schema.
- Enums under `enums/` (`*.enum.ts`); constants under `constants/` (`*.constant.ts`).
- **Interfaces must start with an `I` prefix** (e.g. `IRateLimitRule`). Enforced by ESLint
  (`@typescript-eslint/naming-convention`). Library interface augmentations (e.g. Express
  `Request`, TypeORM `Repository`) are exempt via inline `eslint-disable`.
- **Abstract classes must start with a `Base` prefix** (e.g. `BaseQueueProducer`). This too is enforced by ESLint.
- `type` aliases are not subject to the `I` rule.
- **A method name does not repeat the context its class carries.** The class already names the entity it
  owns; the method name carries only the **verb** (and whatever is distinguishing):
  `buildingsService.create(...)`, `…lock(...)`, `…lockAll(...)` — not `createBuilding` / `lockBuilding`.
  The rule is not mechanical: a name **stays if it adds information** (`TokenService.signAccessToken`
  distinguishes it from a refresh token; `BalanceConfigService.getProductionConfig` says which block it
  reads; the "production line" in `ProductionLifecycleService.selectProductionLine` is a distinct domain
  name, not a repetition of the class name). Test criterion: shorten the name if doing so leaves nothing
  ambiguous at the call site. **Pure utils (free functions) are exempt** — they have no class context, so
  `resolveEffectiveBuildingLevel` carries its full name as a util.

## Path aliases

Cross-layer imports use aliases (defined in `tsconfig.json` and mirrored in `vitest.shared.ts`);
imports within the same subtree stay relative.

| Alias               | Path                   |
| ------------------- | ---------------------- |
| `@config/*`         | `src/config/*`         |
| `@shared/*`         | `src/shared/*`         |
| `@infrastructure/*` | `src/infrastructure/*` |
| `@modules/*`        | `src/modules/*`        |
| `@database/*`       | `src/database/*`       |

At runtime, aliases are resolved by `tsc-alias` (which rewrites `dist/` after the nest build) and, for
`ts-node` scripts (`typeorm`, `db:*`), by `tsconfig-paths/register`.

## Import ordering

Enforced by `eslint-plugin-simple-import-sort` (fixed with `pnpm lint:fix`). Groups, in order:
side-effects → `node:` builtins → external packages → internal aliases
(`@config`/`@shared`/…) → relative imports.

## Code style

There are two layers: some of it is **mechanically enforced by ESLint** (authoritative source
`eslint.config.mjs`, checked with `pnpm lint`); some are **conventions kept consistent** across the
codebase even though lint does not enforce them. Both apply to new code.

**Enforced by ESLint (authority: `eslint.config.mjs`):**

- **A function/method/arrow taking 2+ parameters takes a single named-parameter object** (`fn({ a, b })`). The sole exception: **constructors** — exempt because NestJS DI injects into positional constructor parameters.
- `any` is forbidden (`no-explicit-any`); unused variables/parameters and unused private class members are forbidden (the `_` prefix is exempt).
- Floating promises are forbidden (`no-floating-promises`): every Promise is either `await`ed or deliberately `void`ed.
- Promise-returning functions must be `async` (`promise-function-async`) and the returned promise must be `await`ed (`return-await: always`).
- Private fields that are not mutated must be `readonly` (`prefer-readonly`).
- Naming: interface `I` prefix, abstract class `Base` prefix (see "Naming conventions").
- Comments: one line, ≤120 characters, a Better Comments prefix, no `/* */` blocks — the local `comment-policy` rule (see "Comments").

The three project-specific rules live in `eslint-rules/`: `comment-policy` (all files), `route-response-schema` (`*.controller.ts`) and `entity-table-name-plural` (`entities/*.entity.ts`).

**Conventions followed even though lint does not enforce them:**

- **Private methods sit at the bottom of the class**: public API and lifecycle methods first, then private helpers (e.g. `shared/guards/rate-limit.guard.ts`).
- **DI is done positionally with `constructor(private readonly x: X)`.**
- **A 2+ param object is typed inline**: `method({ a, b }: { a: T; b: U }): R`.
- **Method/function return types are written explicitly** (even though the ESLint rule is off — e.g. `: void`, `Promise<boolean>`).
- **Wire (API) contract is `snake_case`, internal TypeScript is `camelCase`.** Fields going to/from the client — response bodies (`page_size`, `total_count`, `next_cursor`, `has_next`) and query parameters (`page`, `page_size`, `order_by`) — are `snake_case`; these are defined that way in the Zod schemas. Internal values and transformations (`skip`, `take`, `consumedPoints`) stay `camelCase`.
- **Time (date/time) from a single source: `ClockService`** (`infrastructure/clock/`, global). Do not read "now" with a bare `Date.now()` / `new Date()` — inject `ClockService`; this way time is mocked deterministically in tests. Choose the accessor by boundary: Luxon `DateTime` (`clock.now()`) for calendar/timezone semantics, epoch millis (`clock.epochMillis()`) for arithmetic and wire formats (wire formats, backoff arithmetic), `Date` (`clock.date()`) for the TypeORM `timestamptz` boundary. **Exception — monotonic elapsed-time measurement** (request duration, backoff measurement) does not go through `ClockService`; `performance.now()` is used rather than the wall clock (so that a frozen test clock does not corrupt the measurement).

### Comments

**The default is no comment.** Code explains itself through names, structure and small functions. A comment is written only when leaving it out would let someone break a **security or correctness guarantee** that the code cannot state on its own — a hazard, an invariant, a deliberate-looking-wrong decision. Everything else is deleted: restating the **what**/**how**, describing a well-named function or column, explaining a language feature, narrating a `try`/`catch` that is already visible, repeating what a test's `it('...')` name already says.

The test is blunt: **delete the comment and ask what breaks.** If the answer is "nothing, the code still reads fine", it should not have been written. If the answer is "someone would remove the `timingSafeEqual`" or "someone would point migrations at the pooled URL", write it — in **one line**.

**Hard limits (enforced by the `local/comment-policy` ESLint rule, so a violation cannot be committed):**

| Limit                                           | Rationale                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| **One line per comment**                        | A paragraph is a sign the comment is explaining the code instead of the reason. |
| **≤ 120 characters** (the Prettier print width) | Long enough for a real reason, short enough that it cannot become prose.        |
| **A Better Comments prefix on every comment**   | An unprefixed `//` is either commented-out code or a note nobody classified.    |
| **No `/* */` blocks** (JSDoc `/** */` excepted) | One comment style, so the rule has one thing to check.                          |

The rule exempts tooling directives (`// eslint-disable-next-line …`, `// @ts-expect-error`, `// prettier-ignore`) — those are machine instructions, not prose, and their `--` explanation may run long.

**Better Comments prefixes** (colored by the VS Code "Better Comments" extension):

| Prefix     | When                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `// !`     | A hazard: breaking this costs data, security or availability. **The common case** — most surviving comments are warnings. |
| `// *`     | A reason the code cannot carry: a non-obvious invariant, a deliberate tradeoff.                                           |
| `// ?`     | Question / open point — an undecided decision or an assumption to verify.                                                 |
| `// TODO:` | Work to be done later (if permanent, open an issue, do not leave it in the code).                                         |

Good examples, all one line:

```ts
// ! Honour a forwarded IP only when the DIRECT peer is trusted, or anyone can forge cf-connecting-ip.
// ! No early exit once matched: the response time would reveal the position of the presented code.
// ! insert(), never save(): save() would UPDATE an existing id and this table is append-only.
// * Uses PgBouncer.
```

- **JSDoc blocks (`/** ... \*/`) are a separate category\*\* — they document the public/abstract API contract and are read by the IDE/tooling; they do not take a Better Comments prefix. Use them only for a real API contract (e.g. the rule an abstract method must follow), never as a place to park prose the line limit rejects.
- **Commented-out (dead) code is not left behind** — it is deleted; Better Comments' plain `//` (strikethrough) tag is not used in this project.
- **No issue/task IDs are embedded in comments (or in code/tests/docs in general)** — work references are descriptive ("when the payment module arrives"); a permanent TODO gets an issue opened, no ID written into the code.
- **A comment is not a home for documentation.** Client-facing behaviour belongs in `docs/client-integration/`, operational procedure in `docs/runbooks/`, conventions here. If a would-be comment runs past one line, the content belongs in one of those and usually needs no comment at all.

## API documentation

The OpenAPI spec is generated **from the same Zod schemas used for validation** — there are
**no `@ApiProperty` / `@ApiResponse` decorators** in controllers. To document an endpoint:

1. **Response**: define a `schemas/*.response.ts` Zod schema with `.describe()` (and, where possible,
   `.meta({ example })`) on each field, then mark the handler with `@ResponseDto({ schema })`
   — `@ResponseDto` takes **a single object
   parameter** (`{ schema, offsetPaginated?, cursorPaginated?, metaSchema?, status?, description?, errors? }`).
   For list endpoints use `@ResponseDto({ schema, offsetPaginated: true })` (or `cursorPaginated: true`),
   and add `{ status }` for a non-200 success. If a paginated list needs to carry **endpoint-specific meta**
   beyond `pagination` (e.g. a list-wide `generated_at` stamp), pass a Zod object schema as `metaSchema`
   — its fields are added to `meta` alongside `pagination`. This single decorator drives both the runtime
   validation/envelope (`ResponseInterceptor`) and the documented success **and** standard
   error responses (`@shared/swagger`).
2. **Errors**: the cross-cutting errors every endpoint can return — `400` (validation), `429`
   (rate limit), `500` — are documented automatically. Declare endpoint-specific ones with
   `@ResponseDto({ schema, errors: [HttpStatus.NOT_FOUND, HttpStatus.CONFLICT] })`;
   each status is documented with the correct code/message/example
   (see `@shared/swagger/api-standard-errors`). Document realistic error _examples_ per status,
   not the runtime messages per endpoint.
3. **Request body**: define a `schemas/*.request.ts` Zod schema with `.describe()` (and, where possible,
   `.meta({ example })`) on each field and a DTO class
   (`export class XRequest extends createZodDto(schema) {}`), and use it as `@Body() body: XRequest`.
   The global `AppZodValidationPipe` validates it and it is documented automatically.
4. **Query parameters**: keep the `@OffsetPagination` / `@CursorPagination` / `@Search` / `@OrderBy`
   param decorators, and add the doc-only `@ApiOffsetPaginationQuery()` /
   `@ApiCursorPaginationQuery()` / `@ApiSearchQuery()` / `@ApiOrderByQuery(fields)` next to them.
5. **Grouping / summary**: an `@ApiTags('<Group>')` on each controller, an
   `@ApiOperation({ summary })` on each handler. **`summary` must be a short label** (~1-4 words;
   e.g. `Guest login`, `Sign in with Google`, `Liveness`) — it becomes the title in Scalar and
   **the name of the generated Postman request** comes from it (`requestNameSource: Fallback`).
   Put full-sentence/flow descriptions in **`description`, not `summary`** (add them for multi-step
   flows). Tag descriptions are defined in `DocumentBuilder.addTag(...)` in
   `infrastructure/docs/openapi.factory.ts` — when you add a new tag, add its description there too.
6. **Auth**: add `@ApiBearerAuth()` to protected endpoints. Auth works with the global `AuthGuard` +
   `@Public()` pattern — every handler without `@Public()` is protected. `@ApiBearerAuth()` both shows
   the security marker correctly in Scalar and automatically attaches the bearer token to the generated
   Postman request (see below); do not add it to public endpoints.
7. **Cache-Control**: all responses return `no-store` via the global `CacheControlInterceptor` (deny-by-default —
   sensitive data is not cached by accident, a new endpoint starts safe). Do **not** add `@Header('Cache-Control', …)`
   to the controller. If an endpoint is to be cacheable, **opt in** explicitly in the handler with
   `response.setHeader('Cache-Control', …)` (e.g. `private, no-cache` for rarely-changing/static routes).

> **Examples determine quality:** add `.meta({ example })` to request/response fields — Scalar
> "try it", the generated Postman example bodies, and onboarding all feed off this. `.meta()` is only
> metadata; it does **not** change Zod parse/validation behavior. It produces a singular `example`
> (OpenAPI 3.0); do not use `.meta({ examples: [...] })` (tools do not read it).
>
> **Numeric bounds must be inclusive:** do **not** use `.positive()` / `.negative()` /
> `.gt()` / `.lt()` in request/response Zod schemas — they produce a boolean `exclusiveMinimum`/`exclusiveMaximum`
> in OpenAPI 3.0, and Portman's response schema validator (Ajv draft-07; expects a number) cannot compile them
> and **silently skips** that endpoint's schema test (`schemaValidation skipped`). Use inclusive bounds instead:
> `.int().min(1)` for a positive integer, `.max(n)` for an upper bound. (Only for API schemas that enter OpenAPI;
> env schemas are out of scope since they do not enter the spec.)

Serving and generation:

- The Scalar UI is at `/api/docs`, the raw spec at `/api/docs-json` (wired via `setupDocs` in `main.ts`).
  In production both are behind HTTP basic auth (`DOCS_AUTH_USER` / `DOCS_AUTH_PASSWORD`).
- `openapi.json` is committed at the repo root and regenerated with `pnpm run docs:generate`
  (NestJS preview mode — no DB or Redis needed). If it drifts from the code, CI fails.
- `test/docs.e2e-spec.ts` tests the whole pipeline (envelope, opt-in errors, the served spec).
- **When the API changes, the client surface is updated too:** in addition to regenerating
  `openapi.json`, the relevant `docs/client-integration/*.md` (endpoint tables, example bodies, path/schema)
  is updated by hand, and the client types generated with `pnpm gen:api` in the developer portal repo
  (`../app-developer-portal`) are refreshed (the required UI/hook changes are reflected too).

## Idempotency (idempotent endpoints)

To make retries safe on side-effecting (mutating) endpoints, idempotency is **namespaced per principal**
— one user's key never collides/leaks with another's. Two usages:

1. **Declarative (default, authenticated):** add
   `@Idempotent({ scope, responseTtlSeconds, principalSource? })` to the handler (`@shared/decorators`).
   The `IdempotencyInterceptor` reads the `Idempotency-Key` header and **validates it according to the principal source**:
   **strict** for `Anonymous` (≥24 chars, base64url/hex/UUID — high entropy required), 16-128 chars for
   `User`/baseline (whitespace/control characters rejected). It resolves the principal via `principalSource`
   (`User` → `request.user.id`; `Anonymous` → a fixed sentinel), derives a **canonical** fingerprint
   (`sha256(stableStringify({ body, query }))` — independent of key order), caches **only the successful** first
   response encrypted, and returns it verbatim on retry. A concurrent in-flight request → **409**; the same
   key with a different request → **400**. If the header is absent, the endpoint works normally (idempotency is optional).
2. **Imperative (content-dependent principal/fingerprint):** if the principal or fingerprint is derived from
   the request body (e.g. refresh: principal = the refresh token's `sessionId`, fingerprint =
   `sha256(refreshToken)`), the generic interceptor does not fit — call `IdempotencyService.execute({ scope, principal,
key, fingerprint, lockTtlSeconds, responseTtlSeconds, compute })` **directly**.

**Anonymous mode security note:** in identity-less flows (guest) the principal is a sentinel, so the
**Idempotency-Key is effectively a bearer secret** — whoever presents the key gets the cached (token-carrying)
response. Security relies on the client generating a **high-entropy, random, single-use** key **on every
request** and on a **short response TTL**; this is why the anonymous schema is strict (≥24/format) and the TTL
is kept short (`IDEMPOTENCY_GUEST_TTL_SECONDS`). In authenticated flows the baseline schema is sufficient
because the principal already isolates (entropy adds no security). The service itself is in
`infrastructure/idempotency/` (a generic technical capability; Redis + `SensitiveService`).

**Lock fencing (lock TTL < compute):** each `execute` generates a random lock-token and writes it as a
plaintext prefix on the entry; `release` and the completed-`store` run via **ownership-guarded Lua** — if the
lock expired and someone else took over, the delayed writer does not delete/overwrite their entry.
**Invariant:** `lockTtlSeconds` must exceed the worst-case `compute` duration (otherwise a second compute =
a duplicate side effect). **Only a successful response is cached** — error responses are not replayed (the
purpose of refresh idempotency is to salvage _success_; replaying a 401 would be harmful). If the cache write
fails while compute succeeded, the response still returns (best-effort), and the stale lock expires on its own.

## Redis unavailability (fail-closed default)

`RedisService.getClient()` returns a **wrapped (proxy) client**: on a Redis **connection/transport**
error (ECONNREFUSED/RESET, MaxRetriesPerRequest, offline-queue, command-timeout, connection-closed) the
command automatically throws **503** (`AppServiceUnavailableException`); a `ReplyError` (server-logic bug) stays
500 (`redis-client-wrapper.ts`). The general client, with `enableOfflineQueue: false`, rejects commands
immediately without queuing them. **Mental model:** if you **do not handle** the Redis error → 503 (fail-closed);
if you want to degrade gracefully, you **opt in with a local `try/catch`**. The BullMQ client stays raw (it needs the offline queue).

| Component                             | When Redis is unavailable | Why                                                                           |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| Idempotency (read/reserve)            | **503** (fail-closed)     | Redis is the only guarantee; compute without a lock = a duplicate side effect |
| OAuth nonce, Game Center replay guard | **503** (fail-closed)     | Redis is the only guarantee; replay/nonce protection must not be lost         |
| Revocation                            | **falls back to DB**      | DB is source-of-truth (`revokedAt`); Redis is only a fast denylist            |
| Rate-limit                            | **in-memory limiter**     | still limits per instance (rate-limiter-flexible insurance)                   |
| Cache                                 | **miss → DB**             | pure performance; reading from the DB is a correct degradation                |

## Cache (read-through)

The application cache goes **through a single gate**: `CacheService` (`infrastructure/cache/`, `@Global` — every
module injects it). It provides `get`/`set`; the value is JSON-serialized, the key is namespaced under
`app:cache:*`, the TTL is explicit (if not given, `appConfig.cache.defaultTtl`), and `encrypt` is **opt-in**
(`SensitiveService`). It is built on the fail-closed `RedisService.getClient()` but read/write is
**fail-open**: a Redis error is logged and swallowed, `get` returns `null` → the caller degrades to the
DB-authoritative path (the "Cache" row in the table above).

- **Key generation:** `CacheKey.join(...parts)` (`shared/utils/cache-key.util.ts`) joins the parts with a
  common separator (`appConfig.redis.separator`). Prefixes are in a single place: `config/app.config.ts >
redis.keyPrefixes`. The key given to CacheService is the **logical** sub-key; the final Redis key is
  `app:cache:<key>`.
- **Boundary — what CacheService is NOT for:** atomic coordination (lock/fencing token, rate-limit,
  idempotency, OAuth nonce, Game Center replay, revocation denylist) does not fit into a generic `get/set`;
  these use `RedisService` **directly** (`SET NX EX`, Lua, `RateLimiterRedis`). The only thing in common is
  key generation — and they too use `CacheKey.join` + their own `keyPrefixes.*` prefix.
- **Invalidation** (`del`, pattern-scan) does **not** exist today; it will be added at the first real
  write-through consumer (no speculative surface is kept).

## Postman collection (Portman)

The Postman collection is **generated from `openapi.json`** — not hand-maintained, no drift.
`pnpm postman:generate` first runs `docs:generate`, then generates
`postman/app-api.postman_collection.json` with
[Portman](https://github.com/apideck-libraries/portman) (gitignored; generated on demand). Import it —
`{{baseUrl}}` is already the first server (`http://localhost:4001`); run a token-producing request (e.g.
`POST /auth/guest`) → the token is written to a collection variable → protected requests use
`{{bearerToken}}` automatically.

The collection generation behavior comes from two committed config files:

- **`postman/openapi-to-postman.json`** — collection-wide converter settings (folders by Tag,
  use examples, name source). **Not touched per endpoint**; only by hand if you want to change the
  collection's overall conversion behavior.
- **`postman/portman-config.json`** — token automation, auto-value injection, and contract tests.

**You do not need to touch these files when adding a normal endpoint** — the folder (from Tag), example
body (from `.meta({ example })`), schema, contract test (`*::/*` on every request), and bearer auth
(from `@ApiBearerAuth()`) all flow automatically from OpenAPI. Add to `portman-config.json` only in these
cases:

- **An endpoint that returns a value to be used in later requests** (a new token, a created record id,
  etc.): add an entry to `assignVariables` —
  `{ "openApiOperation": "POST::/api/v1/<path>", "collectionVariables": [{ "responseBodyProp": "data.<x>", "name": "<var>" }] }`.
  Login tokens are captured into `bearerToken` (bearer auth uses this variable) and `refreshToken`.
  `responseBodyProp` uses the envelope-inclusive path (`data.access_token`), because responses are wrapped
  with `{ data: ... }`.
- **Auto-value injection into a request** (e.g. `Idempotency-Key` → `{{$guid}}`):
  `globals.keyValueReplacements`.
- **A new auth scheme other than bearer**: `globals.securityOverwrites`.

> **If you see `schemaValidation skipped for[...]` output:** the relevant response schema has an exclusive
> numeric bound (`.positive()` / `.gt()` → a boolean `exclusiveMinimum` in OpenAPI 3.0; Portman's Ajv draft-07
> validator expects a number). Convert it to an inclusive bound in the schema (`.int().min(1)`) — detail:
> "API documentation".

---

# Part 2 — Infrastructure design

> How and why the database, authorisation, audit and storage layers are built the way they are. Deep design/rationale consulted
> occasionally; for operational "how-to" steps, see `docs/runbooks/`.

## Database infrastructure

The production database layer is a small cluster of collaborating containers, all on the
`dokploy-network` and reachable from the host only over WireGuard (`10.0.0.1:<port>`).

```
app  ──►  PgBouncer  ──►  Postgres 17    ──►  Cloudflare R2
 │         (6432)         + pgbackrest                ▲
 │         transaction    binary inside image         │
 │         pooling        (archive_command)           │
 │                                                    │
 └── migration (MIGRATION_DATABASE_URL) ──► direct PG (5432)
                                                      │
                          ┌─────────────┬─────────────┘
                          │             │
                  postgres_exporter  pgbackrest sidecar
                  pgbouncer_exporter  (scheduled full/diff backups)
                  → /metrics
```

### Why plain Postgres

Stock Postgres, not TimescaleDB. The tables here are OLTP state; the one append-heavy table (`audit_events`)
is low volume and an index plus a scheduled `DELETE` handles its retention. Timescale would buy hypertables
and compression at the cost of a custom image, incompatibility with most managed Postgres offerings, and a
licence under which compression and retention policies are not in the Apache build.

If a project built from this boilerplate does grow real time-series data, the extension can be added later:
`CREATE EXTENSION timescaledb` plus `SELECT create_hypertable(...)` converts an existing table in a
migration.

### Connection routing

| URL                      | Used by                                    | Target           |
| ------------------------ | ------------------------------------------ | ---------------- |
| `DATABASE_URL`           | App runtime (TypeORM)                      | PgBouncer (6432) |
| `MIGRATION_DATABASE_URL` | typeorm CLI, `db:*` scripts, `audit:prune` | Postgres (5432)  |

PgBouncer runs in **transaction pooling** mode with **native prepared statement support**
(`max_prepared_statements = 256`) enabled, so it preserves the pg driver defaults — no change is needed on
the app side. Migrations bypass PgBouncer because DDL transactions and TypeORM's advisory-lock-based
migration runner require a dedicated session. The two URLs share the same validation
(`src/config/env.schema.ts`); if `MIGRATION_DATABASE_URL` is not set, it falls back to `DATABASE_URL` (dev/CI).

> **The two URLs should name different database roles in production.** The audit table's append-only
> guarantee is a `REVOKE UPDATE, DELETE` on the application role, applied by the migration as the owning
> role. With a single role the migration warns and skips it, and the guarantee is not in place.

**Pooling constraint — note:** `LISTEN/NOTIFY` and session-level state (other than `SET LOCAL`) do not
survive transaction pooling. Nothing in the codebase uses these today (background work flows through
BullMQ). If the need arises one day, the relevant feature must connect over `MIGRATION_DATABASE_URL` or a
dedicated direct pool — not the runtime URL.

### Backups and PITR

- **Tool:** pgBackRest, container-internal (in the binary DB image, for `archive_command`) + a
  sidecar (`woblerr/pgbackrest`) for scheduled backups.
- **Storage:** Cloudflare R2 (S3 API), encrypted at rest with AES-256-CBC by pgBackRest itself
  (R2's own SSE is a second layer, not the first line of defense).
- **Schedule:** weekly full (Sun 02:00 UTC) + daily diff (Mon-Sat 03:00 UTC) + continuous WAL
  archiving (`archive_mode=on`, async push).
- **Retention:** 4 full + 7 diff + 30-archive ≈ **a 30-day PITR window**.
- **RPO ≤ 5 min** (archive_timeout=60s, async push), **RTO target ≈ 1 h** for a fresh node.
- **Runbook:** `docs/runbooks/database-backup.md`, `database-restore.md`. A monthly restore drill is
  mandatory — an untested backup is not a backup.

### WAL and future replicas

- `wal_level=logical` — sufficient for both streaming replication _and_ logical decoding (CDC), should a
  project ever stream changes out of the database.
- `max_wal_senders=10`, `max_replication_slots=10`, `wal_keep_size=1GB`.
- **Streaming replicas are deliberately not deployed today**: a second Postgres on the same VPS adds
  nothing to disaster tolerance. When a read-load or HA need arises, a replica can be brought up from the
  pgBackRest backup chain in a few hours — see `docs/runbooks/database-replica.md`.

### Observability

- The `pg_stat_statements` extension is active at cluster level; loaded via `shared_preload_libraries`,
  registered by the first migration of each DB.
- `postgres_exporter` (an `exporter` user with the `pg_monitor` role) publishes PG metrics on port 9187.
- `pgbouncer_exporter` (a read-only `pgbouncer_stats` user) publishes pool/wait metrics on 9127. Both are
  scraped together with the app's own `/api/v1/metrics`.
- Slow query log at 1 s (`log_min_duration_statement=1000`).

### Primary key convention

uuid primary keys are generated **application-side with UUIDv7**: `shared/utils/uuid.util.ts` →
`generateUuid()` (the `uuidv7` package). UUIDv7 is time-ordered → far better B-tree index
locality than random v4 (inserts land at the right end of the tree, fewer page splits/bloat); a clear win
on write-heavy and time-series tables (outbox, event log, audit).

- **No DB-side default:** the column is defined as plain `uuid` (`@PrimaryColumn('uuid')`), no `DEFAULT
gen_random_uuid()` is written. The id is always set in the app before insert — the single generation point
  is `generateUuid()`.
- **`uuid-ossp` is not used:** `gen_random_uuid` is already core, no extra extension is needed. With the
  extension loaded and a default on a uuid column, TypeORM's `migration:generate` continuously produces
  spurious `uuid_generate_v4()` churn — which is why both the DB default and the extension are avoided.
- Native `uuidv7()` arrived with PostgreSQL 18; since the image is pg16, generation is app-side (it can be
  moved DB-side if migrated to PG18).

### Time-series table convention

When a new feature needs time-series storage (event log, audit, metric,
audit, etc.):

1. Define the entity normally in its owning module (`modules/<x>/entities/`).
2. **Within the same migration**, after the `CREATE TABLE`, call `SELECT create_hypertable(...)`.
3. As data volume grows, add retention/compression policies in later migrations
   (`add_retention_policy`, `add_compression_policy`).

Do not turn an OLTP table (users, facilities, inventory state) into a hypertable — hypertables are
append-mostly by design.

### At-rest column encryption (PII)

DB columns containing PII (email, etc.) are encrypted **declaratively** with `@EncryptedColumn`
(`infrastructure/sensitive/encrypted-column.decorator.ts`). Mark the column, the rest is transparent:
`EncryptedColumnTransformer` (a TypeORM `ValueTransformer`) encrypts with AES-256-GCM on write and decrypts
on read (engine `SensitiveService`, keyring `ENCRYPTION_KEYS`/`ENCRYPTION_ACTIVE_KID`). The service/repo
layer is **unaware** of the encryption; use this instead of a plain `@Column`.

```ts
@EncryptedColumn({ aad: 'oauth_account.email', nullable: true })
email!: string | null;
```

- **`aad`**: binds the ciphertext to a static context (`table.column`) → cross-column domain separation.
  There is no binding to the row id (the transformer cannot access the row); if needed, an EntitySubscriber is required.
- **`WHERE`/unique does not work:** because of the randomized IV, equality search and unique constraints
  are impossible on an encrypted column. If a searched column is to be encrypted, a **blind index** (a keyed
  HMAC `*_bidx` column, with lookup/unique on it) is required.
- **Scope:** transparency applies on the repository/entity paths (`save`/`find`, including QueryBuilder);
  only raw SQL (`dataSource.query`) bypasses it (useful in tests where you want to see the ciphertext raw).
- **Key rotation:** an encrypted column is persistent data → a **re-encrypt** is mandatory before dropping
  an old key; detail in `docs/runbooks/encryption-key-rotation.md`.

## Authorisation

`modules/auth/rbac/` implements the split that makes RBAC maintainable: **permissions are code, roles are
data**.

- **Permissions** live in the `Permission` enum. A permission is meaningful only because a route declares it
  with `@RequirePermission`, so the enum is the source of truth. On boot `PermissionSyncService` projects the
  enum onto the `permissions` table and **retires** — never deletes — anything that left the code, so a role
  that still references it neither breaks nor silently widens.
- **Roles and grants** are rows, managed from the admin API. `role_permissions` references `permissions` with
  `ON DELETE RESTRICT` for the same reason.
- **`superuser`** is a system role the boot sync keeps holding every permission. It cannot be edited or deleted
  through the API — it is the way back in when role data is misconfigured.

`PermissionGuard` runs after `AuthGuard` in the global chain (it needs `request.user`). A route listing several
permissions requires **all** of them. `UserPermissionsService` caches the resolved set in Redis for five
minutes; every path that changes a user's roles — or a role's permissions — invalidates the holders, otherwise
a narrowed role would keep working for the rest of the TTL.

**MFA** (`modules/auth/mfa/`) is TOTP with encrypted secrets and hashed single-use recovery codes. Any account
holding a role must have it: roles exist only to carry administrative permissions, and an administrative
account behind a single password is the weakest link. `pnpm admin:create` therefore hands over an account with
MFA already active.

## Audit log

`infrastructure/audit/` records identity events, administrative mutations and role changes into
`audit_events`.

- **No foreign key on the actor.** An audit row outlives the account it describes: erasing a user must not
  erase the record that an administrator suspended them.
- **Append-only.** The migration revokes `UPDATE` and `DELETE` from the application role, so a compromised
  application — or an SQL injection through it — cannot cover its tracks. This only applies when
  `DATABASE_URL` and `MIGRATION_DATABASE_URL` name different roles; with one role the migration warns and
  skips, because it would otherwise strip the owner of the ability to prune.
- **Retention** is a standalone task (`pnpm audit:prune`), not an in-process job, precisely because the
  application must not hold delete rights on this table.

`AuditService.record()` is best-effort by default: a failed insert is logged and swallowed, since failing a
completed login just to record it trades a real outage for a record. Callers that need the record and the
change to stand or fall together pass the transaction's `manager`.

## Object storage

`infrastructure/storage/` wraps any S3-compatible store (R2, MinIO, AWS). The server never handles file bytes:
it signs a URL and the client uploads directly.

- **The signature is the enforcement.** MIME allowlist and size limit are checked before signing, and
  `content-type` and `content-length` are listed in `signableHeaders` — without that the presigner signs only
  `host` and the limits become advisory.
- **One bucket, two prefixes.** `public/` and `private/`; the bucket policy that exposes `public/*` is the
  single place public readability is decided. `publicUrl()` refuses a key outside the public prefix.
- The S3 variables are optional as a group — a deployment that stores no files configures none of them, and a
  half-configured bucket is rejected at boot rather than on the first upload.

## Graceful shutdown

Nest's `enableShutdownHooks()` is deliberately **not** used: it calls `app.close()` the moment the signal
lands, while the load balancer is still routing traffic here. `main.ts` runs the order that matters instead:

```
SIGTERM/SIGINT → readiness reports 503
              → wait SHUTDOWN_DRAIN_DELAY_MS   (the balancer needs time to notice)
              → app.close()                    (in-flight requests finish, workers and pools close)
              → flush telemetry
              → exit 0
```

All of it under `SHUTDOWN_TIMEOUT_MS`; exceeding it exits non-zero on our own terms rather than waiting for a
SIGKILL. Readiness checks the drain flag **before** its own cache, or a cached healthy result would keep
traffic arriving for the length of the TTL.

---

# Part 3 — Process

## Releases and versioning

- **Conventional Commits** (enforced by commitlint) trigger **semantic-release** on every push to `main`:
  it computes the next version, updates `CHANGELOG.md`, tags the release, creates a GitHub Release, and
  attaches `openapi.json` as an asset. `fix:` → patch,
  `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major.
- **App version vs API version**: the package version (tracked via CHANGELOG.md / GitHub Releases)
  communicates the granularity of change to the frontend; the URI API version (`/api/v1`, via
  `versioningConfig` in `@config/app.config`) is bumped only on a backwards-incompatible contract redesign
  that must run side-by-side with the old one.
