# Postman collection

The Postman collection here is **not maintained by hand** — it is generated from `openapi.json` with
[Portman](https://github.com/apideck-libraries/portman). A single command:

```bash
pnpm postman:generate
```

This first refreshes `openapi.json` via `docs:generate`, then generates
`postman/app-api.postman_collection.json` (gitignored — not kept in the repo, generated on demand). Import
it into Postman; `{{baseUrl}}` is already the first server (`http://localhost:4001`). Run a token-producing
request (e.g. `POST /auth/guest`) → the token is written to a collection variable → protected requests use
`{{bearerToken}}` automatically.

## Files in this directory (committed)

| File                      | Purpose                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `openapi-to-postman.json` | Collection-wide converter settings: folders by Tag, use examples, name source. |
| `portman-config.json`     | Token automation (`assignVariables`), auto-value injection, contract tests.    |

`*.postman_collection.json` is generated output and is in `.gitignore`.

## When adding an endpoint

**For a normal endpoint, these files need no changes.** The folder (from the Tag), the example body
(from `.meta({ example })`), the schema, the contract test (`*::/*` on every request), and bearer auth
(from `@ApiBearerAuth()`) all flow automatically from OpenAPI. What produces a high-quality endpoint (a
schema `.meta({ example })`, `@ApiOperation`, `@ApiBearerAuth`, `@ApiTags`) lives **on the code side** —
see `ARCHITECTURE.md` → "API documentation" / "Postman collection (Portman)".

> **The request name comes from `@ApiOperation({ summary })`** (`requestNameSource: Fallback`). Keep it a
> short label (~1–4 words; e.g. `Guest login`); put longer prose in `description`. A long summary makes the
> request name in Postman long as well.

Add to `portman-config.json` only in these cases:

- **An endpoint that returns a value used by later requests** (a new token, a created record id):
  add an entry to `assignVariables` —
  `{ "openApiOperation": "POST::/api/v1/<path>", "collectionVariables": [{ "responseBodyProp": "data.<x>", "name": "<var>" }] }`.
  `responseBodyProp` uses the envelope-inclusive path (`data.<x>`), because responses are wrapped in `{ data: ... }`.
- **Auto-value injection for a request** (e.g. `Idempotency-Key` → `{{$guid}}`): `globals.keyValueReplacements`.
- **A new auth scheme other than Bearer**: `globals.securityOverwrites`.
