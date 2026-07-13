---
name: db-migration
description: >-
  Use when changing the database schema in this repo — a new table/column/index, a TypeORM entity change,
  TimescaleDB hypertable/retention/compression, an extension, or a data backfill. Covers the generate
  (entity diff) vs create (hand-written DDL) distinction, MIGRATION_DATABASE_URL routing, SnakeNamingStrategy,
  and the TimescaleDB convention (NOT a hypertable by default). Migrations are not hand-written to skip
  generate; an applied migration is not edited.
---

# DB migrations

TypeORM + PostgreSQL/TimescaleDB. Migrations live under `src/database/migrations/`, in raw SQL
(`queryRunner.query`). A schema change is **always** made with a migration — no `synchronize`.

> Context: `ARCHITECTURE.md` "Database infrastructure" (connection routing, TimescaleDB,
> time-series convention). Connection: `src/database/typeorm.data-source.ts`.

## generate or create?

| Situation                                                                                                                | Command                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| You added/changed an **entity** (table/column/index derivable from the entity)                                           | `pnpm db:migration:generate <name>`                                     |
| DDL **not derivable** from an entity: TimescaleDB hypertable/policy, extension, partial/expression index, view, backfill | `pnpm db:migration:create <name>` (empty migration → write SQL by hand) |
| Apply / revert migrations                                                                                                | `pnpm db:migration:run` · `pnpm db:migration:revert`                    |

- **`generate`** diffs your entities against the live schema → produces SQL. **Do not hand-write a migration and
  skip generate on an entity change** (AGENTS.md "Anti-patterns"). The DB must be up; the entity must be registered in a module.
- **`create`** gives you an empty migration skeleton; you write the raw SQL inside it (for things TypeORM
  cannot know). The existing migrations are in this style (`up`/`down` + `queryRunner.query`).

## SnakeNamingStrategy

`SnakeNamingStrategy` is active in the data source: your entity properties stay **camelCase**, and DB columns
become **snake_case automatically** (`createdAt` → `created_at`). The generated migration columns come out
snake_case; do not hand-write snake_case in the entity. (This is separate from the wire contract being snake_case —
that is defined in the Zod response/request schemas.)

## Connection routing (keep in mind)

- App runtime → `DATABASE_URL` (PgBouncer :6432). **Migrations → `MIGRATION_DATABASE_URL`** (direct
  Timescale :5432, bypassing PgBouncer). If `MIGRATION_DATABASE_URL` is absent, it falls back to `DATABASE_URL` (dev/CI).
- Reason: DDL transactions and TypeORM's advisory-lock migration runner need a dedicated session.

## TimescaleDB hypertable convention

**No table is a hypertable by default.** When a feature needs time-series storage
(event log, audit trail, metrics/telemetry):

1. Define the entity normally in its owning module (`modules/<x>/entities/`).
2. **In the same migration**, after `CREATE TABLE`, call `SELECT create_hypertable(...)`.
3. As volume grows, add `add_retention_policy` / `add_compression_policy` in later migrations.

Do **not** convert OLTP tables (users, sessions, orders) into hypertables — hypertables are append-mostly.

```ts
// a hypertable migration produced with create (hand-written)
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventLogs1781000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "event_logs" (
        "id" uuid NOT NULL,
        "event_type" varchar NOT NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "payload" jsonb NOT NULL,
        PRIMARY KEY ("id", "occurred_at")
      );
    `);
    await queryRunner.query(`SELECT create_hypertable('event_logs', 'occurred_at');`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "event_logs";`);
  }
}
```

## Rules

- **The name is given as `kebab-case` positional** (e.g. `pnpm db:migration:generate create-articles`,
  `add-articles-slug`); the `--name=<kebab-name>` form also works. TypeORM produces the file as
  `<timestamp>-<kebab-name>.ts` and the class as `<PascalName><timestamp>` by converting to PascalCase.
  **Do not give a PascalCase name** (the file would also come out PascalCase, against convention).
- **Do not write `DEFAULT` on uuid primary keys:** ids are app-side UUIDv7 (`generateUuid()`); do not put
  `DEFAULT gen_random_uuid()` on a uuid column in `CREATE TABLE` and do not install the `uuid-ossp` extension.
  Detail: `ARCHITECTURE.md` "Primary key convention".
- **Write a `down` that reverses every `up`.** `down` must actually roll back.
- **Do not edit an applied / committed migration** — add a new migration instead.
  (History does not re-run in deployed environments.)
- After generate, **review** the produced SQL — because TypeORM cannot see other objects built with raw SQL
  (partial/expression index, column default) in the entity metadata, it may produce **spurious**
  `DROP INDEX`/`ALTER ... DROP DEFAULT` lines. **Delete only those spurious lines**; keep your own table's generated
  `CREATE TABLE`/DDL lines **as-is**, do not rewrite or reformat them by hand (only normalize to repo style with lint:fix).
- **Do not trust generate's empty diff when rebuilding the schema from entities.** Entity metadata cannot express an
  **expression index** (`ON t ((expr))`) or **table storage parameters** (`fillfactor`, autovacuum settings);
  generate neither produces them nor sees that they are missing. Verification must be schema-to-schema: run the old and new
  migration against separate empty DBs, compare the outputs of `pg_dump --schema-only --schema=public` (and `pg_indexes` /
  `pg_constraint` / `pg_class.reloptions`); the difference must be **only the intended delta**. Add the missing pieces to `up`/`down` by hand.

## When the work is done

- [ ] `pnpm db:migration:run` ran clean locally; then you verified `down` with `pnpm db:migration:revert`.
- [ ] If an entity changed, the migration was produced with **generate** (not by hand).
- [ ] `pnpm lint && pnpm typecheck` pass; the migration is committed.
