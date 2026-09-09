import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AccountDeletionService } from '../services/account-deletion.service';
import { AccountErasureProcessor } from './account-erasure.processor';

describe('AccountErasureProcessor', () => {
  let queue: DeepMocked<Queue>;
  let accountDeletionService: DeepMocked<AccountDeletionService>;
  let processor: AccountErasureProcessor;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    queue = createMock<Queue>();
    accountDeletionService = createMock<AccountDeletionService>();
    processor = new AccountErasureProcessor(queue, accountDeletionService);
  });

  it('registers a cron scheduler on bootstrap', async () => {
    await processor.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith('account-erasure', expect.objectContaining({ tz: 'UTC' }));
  });

  it('sweeps matured deletion requests', async () => {
    accountDeletionService.eraseExpired.mockResolvedValue(2);

    await processor.process();

    expect(accountDeletionService.eraseExpired).toHaveBeenCalled();
  });

  it('stays quiet when nothing was due', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    accountDeletionService.eraseExpired.mockResolvedValue(0);

    await processor.process();

    expect(log).not.toHaveBeenCalled();
  });
});
