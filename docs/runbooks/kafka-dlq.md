# Runbook: Kafka DLQ and outbox operations

Operational procedures for the Kafka messaging backbone. For the architecture, see `ARCHITECTURE.md` →
the "Kafka messaging" section.

## Quick status check

Metrics (`/api/v1/metrics`, behind basic-auth in prod):

- `kafka_dlq_total{topic}` — number of messages sent to the DLQ. **An increase = an unprocessable event.**
- `kafka_outbox_pending` — pending outbox rows. **Persistently high = relay falling behind.**
- `kafka_outbox_failed_total` — outbox rows that exceeded the cap and became `failed` (cumulative counter).
- `kafka_outbox_failed` — number of rows **currently** stuck in `failed` (retries exhausted, awaiting requeue).
- `kafka_retry_total{tier}` — escalation volume into the retry tiers.
- `kafka_inbox_duplicates_total` — duplicates skipped by the inbox (high = excessive redelivery).

Topics and messages can be inspected with kafka-ui (dev `:8090`, behind VPN in prod).

## Suggested alert thresholds

| Alert         | Condition                               | Action                                              |
| ------------- | --------------------------------------- | --------------------------------------------------- |
| DLQ buildup   | `increase(kafka_dlq_total[15m]) > 0`    | Inspect the DLQ message, fix the root cause, replay |
| Outbox lag    | `kafka_outbox_pending > 1000` for 5 min | Check relay/Kafka health                            |
| Poison outbox | `kafka_outbox_failed > 0`               | Inspect the `failed` row + requeue (see below)      |

## Inspecting and replaying a DLQ

1. **Inspect (dry-run):** see what would be replayed without changing anything.

   ```
   pnpm kafka:dlq:replay --topic resource_invalidated.dlq --dry-run
   ```

   The message headers `x-original-topic`, `x-retry-attempt`, `x-last-error`, `x-first-failed-at`
   give clues to the root cause.

2. **Fix the root cause** (consumer code/dependent service). Replaying before the reason for the DLQ
   drop is resolved causes the message to land in the DLQ again.

3. **Replay:**

   ```
   pnpm kafka:dlq:replay --topic resource_invalidated.dlq                 # all to the original topic
   pnpm kafka:dlq:replay --topic resource_invalidated.dlq --filter <eventId>   # single message
   ```

   The message is re-produced to the original topic; the consumer processes it again in the normal
   flow. It is safe thanks to the idempotent producer + inbox dedup.

4. **When to use `--force`:** when a message has already been **processed successfully** (an inbox row
   exists) but a replay is still wanted. `--force` **requires `--consumer <groupId>`** and deletes only
   that consumer's `(consumer, dedup_id)` inbox row:

   ```
   pnpm kafka:dlq:replay --topic resource_invalidated.dlq --filter <eventId> --force --consumer orders-consumer
   ```

   Without `--consumer`, `--force` is rejected; otherwise the dedup would be deleted from ALL consumer
   groups and unrelated consumers would reprocess as well (double-processing risk).

5. **Poison (unparseable) messages:** they land in the DLQ raw with an `x-last-error` header and are
   **not processed automatically** by replay (schema validation fails → skipped). Inspect them with
   kafka-ui; the fix is usually on the producer side.

6. **Retention interaction:** if `KAFKA_INBOX_RETENTION_MS` (7d) < `KAFKA_DLQ_RETENTION_MS` (14d), then
   after the inbox row is pruned a replay without `--force` may silently reprocess. Set
   `KAFKA_INBOX_RETENTION_MS >= KAFKA_DLQ_RETENTION_MS` so that replay is always explicit.

## `failed` outbox row (poison)

A row with `attempts >= KAFKA_OUTBOX_MAX_ATTEMPTS` becomes `status='failed'` and is skipped by the
relay (it does not block the queue). Inspect it:

```sql
SELECT id, topic, attempts, last_error, created_at FROM outbox_message WHERE status = 'failed';
```

- **If it is a transient problem** (broker/schema): first **fix the root cause** — requeue resets
  attempts, and without resolving the reason the retries simply exhaust again. Then requeue it with
  `kafka:outbox:requeue`:

  ```
  pnpm kafka:outbox:requeue --all --dry-run     # how many rows would be affected (no write)
  pnpm kafka:outbox:requeue --id <id>           # single row
  pnpm kafka:outbox:requeue --topic resource_invalidated     # all failed rows of a topic
  pnpm kafka:outbox:requeue --all --limit 100   # all, batch by batch
  ```

  It moves the row back to `pending` (`attempts=0`, `last_error=NULL`, `available_at=now()`); it is
  republished on the next relay tick. It is safe thanks to the idempotent producer + inbox dedup.
  `--id`, `--topic`, and `--all` are mutually exclusive; one is required.

- **If it is permanent/corrupt:** archive/delete the record (a business decision). Inspect it with
  `last_error` and `payload`.

## Retry tiers and delays

`5s → 1m → 10m → DLQ` (`constants/retry.constant.ts`). A total retry window of ~11 min.
An order-sensitive topic should not use retry (`kafka-topic.registry.ts` → `retryEnabled:false`); it
goes to the DLQ on the first error.

## Production hardening notes (out of scope, for follow-up)

- **RF=1:** The current broker is a single node, replication factor 1. `acks=all` equals `acks=1` in
  this topology; on broker loss a message may be lost after publish. Before critical/at-least-once
  traffic, use `KAFKA_TOPIC_REPLICATION_FACTOR=3` + a multi-node cluster.
- **ACL / mTLS:** SASL is active in prod; per-topic ACLs and mTLS should be added against rogue
  producers/consumers that bypass the outbox/inbox pattern.
