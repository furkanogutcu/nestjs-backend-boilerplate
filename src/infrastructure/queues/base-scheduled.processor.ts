import { WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

export abstract class BaseScheduledProcessor extends WorkerHost implements OnApplicationBootstrap {
  protected readonly logger = new Logger(this.constructor.name);

  protected abstract readonly schedulerId: string;
  protected abstract readonly cronPattern: string;

  constructor(protected readonly queue: Queue) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(this.schedulerId, { pattern: this.cronPattern, tz: 'UTC' });

    this.logger.log(`Scheduled "${this.schedulerId}" with cron "${this.cronPattern}" (UTC)`);
  }
}
