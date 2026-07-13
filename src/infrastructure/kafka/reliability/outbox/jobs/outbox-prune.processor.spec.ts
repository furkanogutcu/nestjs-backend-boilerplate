import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { OutboxPruneProcessor } from '@infrastructure/kafka/reliability/outbox/jobs/outbox-prune.processor';

describe('OutboxPruneProcessor', () => {
  let dataSource: DeepMocked<DataSource>;
  let processor: OutboxPruneProcessor;

  beforeEach(() => {
    dataSource = createMock<DataSource>();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    processor = new OutboxPruneProcessor(createMock<Queue>(), dataSource);
  });

  it('deletes published rows past the configured retention window and logs the deleted count', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    // * DELETE ... RETURNING yields TypeORM's [rows, affectedCount] tuple, not a flat row array.
    dataSource.query.mockResolvedValue([[{ id: '1' }, { id: '2' }], 2]);

    await processor.process();

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM outbox_messages[\s\S]*status = \$1 AND published_at < now\(\) - \(\$2 \* interval '1 millisecond'\)/,
      ),
      [OutboxStatus.Published, expect.any(Number)],
    );
    expect(log).toHaveBeenCalledWith('Pruned 2 published outbox row(s)');
  });
});
