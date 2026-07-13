# NestJS Backend Boilerplate

Production-grade **NestJS 11 + TypeScript** backend boilerplate. Provides authentication, Kafka, caching,
mail, realtime, observability, CI, and a full test setup out of the box; domain modules are added on top.
`modules/` currently contains only `auth`. Package manager **pnpm**, Node **≥22**.

Stack: PostgreSQL/TimescaleDB · Redis · Kafka · BullMQ · TypeORM · Zod (nestjs-zod) · pino ·
OpenTelemetry · Resend · socket.io.

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
    [Idempotency](#idempotency) · [Auth](#auth) · [Kafka reliability](#kafka-reliability) ·
    [Background jobs](#background-jobs-bullmq) · [Transactional mail](#transactional-mail-resend) ·
    [Realtime](#realtime-websocket) · [Cache](#cache-read-through) · [Observability](#observability) ·
    [Health](#health) · [Security](#security)
- [Commands](#commands) · [Test](#test) · [Database & migration](#database--migration) ·
  [Deployment](#deployment) · [Customization](#customization) ·
  [Configuration](#configuration) · [Documentation](#documentation)

## Why this boilerplate

- **Uniform API contract** — every success response is in a `data`/`meta`/`message` envelope, every error
  in an `error` envelope; both validated and serialized with Zod.
- **Zod-first OpenAPI** — no `@ApiProperty` in controllers; the docs are generated from the validation
  schema, and the build fails on drift (enforced in CI). Scalar UI + Postman collection generation are ready.
- **Full durability on Kafka** — transactional outbox → relay → idempotent inbox → tiered retry → DLQ,
  built on real primitives.
- **Request traceability** — every request gets an `X-Request-Id`, automatically bound to pino logs and
  OpenTelemetry traces.
- **Secure defaults** — argon2id, a JWT keyring + kid rotation, refresh reuse detection, two-layer
  rate limiting, at-rest PII encryption, helmet, CSRF, fail-closed Redis.
- **Testability** — unit + integration (Testcontainers) + e2e (supertest); a deterministic clock, the
  env-on-import rule, ready-made factories.

## Technology stack

| Area                 | Technology                                                                  |
| -------------------- | --------------------------------------------------------------------------- |
| Framework            | NestJS 11, TypeScript, Express                                              |
| Database             | PostgreSQL / TimescaleDB, TypeORM (`SnakeNamingStrategy`, app-side UUIDv7)  |
| Cache / coordination | Redis (ioredis) — read-through cache + lock/rate-limit/idempotency/nonce    |
| Messaging            | Kafka (kafkajs) — outbox/inbox/retry/DLQ                                    |
| Job queue            | BullMQ                                                                      |
| Validation           | Zod + nestjs-zod                                                            |
| Realtime             | socket.io (+ Redis adapter, multi-instance fanout)                          |
| Observability        | OpenTelemetry, Prometheus, pino, Sentry, Grafana/Loki/Tempo                 |
| Mail                 | Resend (log driver fallback), handlebars template                           |
| Auth crypto          | `@node-rs/argon2`, jose (JWT/JWK)                                           |
| Quality              | ESLint, Prettier, Jest, husky, commitlint, semantic-release, GitHub Actions |

## Quick start

Required: **Node ≥ 22** + **pnpm** (`corepack enable`), and **Docker** (local infrastructure + Testcontainers).

```bash
pnpm install                                              # 1. dependencies
cp .env.sample .env                                       # 2. env — fill in the "Required" fields
docker compose -f docker-compose.development.yml up -d    # 3. Postgres + Redis + Kafka + Kafka-UI
pnpm db:create && pnpm db:migration:run                   # 4. database: create → migrate
pnpm start:dev                                            # 5. server in watch mode
```

Security keys (required in `.env`): `ENCRYPTION_KEYS`, `JWT_ACCESS_KEYS`, `REFRESH_TOKEN_PEPPER`.

```bash
openssl rand -hex 32       # key for ENCRYPTION_KEYS (kid:hex)
openssl rand -base64 48    # JWT_ACCESS_KEYS secret (kid:secret) and REFRESH_TOKEN_PEPPER
```

Verify:

| What                       | URL                                             |
| -------------------------- | ----------------------------------------------- |
| API root                   | `http://localhost:4001/api/v1`                  |
| Liveness                   | `GET /api/v1/health` → `{ "status": "ok" }`     |
| Readiness                  | `GET /api/v1/health/ready` (db + redis + kafka) |
| API documentation (Scalar) | `http://localhost:4001/api/docs`                |
| Raw OpenAPI                | `http://localhost:4001/api/docs-json`           |

Local connections (`docker-compose.development.yml`): `postgresql://app:app@localhost:5442/app` ·
`redis://localhost:6389` · `KAFKA_BROKERS=localhost:9192`.

## Architecture

```text
src/
├─ config/          # env schema + validation (Zod), app config
├─ shared/          # exceptions, guards, interceptors, pipes, decorators, utils, Zod response
├─ infrastructure/  # kafka, redis, cache, mail, queues, realtime, observability, database, docs, health…
├─ modules/         # domain modules — currently only: auth
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
- `openapi.json` is committed in the repo; generated with `pnpm docs:generate` (no DB/Redis/Kafka needed), and CI fails on drift.
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

### Kafka reliability

Domain code **never publishes to Kafka directly** — always through the **transactional outbox**. End to end:
**the business write + the outbox row in a single DB transaction** → a relay job publishes the outbox → an
**idempotent inbox** (dedup) consumes it → on error, **tiered retry** → on exhaustion, **DLQ**.

```text
business TX { domain write + outbox insert }
   → relay  → Kafka topic
      → consumer (inbox dedup: eventId / dedupKey)
         → error → retry.5s → retry.1m → retry.10m → <topic>.dlq
```

The event envelope (a Zod discriminated union over `topic`; core metadata is also reflected in `x-event-*` headers):

```jsonc
{
  "meta": {
    "eventId": "0192…",
    "eventVersion": 1,
    "timestamp": "1717000000000",
    "dedupKey": "…",
    "traceId": "4bf92f…",
    "producer": "app",
  },
  "topic": "user.registered",
  "data": {/* payload validated by the schema for the topic */},
}
```

- Retry tiers: **5s → 1m → 10m** (non-blocking; the partition is not blocked), then `<topic>.dlq`.
- DLQ replay + outbox requeue scripts: `pnpm kafka:dlq:replay` · `pnpm kafka:outbox:requeue`.
- Prometheus: `kafka_outbox_pending`, `kafka_outbox_published_total`, `kafka_retry_total{tier}`,
  `kafka_dlq_total{topic}`, `kafka_inbox_duplicates_total`. Each consume is wrapped in a Sentry span
  (the producer's `traceId` is attached → end-to-end correlation).
- Recipe for adding a new event: the `kafka-event` skill.

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

### Realtime (WebSocket)

A socket.io gateway; generic **server→client push**. Kafka `realtime.*` events are distributed to socket
rooms by a fanout consumer. On session revocation, the affected sockets are **kicked**. Redis adapter for
**multi-instance fanout** (horizontal scale). Driver: `REALTIME_DRIVER=socketio|log|off`. Integration:
[`docs/client-integration/`](./docs/client-integration/).

### Cache (read-through)

A single door, `CacheService` (`get`/`set`, `app:cache:*` namespace, optional encryption, **fail-open** —
falls back to the DB on a cache miss). Atomic coordination (lock/rate-limit/idempotency/nonce/replay/denylist)
goes through `RedisService`. **Redis unreachability is fail-closed by default**: the wrapped client throws
`503` on a Redis transport error; graceful degradation is opt-in via `try/catch`. All keys are built with
`CacheKey.join(...)` + the config prefix.

### Observability

- **Metrics:** Prometheus `GET /api/v1/metrics` (basic-auth). HTTP RED + Kafka reliability + runtime metrics.
- **Traces:** OpenTelemetry, automatic instrumentation (http, express, nestjs, pg, ioredis, kafkajs), OTLP → Tempo.
- **Logs:** pino → (dev) pretty / (prod) JSON → Loki; `reqId` + `traceId` in every log.
- **Errors:** Sentry.
- **Local stack:** `pnpm obs:up` (Grafana + Prometheus + Loki + Tempo); ready-made dashboards: HTTP RED, Kafka
  reliability, runtime. Shut down with `pnpm obs:down`.

### Health

- `GET /api/v1/health` — **liveness** → `{ "status": "ok" }`.
- `GET /api/v1/health/ready` — **readiness**: database + Redis + Kafka indicators; `503` if unhealthy
  (`@nestjs/terminus`, the result is cached briefly).

### Security

- **at-rest PII encryption** — sensitive columns are encrypted with a keyring (`ENCRYPTION_KEYS`, with kid rotation support).
- **helmet** security headers; a **CORS** allow-list (`CORS_ALLOWED_ORIGINS`); **enforced HTTPS** in prod
  (`RequireHttpsGuard`).
- **CSRF** — double-submit for web (`GET /auth/csrf` → cookie + `X-CSRF-Token`).
- **Cache-Control deny-by-default** — all responses are `no-store`; a cacheable endpoint opts in explicitly.
- Sensitive header/body fields are redacted in logs; secrets are validated at startup via the env schema.

---

## Commands

| Task                                | Command                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Development (watch)                 | `pnpm start:dev`                                                                           |
| Lint / type-check                   | `pnpm lint` · `pnpm typecheck`                                                             |
| Test (unit / integration / e2e)     | `pnpm test` · `pnpm test:integration` · `pnpm test:e2e`                                    |
| Migration (generate / run / revert) | `pnpm db:migration:generate <name>` · `pnpm db:migration:run` · `pnpm db:migration:revert` |
| Generate OpenAPI / Postman          | `pnpm docs:generate` · `pnpm postman:generate`                                             |
| Kafka DLQ replay / outbox requeue   | `pnpm kafka:dlq:replay` · `pnpm kafka:outbox:requeue`                                      |
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
column), optional TimescaleDB (hypertable/retention/compression). Details: the `db-migration` skill.

## Deployment

`Dockerfile` (multi-stage) + `docker-compose.production.yml`. Migrations run at container startup
(`start:prod`). Deployment and operational procedures (DB backup/restore/replica, key rotation, Kafka DLQ):
[`docs/runbooks/`](./docs/runbooks/).

## Customization

The boilerplate ships with the `app` slug and the display name `NestJS Backend Boilerplate`. What to change:

| What                    | Where                                                              | Note                                                                                                     |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Technical slug (`app`)  | `src/config/app.config.ts` → `namespace`                           | The Redis key prefix, Kafka clientId, event producer, and service name derive from it. Short, no spaces. |
| Display name            | `src/config/app.config.ts` → `name`                                | Appears in emails and the OpenAPI title.                                                                 |
| OpenAPI title           | `src/infrastructure/docs/openapi.factory.ts`                       | `App API` → your own API name.                                                                           |
| Package identity        | `package.json` → `name`, `description`, `author`, `repository.url` | Leave `version` at `0.0.0` (semantic-release manages it).                                                |
| License holder          | `LICENSE`                                                          | The copyright line; if the license changes, update `package.json > license` as well.                     |
| JWT iss/aud             | `.env` → `JWT_ISSUER`, `JWT_AUDIENCE`                              | Default `app`.                                                                                           |
| Mail sender             | `.env` → `MAIL_FROM_NAME`, `MAIL_FROM`                             | Sender name + address.                                                                                   |
| Observability labels    | `docker/observability/**` · `.env` → `OTEL_SERVICE_NAME`           | Prometheus labels and Grafana dashboard titles use `app`.                                                |
| Docker service/DB names | `docker-compose*.yml`                                              | Service and database names.                                                                              |

When `app.config.ts > namespace` is changed, the Redis keys, Kafka clientId, and event `producer` field
update automatically because they derive from `appConfig.slug`.

## Configuration

Environment variables are listed with descriptions in `.env.sample` (schema: `src/config/env.schema.ts`,
validated with Zod at startup; a missing/invalid env → `process.exit(1)`). Notes:

- OAuth opt-in: the `GOOGLE_/APPLE_/GAME_CENTER_/PLAY_GAMES_*` fields are not required. A provider left empty
  rejects requests at its sign-in endpoints but does not block startup.
- `MAIL_DRIVER`: `log` (default) or `resend` (required in prod; `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET`).
- `REALTIME_DRIVER`: `log`, `socketio` (required in prod), or `off`.
- `CORS_ALLOWED_ORIGINS` (cross-origin web + credentials) and `APP_URL` (the web root that email links point to).

## Documentation

| Document                                                 | Contents                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)                   | Layers, what goes where, naming, code style, DB, Kafka, cache                         |
| [`AGENTS.md`](./AGENTS.md) (= `CLAUDE.md`)               | AI agent guide — working principles + rules + commands                                |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                   | Commit / branch / PR / hook / release rules                                           |
| [`docs/client-integration/`](./docs/client-integration/) | Client integration — auth, realtime                                                   |
| [`docs/runbooks/`](./docs/runbooks/)                     | Operational runbooks — deployment, DB backup/restore/replica, key rotation, Kafka DLQ |

## License

[MIT](./LICENSE).
