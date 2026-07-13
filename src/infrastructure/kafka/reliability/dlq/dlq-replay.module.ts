import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { appDataSourceOptions } from '@database/typeorm.data-source';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { DlqReplayService } from '@infrastructure/kafka/reliability/dlq/dlq-replay.service';

@Module({
  imports: [TypeOrmModule.forRoot(appDataSourceOptions)],
  providers: [KafkaConsumerService, KafkaProducerService, DlqReplayService],
})
export class DlqReplayModule {}
