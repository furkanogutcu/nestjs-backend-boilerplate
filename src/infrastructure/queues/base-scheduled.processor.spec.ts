import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { BaseScheduledProcessor } from './base-scheduled.processor';

class TestProcessor extends BaseScheduledProcessor {
  protected readonly schedulerId = 'daily-report';
  protected readonly cronPattern = '0 0 * * *';

  async process(): Promise<void> {}
}

describe('BaseScheduledProcessor', () => {
  let queue: DeepMocked<Queue>;
  let processor: TestProcessor;

  beforeEach(() => {
    queue = createMock<Queue>();
    processor = new TestProcessor(queue);
  });

  it('registers the cron scheduler in UTC and logs on bootstrap', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await processor.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith('daily-report', { pattern: '0 0 * * *', tz: 'UTC' });
    expect(log).toHaveBeenCalled();
  });
});
