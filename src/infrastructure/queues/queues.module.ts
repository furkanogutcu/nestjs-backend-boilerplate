import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { appConfig } from '@config/app.config';
import { defaultJobOptions } from '@config/queue.config';

import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redisService: RedisService) => ({
        connection: redisService.getBullConnection(),
        prefix: appConfig.redis.keyPrefixes.bull,
        defaultJobOptions,
      }),
    }),
  ],
})
export class QueuesModule {}
