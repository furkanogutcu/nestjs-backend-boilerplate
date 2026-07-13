# Runbook: JWT access-token signing key rotation

Access tokens are signed with HS256, over a `kid` (key id) based **keyring**. Signing and verification are in
`src/modules/auth/services/token.service.ts`; the key set comes from the `JWT_ACCESS_KEYS` /
`JWT_ACCESS_ACTIVE_KID` env variables (for the format, see `.env.sample`).

- **Signing:** each token is signed with the active key (`JWT_ACCESS_ACTIVE_KID`) and the `kid` is written to
  the header.
- **Verification:** the corresponding key is selected from the keyring in **O(1)** by the token's `kid`
  header; a token that is not in the keyring or has no `kid` is rejected. Keys are **not tried** in sequence →
  a constant cost per token.

This allows the key to be changed on a secret leak or during periodic rotation without forcibly logging users
out ("overlap window").

## When to rotate

- When the signing secret is suspected to be leaked (**emergency** — see the "Emergency" note below).
- Periodic hygiene (e.g. yearly).

## Overlap-window procedure (zero-downtime)

Assume the active key is `jwt-2024` and the new key is `jwt-2025`.

1. **Generate the new key and add it to the keyring** (do not change the active one yet):

   ```
   # openssl rand -base64 48
   JWT_ACCESS_KEYS=jwt-2024:<old-secret>,jwt-2025:<new-secret>
   JWT_ACCESS_ACTIVE_KID=jwt-2024
   ```

   Deploy. Now all instances can **verify** tokens signed with `jwt-2025`, but still **sign** with
   `jwt-2024`. (This step guarantees that, in a multi-instance environment, all verifiers recognize the new
   key before switching to the new active key.)

2. **Switch the active key to the new one:**

   ```
   JWT_ACCESS_ACTIVE_KID=jwt-2025
   ```

   Deploy. New tokens are signed with `jwt-2025`; old tokens signed with `jwt-2024` remain valid because it
   stays in the keyring.

3. **Wait:** at least `JWT_ACCESS_TTL_SECONDS` (default 900 s / 15 min) — the last tokens signed with the old
   active key expire within this window. Wait somewhat longer for a safety margin.

4. **Drop the old key:**

   ```
   JWT_ACCESS_KEYS=jwt-2025:<new-secret>
   ```

   Deploy. After this, if a token signed with `jwt-2024` arrives it receives `401` (they had all expired
   already).

## Emergency rotation (secret leak)

If tokens signed with the leaked key must be invalidated **immediately**, do not wait for the overlap window:
skip step 3 and remove the leaked `kid` from the keyring **immediately** (1→2→4). This immediately drops all
active tokens signed with that key to `401` — that is, clients carrying that key lose their access token on
the next request but obtain a new pair (signed with the new key) via the **refresh token**; if the refresh
token has not leaked, the user flow continues uninterrupted. If the refresh token itself has also leaked,
additionally revoke the relevant sessions/families.

## Verification

- After rotation, obtain a new token (`POST /auth/guest` or refresh) and, by decoding it, confirm the `kid` in
  its header is the new active key.
- Make a request to a protected endpoint (`GET /auth/me`) with the new token → `200`.
- A token signed with a dropped `kid` should now receive `401 unauthorized`.
