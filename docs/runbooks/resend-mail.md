# Runbook: Transactional mail (Resend) setup and operations

Operational procedures for the mail infrastructure: provider (Resend) setup, domain verification, driver
selection, suppression list, and webhook. Mail sending sits behind a **provider-agnostic transport**; the
code lives in `src/infrastructure/mail/`.

## Mental model (brief)

```
domain code → MailProducer → send-mail queue (BullMQ) → SendMailProcessor → MailService
                                                                            │ suppression check
                                                                            ▼
                                                                            IMailTransport (driver)
                                                                            ├─ resend  → Resend HTTP API
                                                                            └─ log     → logs only (dev/test)

Resend  → bounce/complaint webhook → /webhooks/resend → suppression list (mail_suppression)
```

- **The driver is selected with `MAIL_DRIVER`.** `log` (default): mail does not go to the network, it is
  logged — for local/CI. `resend`: real sending. **`resend` is mandatory in production** (the env schema
  validates this at boot).
- **Adding a new provider** = an `IMailTransport` implementation + a branch in `MailModule`'s driver
  selection. The domain/`MailService` does not change (`src/shared/interfaces/mail-transport.interface.ts`).
- **Suppression check before sending:** a bounced/complained address is not sent to again (reputation +
  Gmail/Yahoo bulk-sender compliance).

## Env variables

| Key                     | Requirement                      | Note                                                                                      |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `MAIL_DRIVER`           | Optional, default `log`          | Enum: `resend` \| `log`. Must be `resend` in production.                                  |
| `MAIL_FROM`             | Required                         | Sender address; must be **on a verified Resend domain** (e.g. `no-reply@yourdomain.com`). |
| `MAIL_FROM_NAME`        | Required                         | Sender display name (e.g. `App`).                                                         |
| `RESEND_API_KEY`        | Required if `MAIL_DRIVER=resend` | Resend API key (`re_...`).                                                                |
| `RESEND_WEBHOOK_SECRET` | Required if `MAIL_DRIVER=resend` | Resend webhook signing secret (`whsec_...`).                                              |

> Kept in sync with `.env.sample`. Do **not** put empty `RESEND_*` lines in the local `.env` — dotenv loads
> an empty string, and `.min(1)` rejects it (optional keys are not set; the line should not exist at all).

## Initial setup (production, one-time)

1. **Add the domain:** Resend dashboard → Domains → add the sending domain.
2. **DNS verification:** enter the records Resend provides into DNS:
   - **SPF** (TXT), **DKIM** (CNAME/TXT), **DMARC** (TXT — under `_dmarc`, at least `p=none`, and once
     mature `p=quarantine`/`p=reject`). Gmail/Yahoo make DMARC **mandatory** for bulk senders.
   - (Recommended) a separate **sending subdomain** (`mail.` / `notifications.`) → isolates the main
     domain's reputation.
3. **Set `MAIL_FROM` to the verified domain.** Sending from an unverified domain is rejected.
4. **API key:** Resend → API Keys → create → `RESEND_API_KEY`.
5. **Webhook:** Resend → Webhooks → add an endpoint: `https://<host>/webhooks/resend`
   (note: **no** `/api/v<n>` — the endpoint is version-neutral). Select at least the `email.bounced` and
   `email.complained` events. The signing secret provided → `RESEND_WEBHOOK_SECRET`.
6. **Add the env to the deploy:** `MAIL_DRIVER=resend`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `MAIL_FROM`,
   `MAIL_FROM_NAME`.

## Driver behavior

- **Dev/CI (`log`):** `MailService` hands the mail to `LogMailTransport` → a single log line, no network. The
  webhook controller is **not registered** (the Resend verifier needs an API-key client; there is no key in
  log mode). `/webhooks/resend` returns 404 in this mode.
- **Production (`resend`):** `ResendMailTransport` sends via the HTTP API; permanent errors (4xx, invalid
  address) do not needlessly retry the queue (`UnrecoverableError`), while transient errors (429/5xx/network)
  are retried with BullMQ backoff. The webhook controller is registered.
- To test real sending in dev: run with `MAIL_DRIVER=resend` + `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET`.

## Suppression list

- Table: **`mail_suppression`** (`email` unique, `reason` = `bounce`|`complaint`, `metadata` jsonb raw event).
- **Written by:** the webhook (`ResendWebhookService`). **Read by:** `MailService` on every send
  (`isSuppressed` → skip if true, `mail.suppressed=true` on the span).
- **Idempotent:** if the same address bounces/complains again, `ON CONFLICT (email) DO NOTHING` — a single row.
- **Inspection:**
  ```sql
  SELECT email, reason, created_at, metadata FROM mail_suppression ORDER BY created_at DESC LIMIT 50;
  ```
- **Manual removal** (when you are sure the address has recovered, e.g. a wrong transient bounce):
  ```sql
  DELETE FROM mail_suppression WHERE email = 'user@example.com';
  ```

## Webhook

- **Endpoint:** `POST /webhooks/resend` (public, version-neutral; the Svix signature is verified over the raw
  body).
- **Signature:** Resend SDK `webhooks.verify` (`svix-id`/`svix-timestamp`/`svix-signature` +
  `RESEND_WEBHOOK_SECRET`). Invalid signature → **401**, no suppression is written.
- **Handled events:**
  - `email.bounced` → suppress **only if `bounce.type` is NOT `Transient`** (transient bounces — full
    mailbox, greylisting — are not blocked).
  - `email.complained` → always suppress.
  - Others (`delivered`, `opened`, …) → no-op.
- **204** on successful processing.

## Verification

- **Env/boot:** if `MAIL_DRIVER=resend` but the key is missing, boot fails with a clear error; in `log` mode
  boot succeeds and there is no webhook route.
- **Sending:** when a domain flow enqueues mail, in `resend` mode it appears under "Emails" in the Resend
  dashboard; in `log` mode there is a `Mail (not sent — log driver) …` line in the application log.
- **Webhook:** send a test event from the Resend dashboard or POST a signed request → a row in
  `mail_suppression`; unsigned/corrupt signature → 401.
- **Deliverability:** send a test mail to a tool such as `mail-tester.com` and check SPF/DKIM/DMARC PASS +
  the spam score.

## Troubleshooting

- **`Missing API key` (boot crash):** `MAIL_DRIVER=resend` but `RESEND_API_KEY` is missing. Provide the key or
  use `MAIL_DRIVER=log` locally.
- **Webhook 404:** `/api/v1/webhooks/resend` is being called — the endpoint is version-neutral, the correct
  URL is `/webhooks/resend`. Also, in `log` mode the endpoint does not exist at all.
- **Webhook 401:** wrong `RESEND_WEBHOOK_SECRET`, or a proxy is altering the raw body (the signature is
  computed over the raw bytes — there must be no layer that re-serializes the body).
- **Mail lands in spam:** missing DMARC/`p=none`, IP/domain reputation, or `MAIL_FROM` on an unverified
  domain. Check the DNS records and the Resend domain status.
- **Not sending to a valid address:** the address may be in `mail_suppression` (an old bounce/complaint).
  Remove it with the DELETE above.
