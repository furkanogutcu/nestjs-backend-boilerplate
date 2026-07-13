# Kafka event recipe (copy-paste)

Example: the `article.created` event — the `articles` domain produces it, and another place consumes it idempotently.
Follow `ARCHITECTURE.md` "Kafka messaging" for naming/partition decisions.

## 1. Topic — `infrastructure/kafka/enums/kafka-topic.enum.ts`

```ts
export enum KafkaTopic {
  ArticleCreated = 'article.created',
}
```

## 2. Schema variant — `infrastructure/kafka/schemas/kafka-event.schema.ts`

```ts
const articleCreatedEvent = baseSchema.extend({
  topic: z.literal(KafkaTopic.ArticleCreated),
  data: z.object({
    articleId: z.uuid(),
  }),
});

// When there is more than one event, add them all to the discriminated union:
export const kafkaEventSchema = z.discriminatedUnion('topic', [articleCreatedEvent]);
```

## 3. Registry — `infrastructure/kafka/topics/kafka-topic.registry.ts`

```ts
export const kafkaTopicRegistry: Record<KafkaTopic, IKafkaTopicConfig> = {
  [KafkaTopic.ArticleCreated]: {
    partitions: env.KAFKA_TOPIC_PARTITIONS,
    replicationFactor: env.KAFKA_TOPIC_REPLICATION_FACTOR,
    retryEnabled: true,
  },
};
```

## 4. Production — `modules/articles/articles.service.ts`

```ts
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@infrastructure/database/database.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { OutboxService } from '@infrastructure/kafka/reliability/outbox/outbox.service';

import { Article } from './entities/article.entity';

@Injectable()
export class ArticlesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxService: OutboxService,
  ) {}

  async create(params: { title: string }): Promise<Article> {
    return await this.databaseService.runInTransaction(async (manager) => {
      const article = await manager.getRepository(Article).save(manager.getRepository(Article).create(params));

      await this.outboxService.enqueue({
        manager, // same transaction — atomic with the business write
        params: {
          topic: KafkaTopic.ArticleCreated,
          data: { articleId: article.id },
          key: article.id, // partition key (ordering/locality)
          dedupKey: article.id, // business-level idempotency; must stay the same across retries
        },
      });

      return article;
    });
  }
}
```

> `OutboxService` fills in `meta` (eventId, timestamp, traceId, producer…) itself; you provide `topic` + `data`
> (+ `key`, `dedupKey`). The `relay` processor publishes from the outbox to Kafka.

## 5. Consumption — `modules/<consumer-domain>/events/on-article-created.consumer.ts`

```ts
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { DatabaseService } from '@infrastructure/database/database.service';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { BaseIdempotentConsumer } from '@infrastructure/kafka/consumers/base-idempotent-consumer.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerConfig } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { InboxService } from '@infrastructure/kafka/reliability/inbox/inbox.service';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

@Injectable()
export class OnArticleCreatedConsumer extends BaseIdempotentConsumer {
  constructor(
    kafkaConsumerService: KafkaConsumerService,
    databaseService: DatabaseService,
    inboxService: InboxService,
  ) {
    super(kafkaConsumerService, databaseService, inboxService);
  }

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return { groupId: 'articles.on-article-created', topics: [KafkaTopic.ArticleCreated] };
  }

  protected async handleEvent({ event, manager }: { event: KafkaEvent; manager: EntityManager }): Promise<void> {
    if (event.topic !== KafkaTopic.ArticleCreated) {
      return; // if you subscribe to multiple topics, narrow with event.topic
    }

    const { articleId } = event.data; // discriminated union → type-safe

    // ALL writes with `manager` (atomic with the inbox dedup row). Throw → rollback + redelivery.
    await manager.getRepository(/* ... */).save(/* work with articleId */);
  }
}
```

Add the consumer to the owning module's `providers`:

```ts
@Module({
  imports: [/* KafkaModule access: InboxService, KafkaConsumerService, DatabaseService */],
  providers: [OnArticleCreatedConsumer],
})
export class SomeConsumerModule {}
```

> **If you want Retry + DLQ**, extend `BaseRetryableConsumer` instead of `BaseIdempotentConsumer`
> (with `RetryDlqProducer` added to the constructor). An error thrown in `handleEvent` falls to the staged retry
> tiers (5s → 1m → 10m), and to the DLQ once exhausted. For DLQ replay see the `kafka-dlq` runbook.
