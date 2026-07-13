import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Queue } from 'bullmq';

import { ISendMailParams } from '../schemas/send-mail.schema';
import { MailProducer } from './mail.producer';

const payload: ISendMailParams = {
  to: 'user@app.test',
  subject: 'Welcome',
  template: 'welcome',
  context: { name: 'Furkan' },
};

describe('MailProducer', () => {
  let queue: DeepMocked<Queue<ISendMailParams>>;
  let producer: MailProducer;

  beforeEach(() => {
    queue = createMock<Queue<ISendMailParams>>();
    producer = new MailProducer(queue);
  });

  it('enqueues a send-mail job with the payload', async () => {
    await producer.send({ payload });

    expect(queue.add).toHaveBeenCalledWith('send-mail', expect.objectContaining(payload), {
      jobId: undefined,
      delay: undefined,
    });
  });

  it('forwards enqueue options', async () => {
    await producer.send({ payload, options: { idempotencyKey: 'welcome-42', delay: 1000 } });

    expect(queue.add).toHaveBeenCalledWith('send-mail', expect.objectContaining(payload), {
      jobId: 'welcome-42',
      delay: 1000,
    });
  });
});
