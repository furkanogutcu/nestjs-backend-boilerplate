import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Queue } from 'bullmq';

import { BaseQueueProducer, IEnqueueOptions } from './base-queue.producer';

type Payload = { id: number };

class TestProducer extends BaseQueueProducer<Payload> {
  protected readonly jobName = 'test-job';

  async run(params: { data: Payload; options?: IEnqueueOptions }): Promise<void> {
    await this.enqueue({ data: params.data, options: params.options });
  }
}

describe('BaseQueueProducer', () => {
  let queue: DeepMocked<Queue>;
  let producer: TestProducer;

  beforeEach(() => {
    queue = createMock<Queue>();
    producer = new TestProducer(queue);
  });

  it('adds a job with its name and data', async () => {
    await producer.run({ data: { id: 1 } });

    expect(queue.add).toHaveBeenCalledWith('test-job', expect.objectContaining({ id: 1 }), {
      jobId: undefined,
      delay: undefined,
    });
  });

  it('forwards the idempotency key as jobId and the delay', async () => {
    await producer.run({ data: { id: 1 }, options: { idempotencyKey: 'unique-1', delay: 5000 } });

    expect(queue.add).toHaveBeenCalledWith('test-job', expect.objectContaining({ id: 1 }), {
      jobId: 'unique-1',
      delay: 5000,
    });
  });

  it('embeds an OpenTelemetry trace carrier in the job data', async () => {
    await producer.run({ data: { id: 1 } });

    expect(queue.add).toHaveBeenCalledWith(
      'test-job',
      expect.objectContaining({ _otel: expect.any(Object) }),
      expect.anything(),
    );
  });
});
