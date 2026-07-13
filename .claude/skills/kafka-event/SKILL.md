---
name: kafka-event
description: >-
  Use when adding a new Kafka domain event in this repo (produce or consume). Implements production via
  transactional outbox (atomic with the business write), a discriminated-union event schema, idempotent
  inbox consumption, and the staged retry + DLQ pattern with the real primitives (OutboxService,
  BaseIdempotentConsumer/BaseRetryableConsumer, KafkaTopic enum + registry). NEVER publish to Kafka
  directly from domain code — always through the outbox.
---

# Kafka events

Flow: **HTTP/business → outbox (DB, atomic) → relay → Kafka → consumer (inbox dedup) → [retry tiers → DLQ]**.
Domain code does **not publish to Kafka directly**; it writes the event to the outbox within the caller's
transaction, and `outbox-relay.processor` publishes it. This makes the business write and the event atomic.

> Context: `ARCHITECTURE.md` "Kafka messaging" (event envelope, topic provisioning, outbox/inbox, retry+DLQ,
> schema evolution). Infrastructure: `src/infrastructure/kafka/`. Full code example: `references/event-recipe.md`.

## Event envelope

Every event conforms to a single shape (`schemas/kafka-event.schema.ts`):

```
{ meta: { eventId, eventVersion, timestamp, dedupKey?, traceId?, correlationId?, producer? },
  topic, data }
```

- `meta` is **populated by OutboxService** — you only provide `topic` + `data` (+ optional `key`, `dedupKey`).
- **`dedupKey`** is business-level idempotency: it must be **exactly the same** across retries of the same
  logical operation, otherwise the consumer's inbox dedup is bypassed. If you omit it, only transport-level
  dedup (`eventId`) applies.

## Adding a new event (3 central touchpoints + produce/consume)

1. **Topic** → `infrastructure/kafka/enums/kafka-topic.enum.ts` (add it to the `KafkaTopic` enum).
   Follow the convention in `ARCHITECTURE.md` "Kafka messaging" for naming.
2. **Schema** → `infrastructure/kafka/schemas/kafka-event.schema.ts`: define a variant with
   `baseSchema.extend({ topic: z.literal(...), data: z.object({...}) })` and add it to the `kafkaEventSchema`
   **discriminated union** (discriminator: `topic`).
3. **Registry** → `infrastructure/kafka/topics/kafka-topic.registry.ts`: add
   `{ partitions, replicationFactor, retryEnabled }` to `kafkaTopicRegistry` (topic provisioning uses this).
4. **Produce** (in the domain service): `OutboxService.enqueue` in the same transaction as the business write.
5. **Consume** (in the owning domain's `modules/<x>/events/` folder): extend a base consumer.

## Production — transactional outbox

Run the business logic and `enqueue` within **a single transaction** (`DatabaseService.runInTransaction`):

```ts
await this.databaseService.runInTransaction(async (manager) => {
  const article = await manager.getRepository(Article).save(/* ... */);

  await this.outboxService.enqueue({
    manager, // REQUIRED: same manager — otherwise atomicity is lost
    params: {
      topic: KafkaTopic.ArticleCreated,
      data: { articleId: article.id },
      key: article.id,
      dedupKey: article.id,
    },
  });
});
```

## Consumption — which base consumer?

| Base                     | What it provides                                 | When                                                        |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------- |
| `BaseEventConsumer`      | At-least-once, no dedup (skip/halt error policy) | Rare cases with no side effect / no idempotency requirement |
| `BaseIdempotentConsumer` | Exactly-once-**effect** via inbox                | **Default** — every consumer that writes to the DB          |
| `BaseRetryableConsumer`  | Idempotent + staged retry (5s/1m/10m) + DLQ      | Consumers that expect transient errors and want retry/DLQ   |

- Implement `getKafkaConsumerConfig(): IKafkaConsumerConfig` → `{ groupId, topics }`.
- In idempotent/retryable, implement `handleEvent({ event, manager })`. **All DB writes must use the provided
  `manager`** (atomic with the inbox dedup row). Do not open a separate transaction. **Throwing** rolls back
  both the inbox row and the work → the message is redelivered (in retryable it falls to the retry tiers).
- **The exactly-once guarantee covers only DB writes made with the `manager`.** External side effects (mail, HTTP,
  publishing another event) are not transactional and remain **at-least-once**: if the effect happens and the tx
  later rolls back, it repeats on redelivery. To make such an effect exactly-once, do not **call it directly** in
  the handler — write a follow-up event with `outboxService.enqueue({ manager, ... })` in the same tx and let a
  separate consumer perform the effect (still at-least-once on the wire, but deduped by its own inbox row).
- Access type-safe `event.data` by narrowing on `event.topic` (discriminated union).
- Register the consumer as a **provider** (in the owning module / the kafka module). Topic provisioning is
  executed by the registry + admin.

## Rules

- **Never** publish directly to `kafkaProducerService`/Kafka from domain code — always via the outbox.
- The event schema evolves **backward-compatibly**; a breaking change → new topic/`eventVersion`
  (`ARCHITECTURE.md` "Schema evolution").
- Pass the business write's manager to `enqueue`; do not use a separate DataSource/transaction.
- Topic enum/registry/schema live in **infrastructure** (cross-cutting); the concrete producer call and consumer
  live in the **domain module** (`modules/<x>/events/`).

## When the work is done

- [ ] Topic enum + schema variant + registry entry added; `pnpm typecheck` validates the discriminated union.
- [ ] Production is in the same transaction as the business write (`runInTransaction` + `enqueue({ manager })`).
- [ ] The consumer extends the correct base; all writes use `handleEvent`'s `manager`.
- [ ] Tests: `nestjs-testing` (+ `*.integration-spec.ts` for the pipeline, see the existing outbox/inbox examples).
- [ ] `pnpm lint && pnpm typecheck` pass.
