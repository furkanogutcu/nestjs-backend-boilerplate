import { Queue } from 'bullmq';

import { withJobTrace } from '@infrastructure/queues/queue-trace.util';

export interface IEnqueueOptions {
  idempotencyKey?: string;
  delay?: number;
}

export abstract class BaseQueueProducer<TData extends object> {
  protected abstract readonly jobName: string;

  constructor(protected readonly queue: Queue) {}

  protected async enqueue(params: { data: TData; options?: IEnqueueOptions }): Promise<void> {
    const { data, options } = params;

    await this.queue.add(this.jobName, withJobTrace(data), {
      jobId: options?.idempotencyKey,
      delay: options?.delay,
    });
  }
}
