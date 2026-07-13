---
description: Performs an OWASP Top 10 / API Security Top 10 + hardening audit from a senior security expert's perspective and produces a structured report.
argument-hint: '[optional: focus area — e.g. auth, rate-limit, config]'
allowed-tools: Read, Grep, Glob, Bash(pnpm audit:*), Bash(pnpm outdated:*), Bash(git diff:*), Bash(git log:*)
---

Act as a senior **Cybersecurity Expert** and **DevSecOps engineer**. This repository is a **NestJS 11 + TypeScript RESTful backend API** serving web and mobile clients (PostgreSQL/TimescaleDB · Redis · Kafka · BullMQ · TypeORM · Zod · pino). Perform a comprehensive **security review**.

This is a read-only **audit**: do not modify code, only report. Present remediation examples as suggestions; if the user approves, you apply them in a separate phase (CLAUDE.md phase/approval principle).

## Scope

If `$ARGUMENTS` is provided, focus the review on that area; if empty, scan the entire surface.

Two core axes:

1. **OWASP Top 10 + OWASP API Security Top 10** — Broken Authentication/Authorization (BOLA/BFLA), injection (SQL/NoSQL/command), excessive data exposure, mass assignment, sensitive data leakage, SSRF, insecure deserialization, business logic/authorization bypass.
2. **Hardening** — secure HTTP headers, rate limiting, CORS, error handling/information leakage, secret management, dependency security.

## Areas that must be checked in this repository

Do not guess — read and audit these actual files:

- **Bootstrap & header hardening:** `src/main.ts` (is helmet present? CORS `origin` policy, `x-powered-by`, is `trust proxy` correct/safe, body limit, HTTP timeouts), `src/config/app.config.ts`, `src/config/env.schema.ts`.
- **Rate limiting:** `src/config/rate-limit.config.ts`, `src/shared/guards/rate-limit.guard.ts`, `src/shared/decorators/rate-limit.decorator.ts`, `src/infrastructure/rate-limit/`, `src/shared/enums/rate-limit.enum.ts` — are the authentication/OAuth endpoints protected strictly enough, is the key (IP/user) correct, fail-open or fail-closed.
- **Authentication/authorization:** `src/modules/auth/` (especially `guards/`, `oauth/`, `entities/`, the token/session/refresh flow, `auth.controller.ts`, `oauth/oauth.controller.ts`) — token generation/verification, OAuth state/PKCE/nonce, account linking, idempotency, password/secret storage, BOLA (is the user accessing only their own resource).
- **Sensitive data & encryption:** `src/infrastructure/sensitive/`, `src/infrastructure/security/` — encryption algorithm/mode (GCM AAD binding, etc.), key management, at-rest protection of fields.
- **Injection & input validation:** are Zod request schemas (`schemas/*.request.ts`) present on all endpoints; is there raw/`query(`/string-concat SQL in TypeORM usage; `src/shared/pipes/`.
- **Error handling & information leakage:** `src/shared/exceptions/`, exception filters, `src/shared/interceptors/` — does any stack trace/internal detail leak to the client, are error bodies consistent/snake_case.
- **Logging & privacy:** pino redaction configuration — do token, password, Authorization header, or PII end up in logs.
- **Dependency security:** run `pnpm audit` and `pnpm outdated`; report critical/high CVEs.

## Report format

First, a 1-2 sentence overall assessment + a summary table by risk level (counts of Critical/High/Medium/Low). Then present each finding in the following format:

### [Risk Level] Vulnerability Name

- **Location / Affected Code:** `file:line` (short code excerpt if possible)
- **Cause & Potential Impact:** the root cause of the vulnerability and what happens if it is exploited
- **Remediation:** a directly applicable secure code/configuration example that conforms to this project's conventions (Zod schema, `AppException` hierarchy, named-parameter, snake_case wire contract)

List findings in descending order of risk level. For an area you reviewed but found no issues in, collect the audited-but-clean topics into a short "Clean" list at the end to avoid false-positive fatigue. Mark speculative/theoretical findings separately from real ones.
