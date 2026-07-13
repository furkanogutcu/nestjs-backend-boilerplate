import { createMock } from '@golevelup/ts-jest';
import { Counter, Gauge } from 'prom-client';

import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';

describe('KafkaMetricsService', () => {
  it('records each metric through its underlying collector', () => {
    const published = createMock<Counter>();
    const outboxFailed = createMock<Counter>();
    const pending = createMock<Gauge>();
    const failedRows = createMock<Gauge>();
    const retry = createMock<Counter<'tier'>>();
    const dlq = createMock<Counter<'topic'>>();
    const duplicates = createMock<Counter>();
    const replayed = createMock<Counter<'topic'>>();

    const service = new KafkaMetricsService(
      published,
      outboxFailed,
      pending,
      failedRows,
      retry,
      dlq,
      duplicates,
      replayed,
    );

    service.recordOutboxPublished(3);
    service.recordOutboxFailed(2);
    service.setOutboxPending(5);
    service.setOutboxFailed(4);
    service.recordRetry('retry.5s');
    service.recordDlq('session_revoked.dlq');
    service.recordInboxDuplicate();
    service.recordDlqReplayed('session_revoked.dlq');

    expect(published.inc).toHaveBeenCalledWith(3);
    expect(outboxFailed.inc).toHaveBeenCalledWith(2);
    expect(pending.set).toHaveBeenCalledWith(5);
    expect(failedRows.set).toHaveBeenCalledWith(4);
    expect(retry.inc).toHaveBeenCalledWith({ tier: 'retry.5s' });
    expect(dlq.inc).toHaveBeenCalledWith({ topic: 'session_revoked.dlq' });
    expect(duplicates.inc).toHaveBeenCalledTimes(1);
    expect(replayed.inc).toHaveBeenCalledWith({ topic: 'session_revoked.dlq' });
  });
});
