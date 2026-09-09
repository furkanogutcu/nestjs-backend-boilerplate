import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { env } from '@config/env.config';
import { BaseScheduledProcessor } from '@infrastructure/queues/base-scheduled.processor';
import { AppQueue } from '@shared/enums/queue.enum';

import { AccountDeletionService } from '../services/account-deletion.service';

@Processor(AppQueue.AccountErasure, { concurrency: 1 })
export class AccountErasureProcessor extends BaseScheduledProcessor {
  protected readonly schedulerId = 'account-erasure';
  protected readonly cronPattern = env.ACCOUNT_ERASURE_CRON;

  constructor(
    @InjectQueue(AppQueue.AccountErasure) queue: Queue,
    private readonly accountDeletionService: AccountDeletionService,
  ) {
    super(queue);
  }

  async process(): Promise<void> {
    const erased = await this.accountDeletionService.eraseExpired();

    if (erased > 0) {
      this.logger.log(`Erased ${erased} account(s) past the deletion grace period`);
    }
  }
}
