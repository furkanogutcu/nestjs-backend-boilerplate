# Auth — Client Integration Guide

This document describes how a client (web or mobile) integrates with the backend auth module at the level of **flows and key considerations**. React Native code is intentionally not provided; which endpoint is called when, where the returned data is stored, and what to watch out for are the responsibility of the client team.

> Source of truth: All values are taken from `src/modules/auth/*` and `src/config/*`. The machine-readable form of the endpoint contract lives in `openapi.json` (`pnpm docs:generate`).

---

## 1. Core concepts

There are three identity paths; all of them return the same token pair:

- **Email/password:** `POST /auth/register` (registration → immediate token + verification email), `POST /auth/login`. Email verification (`verify-email` / `resend-verification`) and password reset (`forgot-password` / `reset-password`) are separate flows. Passwords are hashed with argon2id.
- **OAuth (opt-in):** Google / Apple / (optional) Game Center / Play Games. **Linking** an identity to an existing account, or **signing in** with a linked identity. Providers are not required in production; only the providers you configure are active.
- **Guest (anonymous):** `POST /auth/guest` — the app can be used immediately without registration (`is_anonymous: true`); the account is later made permanent with email/password or OAuth (**upgrade**).

Critical consequence (OAuth sign-in): **Sign-in works only for an identity that has been linked previously.** If sign-in is attempted with a provider identity that has never been linked, `404 oauth_account_not_found` is returned; the client should route it to the registration/guest flow.

### Token model

| Token                  | Lifetime                                          | Where                                                                                        | Purpose                                                                 |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **access_token** (JWT) | 15 min (`900s`)                                   | Held in memory (preferred)                                                                   | The `Authorization: Bearer <token>` header of every protected request   |
| **refresh_token**      | 30 days idle, 90 days absolute on linked accounts | **mobile:** secure storage (Keychain/Keystore); **web:** HttpOnly cookie (set by the server) | Refreshing when the access_token expires + step-up proof during linking |

- `access_token` is short-lived and verified **statelessly** (signature + revocation check). When it expires it is renewed via refresh.
- `refresh_token` is **rotating**: every `refresh` call returns a **new** refresh_token and invalidates the old one (see "Rotation and reuse detection" below).
- The token type is always `Bearer` (the `token_type` field).

### Transport: web vs mobile (`X-Client-Type`)

The same endpoints serve both client types; the only difference is in **how the refresh token is transported**:

- **Mobile (default):** `refresh_token` is returned in the response body; the client keeps it in secure storage and sends it back in the body on `refresh`/step-up. `access_token` is in the Bearer header.
- **Web (send the `X-Client-Type: web` header):** `refresh_token` is **not returned in the body** — the server sets it as an **HttpOnly cookie** (inaccessible to JS). On a refresh call the cookie is sent automatically; for **CSRF**: call `GET /auth/csrf` (sets a readable `csrf_token` cookie), read its value, and reflect it in the `X-CSRF-Token` header on `refresh`/`logout` requests (double-submit). `access_token` is again Bearer (in memory).

---

## 2. Endpoint inventory

All routes live under `/api/v1/auth/...` (URI versioning, `defaultVersion: 1`).

### Public (no token required)

| Method & Path                    | Purpose                                  | Rate limit         |
| -------------------------------- | ---------------------------------------- | ------------------ |
| `POST /auth/register`            | Email/password registration + token pair | Strict (10/min)    |
| `POST /auth/login`               | Email/password login                     | Strict (10/min)    |
| `POST /auth/verify-email`        | Verify email with a verification token   | Strict (10/min)    |
| `POST /auth/resend-verification` | Resend the verification email            | Sensitive (5/min)  |
| `POST /auth/forgot-password`     | Request a password reset email           | Sensitive (5/min)  |
| `POST /auth/reset-password`      | Set a new password with a token          | Strict (10/min)    |
| `GET /auth/csrf`                 | Get a CSRF cookie (web)                  | Standard (100/min) |
| `POST /auth/guest`               | Create an anonymous user + token pair    | Strict (10/min)    |
| `POST /auth/refresh`             | Exchange a refresh token for a new pair  | Strict (10/min)    |
| `POST /auth/signin/nonce`        | Get a single-use nonce for sign-in       | Strict (10/min)    |
| `POST /auth/signin/google`       | Sign in with Google                      | Strict (10/min)    |
| `POST /auth/signin/apple`        | Sign in with Apple                       | Strict (10/min)    |
| `POST /auth/signin/game-center`  | Sign in with Game Center                 | Strict (10/min)    |
| `POST /auth/signin/play-games`   | Sign in with Play Games                  | Strict (10/min)    |

### Protected (`Authorization: Bearer <access_token>` required)

| Method & Path                 | Purpose                                    | Rate limit         |
| ----------------------------- | ------------------------------------------ | ------------------ |
| `GET /auth/me`                | Current user profile                       | Standard (100/min) |
| `POST /auth/logout`           | Revoke the session                         | Sensitive (5/min)  |
| `POST /auth/link/nonce`       | Get a single-use nonce for linking         | Sensitive (5/min)  |
| `POST /auth/link/google`      | Link a Google identity to the account      | Sensitive (5/min)  |
| `POST /auth/link/apple`       | Link an Apple identity to the account      | Sensitive (5/min)  |
| `POST /auth/link/game-center` | Link a Game Center identity to the account | Sensitive (5/min)  |
| `POST /auth/link/play-games`  | Link a Play Games identity to the account  | Sensitive (5/min)  |

> Rate limit key: counted **per user** on protected endpoints and **per IP** on public endpoints. On limit exhaustion `429` is returned (see §9).

---

## 3. First-launch flow (guest)

```
App first launch
  └─> Is there a refresh_token in secure storage?
        ├─ No  → POST /auth/guest  → store the token pair
        └─ Yes → continue with the existing refresh_token (refresh if needed)
```

**`POST /auth/guest`**

- **No** body. Optionally pass an `Idempotency-Key` header (**24–128 characters, base64url/hex/UUID format** — since this is an identity-less flow, a **high-entropy, random, single-use** value is required; e.g. UUIDv4).
- Response `201`:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "v1...",
  "token_type": "Bearer",
  "expires_in": 900,
  "player": { "id": "0192...", "is_anonymous": true }
}
```

**Why `Idempotency-Key`?** If the network drops before the guest-creation POST returns a response (timeout), the client retries; without a key the retry creates **a second guest user** and the first is lost irrecoverably. A retry with the same key returns the **same** result within 120s. For every guest-creation attempt the client should generate a **high-entropy random key** (e.g. UUIDv4) and use **the same** one on retries. **Security:** in an identity-less flow this key is effectively a secret — a fixed/predictable key can **leak** the first device's guest token pair to another device using the same key (hence a short TTL + random key are essential).

> Perform this operation only when there is **no** valid refresh_token in secure storage. Otherwise a new anonymous account is created over the existing account.

---

## 4. Using the token on protected requests

On every protected request:

```
Authorization: Bearer <access_token>
```

The guard verifies the following in order: signature + `issuer`/`audience` + expiry, then a session/family **revocation** check. On failure `401 unauthorized` is returned.

The current profile can always be verified with `GET /auth/me`:

```json
{
  "id": "0192...",
  "is_anonymous": false,
  "display_name": "Captain Nova",
  "linked_providers": [{ "provider": "google", "email": "player@example.com" }]
}
```

If `linked_providers` is empty the user is still a guest; show a "protect / link your account" call-to-action in the UI.

---

## 5. Token refresh

To obtain a new pair when the access_token expires (15 min):

**`POST /auth/refresh`**

```json
{ "refresh_token": "v1..." }
```

Optionally pass an `Idempotency-Key` header (16–128 characters, high-entropy single-use) — for retry safety (see below).

Response `200`: new `access_token` + **new** `refresh_token` + `expires_in`.

### Rotation and reuse detection

- Every successful refresh produces **a new refresh_token** and **revokes the old one**. The client must write the new refresh_token to storage **atomically** and must never use the old one again.
- The server applies **reuse detection**: if an already-used (rotated) refresh_token is sent again, the server treats this as a **token leak** and **revokes all sessions** of that family (family = the session chain of that device). The response is `401 refresh_token_reuse_detected`. In this case the user is **fully signed out** on that device → clear the tokens and return to the guest/sign-in flow.
- Therefore, **serialize** refresh calls (one refresh at a time). If multiple requests receive 401 at the same time and trigger parallel refreshes, one of them re-sends the old token and **accidentally triggers reuse detection.** Implement a **mutex / single-flight refresh**:

```
refresh() {
  if (alreadyInFlight) return awaitSameResult()
  lock()
  newPair = POST /auth/refresh  (Header: Idempotency-Key: newUUID)  { refresh_token: fromStore }
  writeToStoreAtomically(newPair)   // write first, then release the lock
  releaseLock()
}
```

- **Why `Idempotency-Key`?** If the network drops before the refresh response returns, the server may have already rotated the token; without a key the retry sends the **old (now revoked) token** and gets caught by reuse detection. With the `Idempotency-Key` header (16–128 characters), the same retry safely returns **the same new pair** within **24 hours**. Generate a key for each refresh attempt, reuse it on retry; discard it once a successful response is received.

### Proactive refresh

Relying on `expires_in` (seconds) to refresh the access_token **before it expires** (e.g. at ~80% of its lifetime) eliminates the 401 → retry latency. 401-based reactive refresh is also needed (§6 below), but do not rely on it alone.

---

## 6. Request interceptor logic (handling 401)

Recommended decision tree for every protected request:

```
Send request (Bearer access_token)
  ├─ 200/2xx → done
  └─ 401 →
       error.code == "unauthorized"               (access token expired/revoked)
            → try single-flight refresh
                 ├─ success → retry the request ONCE with the NEW access_token
                 └─ refresh 401 → go to the "session dead" branch below
       error.code in {                              (the refresh token itself is invalid)
         "invalid_refresh_token",
         "refresh_token_reuse_detected"
       }  → session dead:
            clear the tokens in storage → create a guest or route to the sign-in screen
```

- **`401 unauthorized`** is usually the access_token expiring/being revoked → resolved via refresh.
- **`401 invalid_refresh_token` / `refresh_token_reuse_detected`** comes from the refresh flow → unrecoverable, the session is over.
- Attempt refresh + retry **once** for the same request; do not loop on a second 401.

---

## 7. Account linking

Converts a guest user into a permanent account. The user must be **signed in (Bearer)**.

### 7.1 Step-up proof (why both an access and a refresh token?)

Linking is a sensitive operation that changes account ownership. Therefore two things are required at once:

1. **Bearer access_token** (header) → says which user it is.
2. **refresh_token** (`refresh_token` in the body) → "I actually own this device" step-up proof.

So on link calls the refresh_token is sent **in the body, not the header**; the access_token stays in the `Authorization` header as usual.

### 7.2 Nonce requirement (Google & Apple)

Google and Apple linking require a **single-use nonce** to be embedded in the provider ID token (replay protection):

```
1. POST /auth/link/nonce      (Bearer)         → { "nonce": "..." }   (TTL 120s, single use)
2. Obtain an ID token from the provider via the native SDK, embed the nonce in the token
3. POST /auth/link/google     (Bearer)
   body: { "id_token": "...", "refresh_token": "<current refresh_token>" }
```

- The nonce obtained via `link/nonce` is **user-specific** and valid for **120s**; it is consumed once. If it expires, obtain a new one.
- Apple specifics: the ID token contains the email but **not the name.** The name is provided only on the user's **first** Apple authorization; the client passes it in the optional `name` field of the `link/apple` body (the server treats it as untrusted and uses it only when display_name is empty):

```json
{ "id_token": "...", "refresh_token": "...", "name": "Nova" }
```

### 7.3 Game Center & Play Games linking (no nonce)

These two have **no** server-side nonce; they have their own freshness mechanisms. However the step-up `refresh_token` is still required.

**`POST /auth/link/game-center`** — output of GameKit `fetchItems(forIdentityVerificationSignature:)`:

```json
{
  "team_player_id": "A:_...",
  "public_key_url": "https://static.gc.apple.com/public-key/gc-prod-9.cer",
  "signature": "<base64>",
  "salt": "<base64>",
  "timestamp": 1717000000000,
  "refresh_token": "..."
}
```

- `timestamp` is in milliseconds and must be within a **±600s** freshness window → **the device clock must be correct.** If there is drift, the signature is rejected.
- `public_key_url` is pinned to the Apple host; send the URL provided by GameKit as-is.

**`POST /auth/link/play-games`** — the **single-use** server auth code obtained via `requestServerSideAccess`:

```json
{ "server_auth_code": "4/0Aean...", "refresh_token": "..." }
```

### 7.4 Linking response and conflicts

Successful linking returns the current `PlayerResponse` with `200` (`is_anonymous: false`, `linked_providers` populated). Possible errors:

- `401 invalid_refresh_token` → the refresh_token in the body is invalid/revoked.
- `401 invalid_oauth_token` → nonce missing/replay or provider token verification failed.
- `409 oauth_account_already_linked` → this provider identity is linked to **another user**. Re-linking to the same user is idempotent (still `200`).

> If the identity is already linked to this user, retrying is error-free. A conflict occurs only when the identity belongs to **someone else**.

---

## 8. Sign-in — another device / reinstall

For returning to a previously linked account. **No** token required (public).

### 8.1 Google & Apple (with nonce)

```
1. POST /auth/signin/nonce                 → { "nonce": "...", "expires_in": 300 }
2. Obtain an ID token via the native SDK, embed the nonce
3. POST /auth/signin/google
   body: { "id_token": "..." }
```

- The `signin/nonce` nonce is **global** (not tied to a user, no identity yet) and returns `expires_in` in seconds (default **300s**). Single-use.
- Response `200`: token pair + `player` (including linked_providers). Flow: verify token → consume nonce → **only then** resolve the account (to narrow the account-takeover surface).

### 8.2 Game Center & Play Games (no nonce)

No `signin/nonce` call is needed; directly:

- **`POST /auth/signin/game-center`** — the same GameKit fields as in linking (`team_player_id`, `public_key_url`, `signature`, `salt`, `timestamp`), **without** `refresh_token`.
- **`POST /auth/signin/play-games`** — `{ "server_auth_code": "..." }`.

### 8.3 If no account exists

`404 oauth_account_not_found`: no account is linked with this provider identity. The client should interpret this as **"new user"** → create a guest, and let the user link later if desired. Do not interpret sign-in as "auto-create if I have no account"; the server does **not** create an account on sign-in.

---

## 9. Error envelope and status codes

All errors return a single envelope type:

```json
{
  "error": {
    "code": "invalid_refresh_token",
    "message": "Invalid refresh token.",
    "requestId": "...",
    "traceId": "..."
  }
}
```

- **Build decision logic on `error.code`; do not rely on `message`** (human-readable, may change).
- Keep `requestId` and `traceId` for support/logging; log them when showing an error to the user.

Auth-related codes:

| HTTP | `code`                            | Meaning / Client action                                                                |
| ---- | --------------------------------- | -------------------------------------------------------------------------------------- |
| 400  | `validation_failed`               | Request body / `Idempotency-Key` validation failed → see `details`                     |
| 400  | `idempotency_key_conflict`        | The same `Idempotency-Key` was used with a different request body → generate a new key |
| 401  | `unauthorized`                    | access_token expired/revoked → try refresh                                             |
| 401  | `invalid_refresh_token`           | refresh_token invalid/revoked → clear the session                                      |
| 401  | `refresh_token_reuse_detected`    | Token reuse → **all device sessions revoked** → clear, sign in again                   |
| 401  | `invalid_oauth_token`             | nonce replay/missing or provider verification failed → restart the flow                |
| 404  | `oauth_account_not_found`         | No linked account (sign-in) → route to the guest flow                                  |
| 409  | `oauth_account_already_linked`    | Identity belongs to another user → notify the user                                     |
| 409  | `idempotency_request_in_progress` | A request with the same `Idempotency-Key` is still being processed → retry shortly     |
| 429  | `rate_limit`                      | Limit exceeded → wait for `Retry-After`                                                |

### 429 — Rate limiting

On limit exhaustion `429` is returned along with these headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`. The client **must wait for `Retry-After` (seconds)** and must not retry blindly. Take particular care on Sensitive (5/min) endpoints (logout, link/\*) and Strict (10/min) endpoints (guest, refresh, signin/\*); serializing refresh also reduces hitting this limit.

Rate limiting is **fail-closed**: the counter is kept in Redis, and if Redis is unreachable the request is rejected with `503 service_unavailable` instead of falling back to in-memory (during short outages all endpoints may be affected). On `503` the client should retry with exponential backoff.

---

## 10. What to store where

| Data                                                            | Storage                                                                        | Note                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `refresh_token`                                                 | **Secure storage** (iOS Keychain / Android Keystore; `expo-secure-store` etc.) | **Never** `AsyncStorage`/plain file. The single critical secret.                          |
| `access_token`                                                  | Memory (preferred) or secure storage                                           | Short-lived; keeping it in memory and obtaining it via refresh on each launch is cleanest |
| `player.id`, `is_anonymous`, `display_name`, `linked_providers` | Normal storage (cache)                                                         | For the UI; not authoritative — refresh via `GET /auth/me` when needed                    |
| `nonce` (link/signin)                                           | **Memory only**                                                                | Single-use, short-lived; do not persist                                                   |
| `Idempotency-Key`                                               | Memory (for the duration of the active request)                                | Same on retry; discard after success; random/single-use                                   |

General rules:

- Responses carry `Cache-Control: no-store` → do **not** cache responses containing tokens.
- Do **not** log tokens, send them to analytics, or include them in crash reports.
- On logout/session-dead, **delete** the refresh_token from secure storage.

---

## 11. Session lifecycle limits (for UX)

- **Idle window (refresh TTL):** Every refresh use slides the window to 30 days. If the device does not refresh at all for **longer than 30 days**, the refresh_token dies.
  - **Dangerous for guests:** The only key to an anonymous account is the refresh_token on this device. 30 days idle + token loss = the account is **unrecoverable**. Therefore encourage the user toward **linking** early.
- **Hard cap (linked accounts only):** A linked account's session chain lives for at most **90 days**; afterward refresh returns `401` and the user must sign in again via **sign-in**. This is expected (security) → route to the sign-in flow; do not treat it as an error.
- **Multi-device limit:** A user can hold at most **10 active families (≈ devices)**. When the 11th is opened, the oldest family is revoked → that old device is silently signed out (401 on the next refresh).
- **Logout:** `POST /auth/logout` revokes only **the current session** (and its refresh chain); it does not affect other devices. Returns 204.

---

## 12. Quick integration checklist

- [ ] First launch: if there is no refresh_token in secure storage, `POST /auth/guest` (+ `Idempotency-Key`).
- [ ] Store the refresh_token in **secure storage**; access_token in memory.
- [ ] **Single-flight** refresh mutex + an `Idempotency-Key` header for every refresh.
- [ ] Request interceptor: 401 distinction (`unauthorized` → refresh+retry; `invalid_refresh_token`/`reuse` → clear the session).
- [ ] Proactive refresh via `expires_in` (~80%).
- [ ] Linking: first `link/nonce` (Google/Apple), then `link/<provider>` (Bearer + `refresh_token` in the body).
- [ ] Sign-in: first `signin/nonce` (Google/Apple), then `signin/<provider>`; `404` → guest flow.
- [ ] Game Center: correct device clock (±600s), pass the GameKit fields as-is.
- [ ] Error logic via **`error.code`**; on `429` honor `Retry-After`.
- [ ] Do not log/cache tokens; clear secure storage on session-dead.

---

## 13. Provider-side notes (client configuration)

The backend verifies provider tokens according to the following assumptions — client SDKs must be configured accordingly:

- **Google:** the ID token's `aud` must be one of the client IDs the backend recognizes (`GOOGLE_OAUTH_CLIENT_IDS`). On sign-in/link the ID token must be minted with the relevant nonce.
- **Apple:** `aud` is one of the bundle/service IDs the backend recognizes (`APPLE_OAUTH_CLIENT_IDS`); `iss` is `https://appleid.apple.com`. The name is provided only on the first authorization → pass it via `name` in `link/apple`.
- **Game Center:** send the entire output of `fetchItems(forIdentityVerificationSignature:)` (`teamPlayerID`, `publicKeyUrl`, `signature`, `salt`, `timestamp`); the bundle ID must be one the backend recognizes (`GAME_CENTER_BUNDLE_IDS`).
- **Play Games (Android):** obtain a **single-use** server auth code via `requestServerSideAccess`; the backend exchanges it with its own client ID/secret.

Platform mapping (typical): iOS → **Apple** + **Game Center**, Android → **Google** + **Play Games**. Google sign-in can also be used platform-independently.

> The full list of these config values (`*_CLIENT_IDS`, `*_BUNDLE_IDS`, etc.) and their per-environment values are obtained from the backend team; `.env.sample` is the reference.
