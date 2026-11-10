# NestJS Backend Boilerplate — AI Agent Guide

Production-grade NestJS 11 + TypeScript **backend** boilerplate.
Stack: PostgreSQL · Redis · BullMQ · TypeORM · Zod (nestjs-zod) · pino · OpenTelemetry · S3-compatible storage.

This file is a **signpost**; the deep detail lives in the linked docs and is not repeated here:

- **Where code goes / how:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, the "what goes where" table, domain-module template, naming, API documentation, DB, authorisation, audit, storage. **Read it before adding code.**
- **Writing tests:** the `nestjs-testing` skill (`.claude/skills/nestjs-testing/`).
- **Client integration:** [`docs/client-integration/`](./docs/client-integration/) (auth, the posts example).
- **Contributing/commits:** [`CONTRIBUTING.md`](./CONTRIBUTING.md). **Operations:** [`docs/runbooks/`](./docs/runbooks/).

## Working principles

- **Ask before guessing.** State assumptions; if the request has more than one reading, name them and ask. Ask before treating anything as out of scope.
- **Smallest complete change.** No speculative features, options or abstractions; touch only what the task needs and match the surrounding style.
- **Production-ready, not "for now".** Within the chosen scope, error paths, concurrency and boundary values are handled. Deferred work becomes a tracked issue, not a stopgap or an untracked `TODO`.
- **Verify before claiming done.** Run the checks in "When the work is done" and report failures or skipped steps as they are.

## Commands (source: `package.json`; package manager **pnpm**, Node ≥22)

| Task                              | Command                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Install                           | `pnpm install`                                                                             |
| Development (watch)               | `pnpm start:dev`                                                                           |
| Lint / fix                        | `pnpm lint` · `pnpm lint:fix`                                                              |
| Type-check                        | `pnpm typecheck`                                                                           |
| Unit test (+coverage)             | `pnpm test` · `pnpm test:cov`                                                              |
| Integration (Testcontainers)      | `pnpm test:integration`                                                                    |
| E2E (supertest)                   | `pnpm test:e2e`                                                                            |
| Migration generate / run / revert | `pnpm db:migration:generate <name>` · `pnpm db:migration:run` · `pnpm db:migration:revert` |
| Generate OpenAPI                  | `pnpm docs:generate`                                                                       |
| Generate Postman collection       | `pnpm postman:generate`                                                                    |

## Non-negotiable rules

- **Dependency direction is one-way:** `modules → infrastructure → shared → config`. **Never** the reverse.
- **Never `import { env } from '@config/env.config'` inside a spec** — env is validated on import and calls `process.exit(1)` on error, which crashes the Vitest worker. Details: the `nestjs-testing` skill.
- **Tests are written for behavior/regression, not for coverage.** Do not write meaningless tests to hit a threshold (tautological, asserting the mock itself, or re-testing third parties such as Zod/TypeORM/Nest); every test must catch a real failure that would go unnoticed if the test were deleted. Each unit is exercised with meaningful scenarios (error paths, branches, boundary values). **Test name == the scenario under test:** if an `it('...')` claims a scenario, it must actually exercise that scenario; if the scenario's logic lives inside the unit under test and is stubbed away by a mock, the test is worthless — fix it, delete it, or rename it to match what it actually tests. Details: the `nestjs-testing` skill.
- **`src/config/env.schema.ts` ↔ `.env.sample` stay in sync:** when a key is added, removed, or renamed in the schema, or its default/required/production-required status changes, update `.env.sample` in **the same change** (the key must be present, in the same order as the schema, with the comment `Required`/`Required in production`/`Optional. Default: …` matching the schema exactly). Where the same concern applies, reflect it in env-dependent docs such as `docs/client-integration/01-auth.md`.
- **The answer to "what goes where" is in `ARCHITECTURE.md`** — do not guess, look there.
- **Cross-cutting providers (guard/interceptor/pipe/filter) are registered by ordering dependency:** order-coupled ones go in a single, contiguous ordered array in `app.module.ts`; order-independent, feature-internal ones live in their owning feature module (`APP_*` still promotes them to global). **There is NO "everything in app.module" rule** (it breaks NestJS DI and leaks encapsulation). Every global provider is listed in the `ARCHITECTURE.md` "Cross-cutting providers … registration" registry table — when adding a new one, **record it there too**.
- **Responses:** a `schemas/*.response.ts` Zod schema + `@ResponseDto(schema)` on the handler. **No** `@ApiProperty`/`@ApiResponse` in controllers — OpenAPI is generated from Zod. Use `.meta({ example })` for examples on request/response fields (single, does not break parsing); add `@ApiBearerAuth()` on protected endpoints; `@ApiOperation({ summary })` is **a short label** (~1–4 words; the Postman request name comes from it), with longer prose in `description`. Details + the Postman/Portman flow: `ARCHITECTURE.md` "API documentation".
- **Errors:** from the `AppException` hierarchy; use `shared/exceptions/`.
- **Cache access goes through a single door, `CacheService`** (read-through `get`/`set`; `app:cache:*` namespace, opt-in encryption, fail-open). Do not reach directly into `RedisService.getClient()` to hand-write `get/set` for caching. Atomic coordination (lock/rate-limit/idempotency/nonce/replay/denylist) does not fit `CacheService` → use `RedisService` directly. **All** Redis keys are built with `CacheKey.join(...)` + the `app.config.ts > redis.keyPrefixes` prefix; no hand-built `${prefix}${sep}...`. Details: `ARCHITECTURE.md` "Cache (read-through)".
- **Naming (enforced by ESLint):** files are `kebab-case.<type>.ts`; interfaces take an `I` prefix; abstract classes take a `Base` prefix; enums are `*.enum.ts`, constants `*.constant.ts`.
- **2+ parameters → a single named-parameter object** (`fn({ a, b })`); enforced by ESLint. The one exception: constructors (NestJS DI). Types are inlined, and the return type is written explicitly.
- **The wire (API) contract is `snake_case`, internal TypeScript is `camelCase`** — response bodies and query params (`page_size`, `order_by`) are snake_case; internal values (`skip`, `take`) are camelCase.
- **Table names are plural** (`users`, `sessions`, `oauth_accounts`); given explicitly via `@Entity('<plural>')`.
- **Private methods go at the bottom of the class** (public/lifecycle first, then private).
- **Comments: the default is none.** Write one **only** when leaving it out would let someone break a security or correctness guarantee the code cannot state itself. Apply the test: **delete the comment — if nothing breaks, it should not exist.** Never restate the what/how, describe a well-named function or column, narrate a visible `try`/`catch`, or repeat a test's `it('...')` name. **Hard limits, enforced by the `local/comment-policy` ESLint rule:** one line per comment, ≤120 characters, a Better Comments prefix on every one (`// !` hazard — the common case, `// *` non-obvious reason, `// ?` open question, `// TODO:`), no `/* */` blocks (JSDoc `/** */` excepted, and never as an escape hatch for prose the line limit rejects). Tooling directives (`// eslint-disable-next-line`, `// @ts-expect-error`) are exempt. Content needing more than a line belongs in `docs/client-integration/`, `docs/runbooks/` or `ARCHITECTURE.md` — not in a comment. Details → `ARCHITECTURE.md` "Code style → Comments".
- **Always write testable code:** put logic in pure functions/services/guards/DI; do not embed business or decision logic in the `main.ts` bootstrap (use a testable guard/middleware class instead of inline middleware and the like).
- **Path aliases:** `@config` `@shared` `@infrastructure` `@modules` `@database` (relative within the same subtree).
- The full code style (ESLint-enforced + manual conventions) → the `ARCHITECTURE.md` "Code style" section.
- **UUID primary keys are generated app-side as UUIDv7** (`generateUuid()` → the `uuidv7` package); there is **no** DB-side `DEFAULT` on the column, and `uuid-ossp` is **not used**. Details: `ARCHITECTURE.md` "Primary key convention".
- **Auth transport:** the access token is always Bearer; the refresh token is an HttpOnly cookie + double-submit CSRF on web (`X-Client-Type: web`), and body/Bearer on mobile. OAuth providers (Google/Apple/Game Center/Play Games) are **opt-in** — none are production-required, and each fails closed if its verifier config is missing.
- **Commits are Conventional Commits** (semantic-release derives the version from them); the `commit-msg` hook rejects trailer/co-author lines. Exception: the squash-merge commit on `main` may carry a structured body + `BREAKING CHANGE:`/`Refs:` footer — template: `CONTRIBUTING.md` "PR and squash-merge template".

## When the work is done (every task)

1. `pnpm lint && pnpm typecheck` (the pre-commit hook runs these too).
2. **Add tests** for new behavior and run the relevant tests (the `nestjs-testing` skill's recipe).
3. **If the API changed:** run `pnpm docs:generate` and review `openapi.json`. The Postman
   collection is generated from it (`pnpm postman:generate`, on demand); for a normal endpoint the
   Portman config needs no changes — when it does is covered in `ARCHITECTURE.md` "Postman collection".
   Also **update the relevant `docs/client-integration/*.md`** (endpoint tables, example bodies, path/schema changes).

## Anti-patterns

- Do not **create a separate NestJS module** for a sub-feature of a domain — use a subfolder within the same module (`ARCHITECTURE.md` "Domain module template"). A separate module is only for a separate bounded context.
- Do not put **business logic or DI** in `shared/` (pure, framework-level building blocks only).
- Do not **hand-write a migration** and skip the `db:migration:generate` step; the name is a **kebab-case positional** (`pnpm db:migration:generate create-x`), and the DDL that generate produces is kept as-is (only spurious diff lines are removed). Details: the `db-migration` skill.
