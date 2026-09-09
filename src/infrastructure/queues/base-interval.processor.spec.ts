import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { BaseIntervalProcessor } from './base-interval.processor';

class TestProcessor extends BaseIntervalProcessor {
  protected readonly schedulerId = 'poller';
  protected readonly intervalMs = 2000;

  async process(): Promise<void> {}
}

describe('BaseIntervalProcessor', () => {
  let queue: DeepMocked<Queue>;
  let processor: TestProcessor;

  beforeEach(() => {
    queue = createMock<Queue>();
    processor = new TestProcessor(queue);
  });

  it('registers an interval scheduler and logs on bootstrap', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await processor.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith('poller', { every: 2000 });
    expect(log).toHaveBeenCalled();
  });
});
