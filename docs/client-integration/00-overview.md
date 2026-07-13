# Client Integration Guides (Overview)

This folder describes how a client (web or mobile) integrates with the backend at the level of **flows and
key considerations**. Client code is intentionally not provided; which endpoint is called when, where the
returned data is stored, and what to watch out for are the responsibility of the client team.

> **Source of truth:** The machine-readable and **authoritative** form of the endpoint contract lives in
> `openapi.json` (generated with `pnpm docs:generate`). These documents are the flow / key-consideration
> layer; in case of a conflict, `openapi.json` + the backend code win.

## Guides

| #   | Document                             | Topic                                                          |
| --- | ------------------------------------ | -------------------------------------------------------------- |
| 00  | **this document**                    | Common concepts and contract that apply across all integration |
| 01  | [`01-auth.md`](./01-auth.md)         | Identity: email/password, OAuth, guest, token model, transport |
| 05  | [`05-realtime.md`](./05-realtime.md) | Real-time push channel (WebSocket)                             |

As domain modules are added, further guides (`02-…`, …) are added to this series.

## Common contract (applies to every endpoint)

### Base URL and versioning

All routes live under **`/api/v1/...`** (URI versioning, `defaultVersion: 1`).

### Identity

Protected endpoints require `Authorization: Bearer <access_token>` (see `01-auth.md`). Each document
additionally states which endpoint is public and which is protected.

### Response envelope

The backend wraps every response in a fixed envelope:

| State             | Body                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Success           | `{ "data": <payload> }`                                                                                       |
| Paginated list    | `{ "data": [ … ], "meta": { … } }`                                                                            |
| Message only      | `{ "message": "…" }`                                                                                          |
| Empty (204 / 304) | no body                                                                                                       |
| Error             | `{ "error": { "code": string, "message": string, "requestId"?: string, "traceId"?: string, "details"?: … } }` |

- **The error `code` is a stable, machine-readable key** (e.g. `unauthorized`, `resource_not_found`).
  Build client logic on HTTP status + `code`; `message` is for humans and may change. Valid
  `code`s and error bodies are listed in each endpoint's error response in `openapi.json`.
- `requestId` / `traceId` are for support/log correlation; including them in error reports is helpful.

### Field format (snake_case)

Wire fields and query params are **`snake_case`** (`page_size`, `order_by`, `created_at`). The cursor/offset
pagination meta body has a standard shape (`openapi.json`).
