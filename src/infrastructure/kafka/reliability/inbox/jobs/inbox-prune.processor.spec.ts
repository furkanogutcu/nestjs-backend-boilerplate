import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { InboxPruneProcessor } from '@infrastructure/kafka/reliability/inbox/jobs/inbox-prune.processor';

describe('InboxPruneProcessor', () => {
  let dataSource: DeepMocked<DataSource>;
  let processor: InboxPruneProcessor;

  beforeEach(() => {
    dataSource = createMock<DataSource>();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    processor = new InboxPruneProcessor(createMock<Queue>(), dataSource);
  });

  it('deletes processed rows past the configured retention window and logs the deleted count', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    // * DELETE ... RETURNING yields TypeORM's [rows, affectedCount] tuple, not a flat row array.
    dataSource.query.mockResolvedValue([[{ dedup_id: '1' }, { dedup_id: '2' }], 2]);

    await processor.process();

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM inbox_messages[\s\S]*processed_at < now\(\) - \(\$1 \* interval '1 millisecond'\)/,
      ),
      [expect.any(Number)],
    );
    expect(log).toHaveBeenCalledWith('Pruned 2 processed inbox row(s)');
  });
});
