import { UnrecoverableError } from 'bullmq';
import { Resend } from 'resend';

import type { IMailMessage } from '@shared/interfaces/mail-transport.interface';

import { ResendMailTransport } from './resend-mail.transport';

jest.mock('resend');
jest.mock('@config/env.config', () => ({ env: { RESEND_API_KEY: 're_test_key' } }));

const message: IMailMessage = {
  from: 'App <no-reply@app.test>',
  to: 'user@app.test',
  subject: 'Welcome',
  html: '<p>Hi</p>',
};

describe('ResendMailTransport', () => {
  let sendMock: jest.Mock;
  let transport: ResendMailTransport;

  beforeEach(() => {
    sendMock = jest.fn();
    (Resend as unknown as jest.Mock).mockImplementation(() => ({ emails: { send: sendMock } }));
    transport = new ResendMailTransport();
  });

  it('returns the provider message id on success', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-123' }, error: null });

    const result = await transport.send({ message, idempotencyKey: 'job-1' });

    expect(result).toEqual({ id: 'email-123' });
  });

  it('forwards the idempotency key to Resend', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-123' }, error: null });

    await transport.send({ message, idempotencyKey: 'job-9' });

    expect(sendMock).toHaveBeenCalledWith(
      { from: message.from, to: message.to, subject: message.subject, html: message.html },
      { idempotencyKey: 'job-9' },
    );
  });

  it('omits request options when no idempotency key is given', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-123' }, error: null });

    await transport.send({ message });

    expect(sendMock).toHaveBeenCalledWith(expect.any(Object), undefined);
  });

  it('throws UnrecoverableError on a permanent 4xx error so the queue stops retrying', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 422, message: 'invalid from' },
    });

    await expect(transport.send({ message })).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it.each([
    ['rate limit (429)', 429],
    ['server error (500)', 500],
    ['unknown status (null)', null],
    // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
  ])('throws a retryable Error on %s', async (_label, statusCode) => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'rate_limit_exceeded', statusCode, message: 'try later' },
    });

    const error = await transport.send({ message }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});
