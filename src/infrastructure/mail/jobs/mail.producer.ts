import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { BaseQueueProducer, IEnqueueOptions } from '@infrastructure/queues/base-queue.producer';
import { AppQueue } from '@shared/enums/queue.enum';

import { ISendMailParams } from '../schemas/send-mail.schema';

@Injectable()
export class MailProducer extends BaseQueueProducer<ISendMailParams> {
  protected readonly jobName = 'send-mail';

  constructor(@InjectQueue(AppQueue.SendMail) queue: Queue<ISendMailParams>) {
    super(queue);
  }

  async send(params: { payload: ISendMailParams; options?: IEnqueueOptions }): Promise<void> {
    await this.enqueue({ data: params.payload, options: params.options });
  }
}
