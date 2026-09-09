import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { MailService } from '../mail.service';
import { ISendMailParams } from '../schemas/send-mail.schema';
import { SendMailProcessor } from './send-mail.processor';

const payload: ISendMailParams = {
  to: 'user@app.test',
  subject: 'Welcome',
  template: 'welcome',
  context: { name: 'Furkan' },
};

describe('SendMailProcessor', () => {
  let mailService: DeepMocked<MailService>;
  let processor: SendMailProcessor;

  beforeEach(() => {
    mailService = createMock<MailService>();
    processor = new SendMailProcessor(mailService);
  });

  it('validates the job data and delegates to the mail service with the job id as idempotency key', async () => {
    await processor.process({ id: 'job-42', data: payload } as Job<ISendMailParams>);

    expect(mailService.send).toHaveBeenCalledWith({ payload, idempotencyKey: 'job-42' });
  });

  it('throws and does not send when the job data is invalid', async () => {
    const job = { data: { ...payload, to: 'not-an-email' } } as Job<ISendMailParams>;

    await expect(processor.process(job)).rejects.toThrow();
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('rethrows when the mail service fails to send', async () => {
    mailService.send.mockRejectedValue(new Error('smtp down'));

    await expect(processor.process({ data: payload } as Job<ISendMailParams>)).rejects.toThrow('smtp down');
  });

  it('logs when a job fails', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = { id: '1', attemptsMade: 2, opts: { attempts: 3 } } as Job<ISendMailParams>;

    processor.onFailed(job, new Error('smtp timeout'));

    expect(error).toHaveBeenCalled();
  });

  it('defaults the attempt count when opts.attempts is absent', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = { id: '1', attemptsMade: 1, opts: {} } as Job<ISendMailParams>;

    processor.onFailed(job, new Error('smtp timeout'));

    expect(error).toHaveBeenCalledWith(expect.stringContaining('1/1'));
  });

  it('logs on a worker error', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    processor.onError(new Error('worker crashed'));

    expect(error).toHaveBeenCalled();
  });
});
