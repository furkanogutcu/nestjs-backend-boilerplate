import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Redis } from 'ioredis';
import { Resend } from 'resend';
import type { Mock } from 'vitest';

import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { MailSuppressionReason } from '../enums/mail-suppression-reason.enum';
import type { MailSuppressionRepository } from '../repositories/mail-suppression.repository';
import { ResendWebhookService } from './resend-webhook.service';

vi.mock('resend');
vi.mock('@config/env.config', () => ({
  env: { RESEND_API_KEY: 're_test_key', RESEND_WEBHOOK_SECRET: 'whsec_test' },
}));

const headers = { id: 'msg_1', timestamp: '1700000000', signature: 'v1,sig' };
const payload = '{"type":"email.bounced"}';

describe('ResendWebhookService', () => {
  let verifyMock: Mock;
  let suppressionRepository: DeepMocked<MailSuppressionRepository>;
  let redisClient: DeepMocked<Redis>;
  let service: ResendWebhookService;

  beforeEach(() => {
    verifyMock = vi.fn();
    (Resend as unknown as Mock).mockImplementation(function () {
      return { webhooks: { verify: verifyMock } };
    });
    suppressionRepository = createMock<MailSuppressionRepository>();
    redisClient = createMock<Redis>();
    redisClient.set.mockResolvedValue('OK');
    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redisClient);
    const clock = createMock<ClockService>();
    clock.epochMillis.mockReturnValue(1_700_000_000_000);
    service = new ResendWebhookService(suppressionRepository, redisService, clock);
  });

  it('throws AppUnauthorizedException when the signature does not verify', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('No matching signature found');
    });

    await expect(service.handle({ payload, headers })).rejects.toBeInstanceOf(AppUnauthorizedException);
    expect(suppressionRepository.suppress).not.toHaveBeenCalled();
  });

  it('suppresses the recipient on a permanent bounce', async () => {
    verifyMock.mockReturnValue({
      type: 'email.bounced',
      data: {
        email_id: 'e1',
        to: ['a@app.test'],
        bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
      },
    });

    await service.handle({ payload, headers });

    expect(suppressionRepository.suppress).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@app.test', reason: MailSuppressionReason.Bounce }),
    );
  });

  it('does not suppress on a transient bounce', async () => {
    verifyMock.mockReturnValue({
      type: 'email.bounced',
      data: {
        email_id: 'e1',
        to: ['a@app.test'],
        bounce: { type: 'Transient', subType: 'MailboxFull', message: 'try later' },
      },
    });

    await service.handle({ payload, headers });

    expect(suppressionRepository.suppress).not.toHaveBeenCalled();
  });

  it('suppresses every recipient on a complaint', async () => {
    verifyMock.mockReturnValue({
      type: 'email.complained',
      data: { email_id: 'e1', to: ['a@app.test', 'b@app.test'] },
    });

    await service.handle({ payload, headers });

    expect(suppressionRepository.suppress).toHaveBeenCalledTimes(2);
    expect(suppressionRepository.suppress).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'b@app.test', reason: MailSuppressionReason.Complaint }),
    );
  });

  it('ignores non-suppression events such as delivered', async () => {
    verifyMock.mockReturnValue({ type: 'email.delivered', data: { email_id: 'e1', to: ['a@app.test'] } });

    await service.handle({ payload, headers });

    expect(suppressionRepository.suppress).not.toHaveBeenCalled();
  });

  it('drops a replayed delivery (Svix id already claimed) without suppressing again', async () => {
    redisClient.set.mockResolvedValue(null as unknown as 'OK');
    verifyMock.mockReturnValue({
      type: 'email.bounced',
      data: { email_id: 'e1', to: ['a@app.test'], bounce: { type: 'Permanent', subType: 'General', message: 'x' } },
    });

    await service.handle({ payload, headers });

    expect(suppressionRepository.suppress).not.toHaveBeenCalled();
  });

  it('rejects an event carrying an empty Svix message id', async () => {
    verifyMock.mockReturnValue({
      type: 'email.bounced',
      data: { email_id: 'e1', to: ['a@app.test'], bounce: { type: 'Permanent', subType: 'General', message: 'x' } },
    });

    await expect(service.handle({ payload, headers: { ...headers, id: '' } })).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    expect(suppressionRepository.suppress).not.toHaveBeenCalled();
  });
});
