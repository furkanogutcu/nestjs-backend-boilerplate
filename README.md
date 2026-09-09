# NestJS Backend Boilerplate

Production-grade **NestJS 11 + TypeScript** backend boilerplate. Authentication with MFA, role-based
authorisation, an append-only audit log, object storage, an admin API, feature flags, GDPR erasure and export,
caching, mail, observability, CI and a full test setup — out of the box. `modules/` ships `auth`, `admin` and
a deletable worked example (`posts`). Package manager **pnpm**, Node **≥22**.

Stack: PostgreSQL · Redis · BullMQ · TypeORM · Zod (nestjs-zod) · pino · OpenTelemetry · Resend ·
S3-compatible storage.

> This README shows **what it is and how it is used**, with examples. Layers, the "what goes where"
> table, the domain-module template, and conventions → [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Contents

- [Why this boilerplate](#why-this-boilerplate)
- [Technology stack](#technology-stack)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Features](#features)
  - [API contract & response envelope](#api-contract--response-envelope) ·
    [Automatic OpenAPI (Zod-first)](#automatic-openapi-zod-first) ·
    [Validation](#validation) · [Error model](#error-model) · [Pagination](#pagination) ·
    [Request-ID & correlation](#request-id--correlation) · [Rate limiting](#rate-limiting) ·
    [Idempotency](#idempotency) · [Auth](#auth) · [Authorisation (RBAC)](#authorisation-rbac) ·
    [Multi-factor auth](#multi-factor-authentication) · [Audit log](#audit-log) ·
    [Object storage](#object-storage) · [Admin API](#admin-api) · [Feature flags](#feature-flags) ·
    [Account deletion & export](#account-deletion--data-export) ·
    [Background jobs](#background-jobs-bullmq) · [Transactional mail](#transactional-mail-resend) ·
    [Cache](#cache-read-through) · [Observability](#observability) ·
    [Graceful shutdown](#graceful-shutdown) · [Health](#health) · [Security](#security) ·
    [Example module](#example-module-posts)
- [Commands](#commands) · [Test](#test) · [Database & migration](#database--migration) ·
  [Deployment](#deployment) · [Customization](#customization) ·
  [Configuration](#configuration) · [Documentation](#documentation)

## Why this boilerplate

- **Uniform API contract** — every success response is in a `data`/`meta`/`message` envelope, every error
  in an `error` envelope; both validated and serialized with Zod.
- **Zod-first OpenAPI** — no `@ApiProperty` in controllers; the docs are generated from the validation
  schema, and the build fails on drift (enforced in CI). Scalar UI + Postman collection generation are ready.
- **Authorisation you can reason about** — permissions are code (typed, greppable, enforced by a lint rule),
  roles and grants are data managed from the admin API.
- **An audit log the application cannot rewrite** — `UPDATE` and `DELETE` are revoked from the application
  role, so the trail survives a compromise of the app itself.
- **Request traceability** — every request gets an `X-Request-Id`, automatically bound to pino logs and
  OpenTelemetry traces.
- **Secure defaults** — argon2id, a JWT keyring + kid rotation, refresh reuse detection, two-layer
  rate limiting, at-rest PII encryption, helmet, CSRF, fail-closed Redis.
- **Testability** — unit + integration (Testcontainers) + e2e (supertest); a deterministic clock, the
  env-on-import rule, ready-made factories.

## Technology stack

| Area                 | Technology                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| Framework            | NestJS 11, TypeScript, Express                                                |
| Database             | PostgreSQL 17, TypeORM (`SnakeNamingStrategy`, app-side UUIDv7)               |
| Cache / coordination | Redis (ioredis) — read-through cache + lock/rate-limit/idempotency/nonce      |
| Job queue            | BullMQ                                                                        |
| Validation           | Zod + nestjs-zod                                                              |
| Object storage       | S3-compatible (Cloudflare R2, MinIO, AWS) — signed direct uploads             |
| Observability        | OpenTelemetry (traces + metrics), pino, Grafana/Loki/Tempo/Prometheus         |
| Mail                 | Resend (log driver fallback), handlebars template                             |
| Auth crypto          | `@node-rs/argon2`, jose (JWT/JWK), otpauth (TOTP)                             |
| Quality              | ESLint, Prettier, Vitest, husky, commitlint, semantic-release, GitHub Actions |

## Quick start

Required: **Node ≥ 22** + **pnpm** (`corepack enable`), and **Docker** (local infrastructure + Testcontainers).

```bash
pnpm install                                              # 1. dependencies
cp .env.sample .env                                       # 2. env — fill in the "Required" fields
docker compose -f docker-compose.development.yml up -d    # 3. Postgres + Redis + MinIO
pnpm db:create && pnpm db:migration:run                   # 4. database: create → migrate
pnpm start:dev                                            # 5. server in watch mode
```

Security keys (required in `.env`): `ENCRYPTION_KEYS`, `JWT_ACCESS_KEYS`, `REFRESH_TOKEN_PEPPER`,
`CSRF_HMAC_SECRET`.

```bash
openssl rand -hex 32       # key for ENCRYPTION_KEYS (kid:hex)
openssl rand -base64 48    # JWT_ACCESS_KEYS secret (kid:secret), REFRESH_TOKEN_PEPPER, CSRF_HMAC_SECRET
```

Then create the first administrator — it is handed over with MFA already active:

```bash
pnpm admin:create --email=you@example.com
```

Verify:

| What                       | URL                                         |
| -------------------------- | ------------------------------------------- |
| API root                   | `http://localhost:4001/api/v1`              |
| Liveness                   | `GET /api/v1/health` → `{ "status": "ok" }` |
| Readiness                  | `GET /api/v1/health/ready` (db + redis)     |
| API documentation (Scalar) | `http://localhost:4001/api/docs`            |
| Raw OpenAPI                | `http://localhost:4001/api/docs-json`       |

Local connections (`docker-compose.development.yml`): `postgresql://app:app@localhost:5442/app` ·
`redis://localhost:6389` · MinIO on `http://localhost:9000` (console `:9001`, `minioadmin`/`minioadmin`).

> Those ports are the boilerplate's defaults. Change them before running two projects generated from it at
> the same time.

## Architecture

```text
src/
├─ config/          # env schema + validation (Zod), app config
├─ shared/          # exceptions, guards, interceptors, pipes, decorators, utils, Zod response
├─ infrastructure/  # redis, cache, mail, queues, storage, audit, feature-flags, observability, database…
├─ modules/         # domain modules — auth, admin, and the deletable posts example
└─ database/        # datasource, migration, strategy, custom repository + pagination
```

The dependency direction is **one-way**: `modules → infrastructure → shared → config`. Never the reverse.
Cross-cutting behavior is collected in a global provider chain (order is critical, protected by e2e):

```text
Request → MetricsInterceptor → CacheControlInterceptor → ResponseInterceptor → IdempotencyInterceptor
      → RequireHttpsGuard → IpRateLimiterGuard → AuthGuard → SubjectRateLimiterGuard → handler
```

---

## Features

### API contract & response envelope

Every response passes through a uniform envelope (`ResponseInterceptor`). A handler returns a plain object /
`OffsetPaginated` / `CursorPaginated` / `MessageResponse`; the interceptor wraps it in the envelope and
serializes the response with the Zod schema.

```jsonc
// Single resource → { data }
{
  "data": {
    "id": "0192…6789",
    "is_anonymous": false,
    "display_name": "Captain Nova"
  }
}

// List → { data, meta }
{
  "data": [ /* … */ ],
  "meta": {
    "pagination": {
      "type": "offset",
      "page": 1,
      "page_size": 20,
      "total_count": 137,
      "total_pages": 7
    }
  }
}

// Plain message → { message }
{
  "message": "Verification email sent."
}
```

### Automatic OpenAPI (Zod-first)

The OpenAPI spec is generated **from the same Zod schemas used for validation** — no
`@ApiProperty`/`@ApiResponse` anywhere in the controller. Marking a handler with `@ResponseDto` drives
**both** the runtime validation/envelope **and** the docs:

```ts
const userResponseSchema = z.object({
  id: z.uuid().describe('User id').meta({ example: '0192…6789' }),
  is_anonymous: z.boolean().describe('Whether the user is an unlinked guest').meta({ example: false }),
});

@Get('me')
@ApiOperation({ summary: 'Current user' })
@ResponseDto({ schema: userResponseSchema })          // for a list: { schema, offsetPaginated: true }
me(@CurrentUser() user: User): UserResponse { /* … */ }
```

- Scalar UI at `/api/docs`, raw spec at `/api/docs-json` (HTTP basic auth in production: `DOCS_AUTH_*`).
- `openapi.json` is committed in the repo; generated with `pnpm docs:generate` (no DB or Redis needed), and CI fails on drift.
- Postman collection: `pnpm postman:generate` (generated from the spec with Portman).

### Validation

Request DTOs derive from a Zod schema; the global `AppZodValidationPipe` validates, and the same schema feeds OpenAPI.

```ts
export const loginSchema = z.object({
  email: z.email().meta({ example: 'user@example.com' }),
  password: z.string().min(8),
});
export class LoginRequest extends createZodDto(loginSchema) {}
```

### Error model

All errors come from the `AppException` hierarchy; `GlobalExceptionFilter` converts them into a uniform
`error` envelope (TypeORM/Nest/HTTP errors are normalized by transformers). A stable, machine-readable
`code` + a human message:

```jsonc
{
  "error": {
    "code": "validation_failed", // stable ExceptionCode (bad_request, rate_limit, unauthorized…)
    "message": "Validation failed",
    "requestId": "6f1c…", // equals the X-Request-Id in the response
    "traceId": "4bf92f…", // OpenTelemetry trace, if active
    "details": [
      // only on validation errors
      {
        "type": "invalid",
        "path": "email",
        "issue": "Invalid email",
      },
    ],
  },
}
```

### Pagination

Two types; both come with a param decorator + a doc-only decorator, distinguished by `meta.pagination.type`.

**Offset** — `GET /items?page=1&page_size=20` (`page_size` ≤ 100):

```jsonc
{
  "data": [/* … */],
  "meta": {
    "pagination": {
      "type": "offset",
      "page": 1,
      "page_size": 20,
      "total_count": 137,
      "total_pages": 7,
    },
  },
}
```

**Cursor** (keyset, opaque cursor) — `GET /items?page_size=20&cursor=MDE5…`:

```jsonc
{
  "data": [/* … */],
  "meta": {
    "pagination": {
      "type": "cursor",
      "page_size": 20,
      "next_cursor": "MDE5…",
      "has_next": true,
    },
  },
}
```

```ts
list(@OffsetPagination() p: OffsetPaginationParams) { /* p → { skip, take } */ }
feed(@CursorPagination() p: CursorPaginationParams) { /* p → { take, cursor } */ }
```

### Request-ID & correlation

Every request gains a request-id: an incoming `X-Request-Id` (if a valid UUID) is preserved, otherwise one
is generated; it is written to the response as the `X-Request-Id` header and carried into every log line and
the error envelope (`requestId`). The pino `mixin` also binds the active OpenTelemetry `traceId`/`spanId` to
every log — a single request is traceable end to end. Sensitive fields (the authorization/cookie/idempotency-key
headers, `refresh_token`, `id_token`, `nonce`…) are automatically **redacted** in logs.

```jsonc
{
  "level": "info",
  "reqId": "6f1c…",
  "traceId": "4bf92f…",
  "req": {
    "method": "POST",
    "url": "/api/v1/auth/login",
  },
  "res": {
    "statusCode": 200,
  },
  "responseTime": 42,
}
```

### Rate limiting

**Two layers** with `rate-limiter-flexible` (the guard order is preserved):

- **IP limit** — before auth (`IpRateLimiterGuard`), throttles unauthenticated traffic.
- **Subject limit** — after auth (`SubjectRateLimiterGuard`), throttles per user/session.

Rule-based (`points`/`duration`/`blockDuration`); Redis is the primary counter, and if Redis is unreachable
it falls back to an instance-local in-memory limiter (insurance). On exceeding the limit, `429`:

```json
{
  "error": {
    "code": "rate_limit",
    "message": "Too many requests."
  }
}
```

### Idempotency

For retry-safe endpoints, `@Idempotent()` + the `Idempotency-Key` header. The first request is processed and
its response stored in Redis; a repeat with the same key → the stored response is returned (side effects are
not repeated). On money-movement paths, the key is made mandatory with `@Idempotent({ required: true })`.
A concurrent repeat → `409` (`idempotency_request_in_progress`); the same key with a different body → `409`
(`idempotency_key_conflict`).

```bash
curl -X POST /api/v1/auth/guest -H 'Idempotency-Key: 6f1c…'   # a retry returns the same response
```

### Auth

Email/password + OAuth + guest; a JWT access token (Bearer) + a rotating refresh token. Full flow:
[`docs/client-integration/01-auth.md`](./docs/client-integration/).

| Endpoint (`/api/v1`)                                         | Purpose                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `POST /auth/register` · `/auth/login`                        | Email/password register · login                         |
| `POST /auth/verify-email` · `/resend-verification`           | Email verification · resend                             |
| `POST /auth/forgot-password` · `/reset-password`             | Password reset flow                                     |
| `POST /auth/guest`                                           | Create anonymous account (+ optional `Idempotency-Key`) |
| `POST /auth/refresh` · `/auth/logout`                        | Token rotation (reuse detection) · logout               |
| `GET  /auth/csrf`                                            | Generate/rotate the CSRF cookie for web                 |
| `POST /auth/signin/{google\|apple\|game-center\|play-games}` | Sign in with OAuth (opt-in)                             |
| `POST /auth/link/{provider}`                                 | Link an OAuth provider to an existing account           |
| `GET  /auth/me`                                              | Current user + linked providers                         |

- **Password:** argon2id. Verification/reset tokens are single-use, SHA-256-hashed in Redis, and time-bound.
- **JWT:** HS256 keyring + `kid` rotation. **Refresh:** rotation + reuse detection + family cap + revocation
  (Redis denylist + outbox reconcile + circuit breaker).
- **Two transports:** web → refresh HttpOnly cookie + double-submit CSRF (`X-Client-Type: web`, `X-CSRF-Token`);
  mobile → Bearer/body. The access token is Bearer in all cases.
- **OAuth opt-in:** Google/Apple/Game Center/Play Games; none are production-required, and each rejects
  fail-closed when its verifier config is missing.

`POST /auth/login` response (inside the envelope):

```jsonc
{
  "data": {
    "access_token": "eyJ…",
    "refresh_token": "0192…3a2b.MmFk…", // mobile only; an HttpOnly cookie on web
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "0192…6789",
      "is_anonymous": false,
      "display_name": "Captain Nova",
      "linked_providers": [],
    },
  },
}
```

### Authorisation (RBAC)

**Permissions are code, roles are data.** A permission only means something because a route declares it with
`@RequirePermission(Permission.UsersRead)`, so the `Permission` enum is the source of truth; on boot it is
projected onto the `permissions` table. Anything that leaves the code is **retired**, never deleted, so a role
still referencing it neither breaks nor silently widens.

Roles and their grants are rows, managed from the admin API. The `superuser` system role always holds every
permission and cannot be edited or deleted — it is the way back in when role data is misconfigured. Resolved
permission sets are cached in Redis and invalidated on every change, so a revoked role stops working at once.

### Multi-factor authentication

TOTP (RFC 6238) with the secret stored encrypted and ten single-use recovery codes stored hashed. **Any
account holding a role must have MFA**: roles exist only to carry administrative permissions. Ordinary users
can enable it voluntarily. Sign-in takes an optional `mfa_code` in the same request — the password is proved
every time, so a separate challenge round trip would add nothing.

`pnpm admin:create` bootstraps the first superuser with MFA already active and a one-time password.

### Audit log

Identity events, administrative mutations and role changes are recorded in `audit_events` with actor,
subject, IP and request id.

The table is **append-only**: the migration revokes `UPDATE` and `DELETE` from the application role, so a
compromised application cannot rewrite its own history. Retention is a standalone task (`pnpm audit:prune`)
run by the owning role, precisely because the application must not hold delete rights here — **nothing
schedules it for you**; see [the runbook](./docs/runbooks/audit-log.md#scheduling-it).

### Object storage

Any S3-compatible store (R2, MinIO, AWS). The server never handles file bytes: it validates the MIME type and
size, then signs a URL the client uploads to directly. The content type and length are **part of the
signature**, so a mismatched upload is rejected by the storage provider rather than trusted.

One bucket, two prefixes — `public/` and `private/`; the bucket policy exposing `public/*` is the single place
public readability is decided.

### Admin API

`/admin/users`, `/admin/roles`, `/admin/permissions`, `/admin/feature-flags`. User search and paging,
suspension (which also ends existing sessions), session termination, role grants, and role/permission CRUD.
Every mutation is permission-checked and audited; role grants write their audit row in the same transaction.

### Feature flags

`@RequireFeature('new-checkout')` gates a route on a flag stored in the database and cached briefly in Redis.
An unknown key is **off** — a typo fails closed — and a disabled route answers **404** rather than 403, so a
rollout that has not happened does not advertise itself.

### Account deletion & data export

`POST /me/deletion` schedules erasure after a grace period; the account keeps working until then so the
request can be withdrawn. A scheduled job erases what has matured, writing the audit record **before** the
row disappears. `GET /me/export` returns everything held about the person — with no token hashes, TOTP secret
or recovery codes in it.

### Background jobs (BullMQ)

Job production/processing via base classes; the OpenTelemetry trace carrier is embedded in the job payload
(correlation across the queue). Idempotency key → BullMQ `jobId`.

```ts
class WelcomeMailProducer extends BaseQueueProducer<Payload> {
  protected readonly jobName = 'welcome-mail';
}
// interval poller (e.g. relay/outbox scanning):
class OutboxRelayProcessor extends BaseIntervalProcessor {
  protected readonly schedulerId = 'outbox-relay';
  protected readonly intervalMs = 2_000;
}
```

`BaseScheduledProcessor` is also available (for cron/one-off scheduled jobs).

### Transactional mail (Resend)

Mail delivery is **queued** (`mail.producer` → `send-mail.processor`), with handlebars templates
(`email-verification.hbs`, `password-reset.hbs`). The driver is selectable:

- `MAIL_DRIVER=log` (default, no network — dev/test) · `resend` (required in prod; `RESEND_API_KEY`).
- **Suppression:** the Resend webhook (`/webhooks/resend`, signature-verified) records bounces/complaints
  in the `mail_suppressions` table; delivery to suppressed addresses is skipped.

### Cache (read-through)

A single door, `CacheService` (`get`/`set`, `app:cache:*` namespace, optional encryption, **fail-open** —
falls back to the DB on a cache miss). Atomic coordination (lock/rate-limit/idempotency/nonce/replay/denylist)
goes through `RedisService`. **Redis unreachability is fail-closed by default**: the wrapped client throws
`503` on a Redis transport error; graceful degradation is opt-in via `try/catch`. All keys are built with
`CacheKey.join(...)` + the config prefix.

### Observability

- **Metrics:** OpenTelemetry, pushed over OTLP (HTTP RED + Node runtime); there is no scrape endpoint.
- **Traces:** OpenTelemetry, automatic instrumentation (http, express, nestjs, pg, ioredis, runtime), OTLP → Tempo.
  Spans are **scrubbed** before export — caller IP, port, user agent and query string never reach the backend.
- **Logs:** pino → (dev) pretty / (prod) JSON → Loki; `reqId` + `traceId` in every log.
- **Local stack:** `pnpm obs:up` (Grafana + Prometheus + Loki + Tempo). Shut down with `pnpm obs:down`.

### Graceful shutdown

On `SIGTERM` readiness starts answering 503, the process waits for the load balancer to notice, and only then
closes the server, finishes in-flight requests and flushes telemetry — all under one timeout. Nest's
`enableShutdownHooks()` is deliberately not used: it closes the server while traffic is still arriving.

### Health

- `GET /api/v1/health` — **liveness** → `{ "status": "ok" }`.
- `GET /api/v1/health/ready` — **readiness**: database + Redis indicators, and `503` while draining
  (`@nestjs/terminus`, the result is cached briefly).

### Security

- **at-rest PII encryption** — sensitive columns are encrypted with a keyring (`ENCRYPTION_KEYS`, with kid rotation support).
- **helmet** security headers; a **CORS** allow-list (`CORS_ALLOWED_ORIGINS`); **enforced HTTPS** in prod
  (`RequireHttpsGuard`).
- **CSRF** — double-submit for web (`GET /auth/csrf` → cookie + `X-CSRF-Token`).
- **Cache-Control deny-by-default** — all responses are `no-store`; a cacheable endpoint opts in explicitly.
- Sensitive header/body fields are redacted in logs; secrets are validated at startup via the env schema.

---

### Example module (posts)

`src/modules/posts` is a working example of the domain-module template: public reads, owner-only writes,
pagination and search, a cached read path, an idempotent create, a signed cover upload and a moderation route
behind a permission. Delete it and `docs/client-integration/02-posts.md` when you start your own domain —
nothing else depends on them.

## Commands

| Task                                | Command                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Development (watch)                 | `pnpm start:dev`                                                                           |
| Lint / type-check                   | `pnpm lint` · `pnpm typecheck`                                                             |
| Test (unit / integration / e2e)     | `pnpm test` · `pnpm test:integration` · `pnpm test:e2e`                                    |
| Migration (generate / run / revert) | `pnpm db:migration:generate <name>` · `pnpm db:migration:run` · `pnpm db:migration:revert` |
| Generate OpenAPI / Postman          | `pnpm docs:generate` · `pnpm postman:generate`                                             |
| Create the first superuser          | `pnpm admin:create --email=<address>` (deployed: `admin:create:prod`)                      |
| Prune the audit log                 | `pnpm audit:prune [--older-than-days=N]` (deployed: `audit:prune:prod`)                    |
| Observability stack (local)         | `pnpm obs:up` · `pnpm obs:down`                                                            |

## Test

`pnpm test` (unit; `pnpm test:cov` for coverage), `pnpm test:integration` (Testcontainers — Docker required),
`pnpm test:e2e` (supertest). Tests are written for behavior/regression, not for coverage. Patterns:
the `nestjs-testing` skill.

## Database & migration

Migrations are not hand-written; the entity is changed and the migration is generated:

```bash
pnpm db:migration:generate create-articles
pnpm db:migration:run
pnpm db:migration:revert
```

TypeORM + `SnakeNamingStrategy` (plural table names), app-side UUIDv7 primary keys (no DB-side default on the
column). Details: the `db-migration` skill.

In production `DATABASE_URL` and `MIGRATION_DATABASE_URL` should name **different roles** — the audit table's
append-only guarantee is a `REVOKE` on the application role, applied by the migration as the owning role.

## Deployment

`Dockerfile` (multi-stage) + `docker-compose.production.yml`. Migrations run at container startup
(`start:prod`). Deployment and operational procedures (DB backup/restore/replica, key rotation, storage,
audit retention): [`docs/runbooks/`](./docs/runbooks/).

## Customization

The boilerplate ships with the `app` slug and the display name `NestJS Backend Boilerplate`. What to change:

| What                    | Where                                                              | Note                                                                                                |
| ----------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Technical slug (`app`)  | `src/config/app.config.ts` → `namespace`                           | The Redis key prefix, OpenTelemetry meter name and service labels derive from it. Short, no spaces. |
| Display name            | `src/config/app.config.ts` → `name`                                | Appears in emails and the OpenAPI title.                                                            |
| OpenAPI title           | `src/infrastructure/docs/openapi.factory.ts`                       | `App API` → your own API name.                                                                      |
| Package identity        | `package.json` → `name`, `description`, `author`, `repository.url` | Leave `version` at `0.0.0` (semantic-release manages it).                                           |
| License holder          | `LICENSE`                                                          | The copyright line; if the license changes, update `package.json > license` as well.                |
| JWT iss/aud             | `.env` → `JWT_ISSUER`, `JWT_AUDIENCE`                              | Default `app`.                                                                                      |
| Mail sender             | `.env` → `MAIL_FROM_NAME`, `MAIL_FROM`                             | Sender name + address.                                                                              |
| Observability labels    | `docker/observability/**` · `.env` → `OTEL_SERVICE_NAME`           | Prometheus labels and Grafana dashboard titles use `app`.                                           |
| Docker service/DB names | `docker-compose*.yml`                                              | Service and database names.                                                                         |

When `app.config.ts > namespace` is changed, the Redis key prefixes and the OpenTelemetry meter name update
automatically because they derive from `appConfig.slug`.

## Configuration

Environment variables are listed with descriptions in `.env.sample` (schema: `src/config/env.schema.ts`,
validated with Zod at startup; a missing/invalid env → `process.exit(1)`). Notes:

- OAuth opt-in: the `GOOGLE_/APPLE_/GAME_CENTER_/PLAY_GAMES_*` fields are not required. A provider left empty
  rejects requests at its sign-in endpoints but does not block startup.
- `MAIL_DRIVER`: `log` (default) or `resend` (required in prod; `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET`).
- Object storage (`S3_*`) is optional **as a group**: configure all four of endpoint, bucket and both keys, or
  none. A half-configured bucket is rejected at startup rather than on the first upload.
- `ACCOUNT_DELETION_GRACE_DAYS` and `AUDIT_RETENTION_DAYS` carry legal weight — set them deliberately.
- `CORS_ALLOWED_ORIGINS` (cross-origin web + credentials) and `APP_URL` (the web root that email links point to).

## Documentation

| Document                                                 | Contents                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)                   | Layers, what goes where, naming, code style, DB, authorisation, audit, storage |
| [`AGENTS.md`](./AGENTS.md) (= `CLAUDE.md`)               | AI agent guide — working principles + rules + commands                         |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                   | Commit / branch / PR / hook / release rules                                    |
| [`docs/client-integration/`](./docs/client-integration/) | Client integration — auth, the posts example                                   |
| [`docs/runbooks/`](./docs/runbooks/)                     | Operational runbooks — see the list below                                      |

Runbooks: [deployment](./docs/runbooks/dokploy-deployment.md) ·
[roles & first admin](./docs/runbooks/rbac-and-admin.md) ·
[audit log](./docs/runbooks/audit-log.md) ·
[object storage](./docs/runbooks/object-storage.md) ·
[DB backup](./docs/runbooks/database-backup.md) · [restore](./docs/runbooks/database-restore.md) ·
[replica](./docs/runbooks/database-replica.md) ·
[encryption key rotation](./docs/runbooks/encryption-key-rotation.md) ·
[JWT key rotation](./docs/runbooks/jwt-key-rotation.md) ·
[mail](./docs/runbooks/resend-mail.md)

## License

[MIT](./LICENSE).
