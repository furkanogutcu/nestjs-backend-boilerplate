import { WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

export abstract class BaseIntervalProcessor extends WorkerHost implements OnApplicationBootstrap {
  protected readonly logger = new Logger(this.constructor.name);

  protected abstract readonly schedulerId: string;
  protected abstract readonly intervalMs: number;

  constructor(protected readonly queue: Queue) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(this.schedulerId, { every: this.intervalMs });

    this.logger.log(`Scheduled "${this.schedulerId}" every ${this.intervalMs}ms`);
  }
}
