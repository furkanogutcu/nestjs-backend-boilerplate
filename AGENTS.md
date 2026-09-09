# NestJS Backend Boilerplate — AI Agent Guide

Production-grade NestJS 11 + TypeScript **backend** boilerplate.
Stack: PostgreSQL · Redis · BullMQ · TypeORM · Zod (nestjs-zod) · pino · OpenTelemetry · S3-compatible storage.

This file is a **signpost**; the deep detail lives in the linked docs and is not repeated here:

- **Where code goes / how:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — layers, the "what goes where" table, domain-module template, naming, API documentation, DB, authorisation, audit, storage. **Read it before adding code.**
- **Writing tests:** the `nestjs-testing` skill (`.claude/skills/nestjs-testing/`).
- **Client integration:** [`docs/client-integration/`](./docs/client-integration/) (auth, the posts example).
- **Contributing/commits:** [`CONTRIBUTING.md`](./CONTRIBUTING.md). **Operations:** [`docs/runbooks/`](./docs/runbooks/).

## Working principles

> These principles prioritize **care** over speed. Apply common sense for trivial work.

### 1. Honesty

**State the truth. Surface uncertainty and risk; do not sugarcoat to gain approval.**

- Separate what is known from what is guessed; when unsure, say so instead of inventing an answer.
- No needless agreement or praise — assessments rest on reasoning, not on pleasing the user. Voice disagreement rather than defer.
- Critique the plan **before** starting: weak points, risks, simpler alternatives. Do not proceed silently.
- Report outcomes as they are: if a test fails, say so with its output; call out any step skipped or left unverified; never present the unverified as done.
- On noticing a mistake, correct it and say so; do not hide errors.

### 2. Think before coding

**Do not assume. Do not hide confusion. Surface tradeoffs.**

Before implementing:

- State assumptions explicitly. Ask when unsure.
- When multiple interpretations are possible, present all of them — do not pick one silently.
- Point out a simpler path if one exists. Push back when needed.
- Stop when something is unclear. Name what is unclear. Ask.

### 3. Simplicity first

**The least code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No unrequested "flexibility" or "configurability".
- No error handling for impossible scenarios.
- If a change spans 200 lines where 50 would do, rewrite it.

Ask: "Would a senior engineer call this 'over-engineered'?" If so, simplify.

### 4. Surgical changes

**Touch only what is necessary. Clean up only your own mess.**

When editing existing code:

- Do not "improve" neighboring code, comments, or formatting.
- Do not refactor what is not broken.
- Follow the existing style even where a different approach would be preferable.
- On spotting unrelated dead code — report it, do not delete it.

Change residue:

- Remove any import, variable, or function that your change renders unused.
- Do not remove pre-existing dead code unless asked.

Test: every changed line must trace directly back to the user's request.

### 5. Goal-driven execution

**Define the success criterion. Loop until it is verified.**

Turn tasks into verifiable goals:

- "Add validation" → "Write a test for invalid inputs, then make it pass."
- "Fix a bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Keep tests green before and after."

For multi-step work, give a short plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Concrete verification → **"When the work is done"** below. A strong criterion enables independent looping; a weak one ("just make it work") requires constant clarification.

### 6. Phased work and approval gates

**Split multi-step work into phases. At the end of each phase, stop, propose a commit message, and wait for approval.**

- Present a short phase plan up front; each phase should produce a verifiable output.
- When a phase ends: summarize what was done, propose a **Conventional Commits** message, and **stop** — do not move to the next phase until the user has reviewed and approved.
- Proceed once approved. If changes are requested, revise the phase and resubmit it for approval.
- No ceremony for trivial single-step work — use common sense.

### 7. Scope decisions and deferred work

**Do not narrow scope without asking. Make deferred work visible.**

- Before treating anything as "out of scope," "deferred," or "for a later phase," **ask the user** — do not narrow silently.
- When work is deliberately deferred, do not merely suggest — **ask**: at an appropriate point (before implementation / between phases / at the end), make the deferred work visible (with a proposed issue/backlog task).
- Reference other work only **descriptively** ("when the payments module lands"); no sequential or numbered references ("once X is done," "Task 2").

### 8. Production-ready quality

**Every line is written as if it ships to production. No "this is fine for now, we'll fix it later."**

- No stopgaps, shortcuts, or deliberate technical debt — do the work correctly, to industry standard.
- No "just for the demo," "temporary hack," or "I'll handle it later" TODOs: what you write is either production-ready or **deliberately deferred** (principle 7 — ask and make it visible).
- Think ahead: within the chosen scope, maintainability, error paths, concurrency, boundary values, and scale behavior must be built solidly. (This is not a **speculative feature/flexibility** — principle 3 still applies.)
- This does not conflict with simplicity: principle 3 shrinks **how much** code (scope); this principle makes what is written **complete and correct**. Little, but whole.

### 9. Communication: concise, and in Turkish

**Answer in Turkish, in the fewest words that preserve meaning.**

- No filler: pleasantries, preambles, and summaries that restate the question are omitted.
- Lead with the conclusion; add reasoning only as needed.
- Technical terms, code blocks, and file paths are preserved **verbatim** — brevity must not corrupt them.
- The language is always **Turkish** (see "Non-negotiable rules → Agent communication language is Turkish").

> **When the principles are working:** fewer needless changes in diffs, fewer rewrites caused by over-engineering, and clarifying questions come _before_ mistakes, not _after_.

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
- **Self-documenting code / comments:** comments are avoided **entirely** where possible — let names and structure carry intent. A comment is written only when it is **genuinely important and useful**, to document the **"why"** that the code cannot convey (never restate what the code already says). When one is needed, use the **Better Comments** prefixes: a normal/informational note `// *`, a critical warning `// !`, a question `// ?`, a to-do `// TODO:`. Details (prefix rules, multi-line, JSDoc, examples) → `ARCHITECTURE.md` "Code style → Comments".
- **Always write testable code:** put logic in pure functions/services/guards/DI; do not embed business or decision logic in the `main.ts` bootstrap (use a testable guard/middleware class instead of inline middleware and the like).
- **Path aliases:** `@config` `@shared` `@infrastructure` `@modules` `@database` (relative within the same subtree).
- The full code style (ESLint-enforced + manual conventions) → the `ARCHITECTURE.md` "Code style" section.
- **UUID primary keys are generated app-side as UUIDv7** (`generateUuid()` → the `uuidv7` package); there is **no** DB-side `DEFAULT` on the column, and `uuid-ossp` is **not used**. Details: `ARCHITECTURE.md` "Primary key convention".
- **Auth transport:** the access token is always Bearer; the refresh token is an HttpOnly cookie + double-submit CSRF on web (`X-Client-Type: web`), and body/Bearer on mobile. OAuth providers (Google/Apple/Game Center/Play Games) are **opt-in** — none are production-required, and each fails closed if its verifier config is missing.
- **Commits must be Conventional Commits** (semantic-release derives the version from them) and the **commit message is written/proposed entirely in English**. The commit message is **a single line: no body** — just `type(scope): subject` (e.g. `feat(auth): add guest login`); proposed messages are likewise given without a body. (**Exception:** this rule is for _development_ commits; the commit that lands on `main` via squash merge is a release/history artifact and may carry a structured body + a `BREAKING CHANGE:`/`Refs:` footer — template: `CONTRIBUTING.md` "PR and squash-merge template".) **No trailer/co-author line** is added to the commit message (e.g. `Co-Authored-By:`) — the `commit-msg` hook rejects one. Details: `CONTRIBUTING.md`.
- **Agent communication language is Turkish:** everything the agent writes to the user (explanations, summaries, plan/phase notes, questions) is written in Turkish. **Exceptions stay English:** commit messages (the rule above) and code identifiers (variable/function/class/file names, by convention).

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
