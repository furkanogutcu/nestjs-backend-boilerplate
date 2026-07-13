import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { KafkaAdminService } from '@infrastructure/kafka/client/kafka-admin.service';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { kafkaMetricProviders } from '@infrastructure/kafka/observability/kafka-metrics.providers';
import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import { DlqReplayService } from '@infrastructure/kafka/reliability/dlq/dlq-replay.service';
import { InboxService } from '@infrastructure/kafka/reliability/inbox/inbox.service';
import { InboxPruneProcessor } from '@infrastructure/kafka/reliability/inbox/jobs/inbox-prune.processor';
import { OutboxPruneProcessor } from '@infrastructure/kafka/reliability/outbox/jobs/outbox-prune.processor';
import { OutboxRelayProcessor } from '@infrastructure/kafka/reliability/outbox/jobs/outbox-relay.processor';
import { OutboxService } from '@infrastructure/kafka/reliability/outbox/outbox.service';
import { RetryDlqProducer } from '@infrastructure/kafka/reliability/retry/retry-dlq.producer';
import { AppQueue } from '@shared/enums/queue.enum';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: AppQueue.OutboxRelay },
      { name: AppQueue.OutboxPrune },
      { name: AppQueue.InboxPrune },
    ),
  ],
  providers: [
    ...kafkaMetricProviders,
    KafkaMetricsService,
    KafkaAdminService,
    KafkaProducerService,
    KafkaConsumerService,
    OutboxService,
    OutboxRelayProcessor,
    OutboxPruneProcessor,
    InboxService,
    InboxPruneProcessor,
    RetryDlqProducer,
    DlqReplayService,
  ],
  exports: [
    KafkaMetricsService,
    KafkaAdminService,
    KafkaProducerService,
    KafkaConsumerService,
    OutboxService,
    InboxService,
    RetryDlqProducer,
  ],
})
export class KafkaModule {}
