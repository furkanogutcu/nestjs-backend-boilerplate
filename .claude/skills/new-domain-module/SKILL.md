---
name: new-domain-module
description: >-
  Use when adding a new domain (business) module in this repo, or a sub-feature/endpoint to an existing
  module (e.g. users, articles, orders). Applies ARCHITECTURE.md's "Domain module template" step by step
  with the real shared primitives (Zod request/response + @ResponseDto envelope, AppException hierarchy,
  custom TypeORM repository + pagination, OpenAPI generated from Zod). modules/ is currently empty —
  this skill is the canonical guide for setting up the first module. The generated code conforms to the
  existing conventions and ESLint.
---

# New domain module

You set up a NestJS domain module under `src/modules/<x>/`. For the full file skeleton + copy-paste
code see `references/module-skeleton.md`; this file gives the **order**, the **rules**, and the **real
primitive signatures**.

> Dependency direction: `modules → infrastructure → shared → config`. A module depends on `shared` and
> `infrastructure`, never the reverse. Structural rules: `ARCHITECTURE.md` "Domain module template" + "What goes where".

## Step 0 (do not skip): domain design note

Before writing code, clarify **this module's domain reality**. If anything is ambiguous, **stop and ask** (see AGENTS.md
"Working principles"). Pin the module-specific decisions (fields, rules, flows) as a short note at the top of the
module so the implementation lands in one pass.

## Single module or sub-feature?

- A **separate module** is only for a separate bounded context (its own entities, its own lifecycle — e.g. `auth`,
  `articles`).
- A **sub-feature** (e.g. `auth/profile`) gets its own controller/service in a subfolder of the same module;
  it does **not get its own NestJS module** — `auth.module.ts` registers it too.

## Order (each step builds on the previous)

1. **Entity** → `entities/<x>.entity.ts`. TypeORM entity; **not a hypertable** by default. If you need a
   time-series table → `db-migration` skill (TimescaleDB convention).
2. **Zod schemas** → `schemas/`:
   - `create-<x>.request.ts`, `update-<x>.request.ts` → each a `*.schema.ts` Zod + `createZodDto`.
   - `<x>.response.ts` → a response Zod schema with `.describe()` on every field.
3. **Repository** → `<x>.repository.ts`. An `@Injectable` class extending `Repository<Entity>`;
   `listWithOffsetPagination` / `listWithCursorPagination` (the TypeORM augment) come ready.
4. **Service** → `<x>.service.ts`. Business logic; injects the repository; throws
   `AppNotFoundException` when not found.
5. **Controller** → `<x>.controller.ts`. HTTP; `@ResponseDto({...})` + Zod DTO body + pagination param
   decorators. **NO** `@ApiProperty`/`@ApiResponse`.
6. **Module** → `<x>.module.ts`. `TypeOrmModule.forFeature([Entity])` + controller + service + repository.
7. **Add the module to `app.module.ts`** (or the appropriate aggregator).
8. **Migration** → `pnpm db:migration:generate create-<x>` (kebab-case positional name; see `db-migration` skill).
9. **OpenAPI** → `pnpm docs:generate`, commit `openapi.json`.
10. **Tests** → `nestjs-testing` skill (co-located `*.spec.ts`).

## Real primitive signatures (use these)

- **Response envelope/doc — single object parameter:**
  - `@ResponseDto({ schema: <x>ResponseSchema })` — single 200.
  - List: `@ResponseDto({ schema, offsetPaginated: true })` or `{ cursorPaginated: true }`.
  - Other status: `{ status: HttpStatus.CREATED }`. Opt-in errors: `{ errors: [HttpStatus.NOT_FOUND] }`.
  - **Note:** The signature is **not** `@ResponseDto(schema, {...})` — everything is inside a single object
    (`src/shared/decorators/response-dto.decorator.ts`). Cross-cutting 400/429/500 are documented automatically.
- **Request DTO:** `export class Create<X>Request extends createZodDto(create<X>Schema) {}`; in the controller
  `@Body() body: Create<X>Request`. The global `AppZodValidationPipe` validates it.
- **Errors:** the `AppException` hierarchy. E.g. `throw new AppNotFoundException({ resourceName: '<X>' })`
  → 404 + `{ error: { code, message } }`. Others: `AppConflictException`, `AppBadRequestException`, …
  (`src/shared/exceptions/`). If you need a new domain error code → `shared/exceptions/enums/`.
- **Pagination (controller param decorators):** `@OffsetPagination()` / `@CursorPagination()`,
  `@Search()`, `@OrderBy<Entity>(['createdAt', ...])`. Next to them add **doc-only**
  `@ApiOffsetPaginationQuery()` / `@ApiCursorPaginationQuery()` / `@ApiSearchQuery()` /
  `@ApiOrderByQuery([...])` (`@shared/swagger`).
- **Repository pagination:** in the service, `this.repo.listWithOffsetPagination({ skip, take, where, order })`
  or `listWithCursorPagination({ take, cursor, order, where })` → returns a typed `OffsetPaginated`/`CursorPaginated`
  envelope; the controller documents it with `@ResponseDto({ schema, offsetPaginated: true })`.

## Conventions (ARCHITECTURE.md "Code style" + "Naming conventions")

- Files are `kebab-case.<type>.ts`; the main files sit flat at the module root, and collections (`entities/`,
  `schemas/`, `enums/`, `jobs/`, `events/`) move into a subfolder **only once needed**.
- **Wire (API) `snake_case`, internal TS `camelCase`**: response/request fields are defined in snake_case in the
  Zod schema; entity properties and in-service values are camelCase.
- A method with 2+ parameters → a single named-parameter object (constructors exempt — DI). Private methods at the
  bottom of the class. Explicit return types. Interface `I` prefix, abstract `Base` prefix.
- Relative imports within the same subtree; the `@modules`/`@shared`/`@infrastructure` alias across layers.

## When the work is done (definition of done)

- [ ] `pnpm lint && pnpm typecheck` pass.
- [ ] A test for the behavior was added and passes (`nestjs-testing`).
- [ ] The migration was generated (`db:migration:generate`) — not hand-written.
- [ ] `pnpm docs:generate` was run and `openapi.json` committed (CI drift check).
- [ ] If you made a new convention decision (e.g. the repository DI pattern in the first module), record it in `ARCHITECTURE.md`.
