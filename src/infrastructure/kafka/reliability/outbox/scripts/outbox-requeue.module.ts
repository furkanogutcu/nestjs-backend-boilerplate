import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { appDataSourceOptions } from '@database/typeorm.data-source';
import { OutboxRequeueService } from '@infrastructure/kafka/reliability/outbox/scripts/outbox-requeue.service';

@Module({
  imports: [TypeOrmModule.forRoot(appDataSourceOptions)],
  providers: [OutboxRequeueService],
})
export class OutboxRequeueModule {}
