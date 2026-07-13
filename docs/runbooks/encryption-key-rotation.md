# Runbook: Sensitive (encryption) key rotation

Sensitive data is encrypted by `SensitiveService` using **AES-256-GCM**, over a `kid` (key id) based
**keyring**. Encryption/decryption is in `src/infrastructure/sensitive/sensitive.service.ts`; the key set
comes from the `ENCRYPTION_KEYS` / `ENCRYPTION_ACTIVE_KID` env variables (for the format, see
`.env.sample`).

- **Encryption:** each payload is encrypted with the active key (`ENCRYPTION_ACTIVE_KID`); the output
  envelope is in the format `v1:<kid>:<iv>:<ciphertext+authTag>`, i.e. **the kid is embedded in the
  ciphertext**.
- **Decryption:** the corresponding key is selected from the keyring by the `kid` in the envelope; for a
  kid not in the keyring, an `Unknown encryption key id` error is raised.

## Critical difference from JWT rotation: ciphertext is permanent

The access tokens in `docs/runbooks/jwt-key-rotation.md` expire within 15 min; there, "wait a TTL, then
drop the old key" is sufficient. **That is not the case here:** as long as data encrypted with a kid
**remains on disk**, that kid's key must stay in the keyring — otherwise that data becomes **permanently
unreadable.** Before removing a key from the keyring, ensure that **all** data encrypted with that key has
either expired or been re-encrypted with the active key.

### Current consumers (data lifetime)

| Consumer                                   | Storage    | Lifetime                |
| ------------------------------------------ | ---------- | ----------------------- |
| `IdempotencyService` (`auth:*` cache)      | Redis      | TTL-bound (short-lived) |
| `CacheService` (`encrypt: true` writes)    | Redis      | TTL-bound (short-lived) |
| `oauth_account.email` (`@EncryptedColumn`) | PostgreSQL | **Permanent**           |

There is now **permanent at-rest (DB column) encrypted data** (`oauth_account.email`; every new column added
with `@EncryptedColumn` also falls under this). So waiting for the Redis TTL is **no longer enough** to drop
an old key — the **DB rows** encrypted with that key must also be re-encrypted with the active key (the
"Permanent (DB)" branch of step 3 below).

> **Warning:** There is currently **no ready re-encrypt tool**. Lazy rotation (keeping the old key in the
> keyring) is safe and valid; but the moment a key is to be **dropped/retired** (compliance, cryptoperiod,
> or a leak), this tool must be written first.

## Standard rotation procedure

Assume the active key is `k1` and the new key is `k2`.

1. **Generate the new key and add it to the keyring** (do not change the active one yet):

   ```
   # openssl rand -hex 32
   ENCRYPTION_KEYS=k1:<old-hex>,k2:<new-hex>
   ENCRYPTION_ACTIVE_KID=k1
   ```

   Deploy. Now all instances can **decrypt** data encrypted with `k2`, but still **encrypt** with `k1`.
   (This guarantees that, in a multi-instance environment, all instances recognize the new active key
   before switching to it.)

2. **Switch the active key to the new one:**

   ```
   ENCRYPTION_ACTIVE_KID=k2
   ```

   Deploy. New encryptions use `k2`; existing data encrypted with `k1` continues to decrypt because `k1`
   remains in the keyring.

3. **Consume or re-encrypt data encrypted with the old key:**
   - **For ephemeral (Redis) data:** wait until entries written with `k1` fall off via TTL. Optionally, to
     shorten the process, flush the relevant namespaces (`app:idempotency:*`, `app:cache:*` — see
     `app.config.ts` `keyPrefixes`). A flush only empties the cache without warming it; there is no permanent
     loss.
   - **For permanent (DB) data:** run a **re-encrypt sweep** that rewrites rows encrypted with the old key
     using the active key — mandatory for `oauth_account.email` and every column added with
     `@EncryptedColumn`. Thanks to the `@EncryptedColumn` pattern the sweep is simple: `find` the relevant
     entities in batches and `save` them again — load decrypts with the old kid, save re-encrypts with the
     active kid. It must be idempotent (rows whose envelope prefix is `v1:<active-kid>:` are skipped).
     (No tool exists yet; it must be written before the first real rotation.)

4. **Drop the old key** — only when step 3 is **fully** complete:

   ```
   ENCRYPTION_KEYS=k2:<new-hex>
   ENCRYPTION_ACTIVE_KID=k2
   ```

   Deploy. After this, if an envelope encrypted with `k1` arrives it is rejected with `Unknown encryption
key id` — which is why it is critical not to skip step 3.

## Emergency rotation (key leak)

If a key is suspected to be leaked:

1. Add a new key and switch the active one to it (steps 1–2) → **new** encryptions are now safe.
2. **Existing** data encrypted with the leaked key is still readable with that key; changing the active key
   does not undo this. Neutralize this data **immediately**:
   - **Ephemeral (Redis):** **flush** the relevant namespaces **immediately** (do not wait for the TTL).
   - **Permanent (DB):** **urgently** re-encrypt the affected rows (backfill).
3. Once the above is done, remove the leaked kid from the keyring. Depending on the scope of the leak,
   assess whether the secrets the key protected (e.g. idempotency content) also need to be invalidated.

## Verification

- After rotation, encrypt a new value and confirm the envelope prefix carries the new active kid:
  `value.split(':').slice(0, 2)` → `['v1', '<new-kid>']`.
- Confirm an envelope written with the old key (if it is still in the keyring) can still be decrypted.
- After the old key is dropped, confirm that an envelope carrying that kid is rejected with `Unknown
encryption key id`.
