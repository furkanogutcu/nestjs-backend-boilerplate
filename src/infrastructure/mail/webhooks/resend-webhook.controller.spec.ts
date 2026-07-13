import { createMock, DeepMocked } from '@golevelup/ts-jest';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { ResendWebhookController } from './resend-webhook.controller';
import { ResendWebhookService } from './resend-webhook.service';

describe('ResendWebhookController', () => {
  let service: DeepMocked<ResendWebhookService>;
  let controller: ResendWebhookController;

  beforeEach(() => {
    service = createMock<ResendWebhookService>();
    controller = new ResendWebhookController(service);
  });

  it('forwards the raw body and svix headers to the verification service', async () => {
    const request = { rawBody: Buffer.from('{"type":"email.sent"}') } as RawBodyRequest<Request>;

    await controller.handle(request, {
      'svix-id': 'msg-1',
      'svix-timestamp': '1750000000',
      'svix-signature': 'v1,abc',
    });

    expect(service.handle).toHaveBeenCalledWith({
      payload: '{"type":"email.sent"}',
      headers: { id: 'msg-1', timestamp: '1750000000', signature: 'v1,abc' },
    });
  });

  it('falls back to empty strings when the raw body and svix headers are missing', async () => {
    const request = {} as RawBodyRequest<Request>;

    await controller.handle(request, {});

    expect(service.handle).toHaveBeenCalledWith({
      payload: '',
      headers: { id: '', timestamp: '', signature: '' },
    });
  });
});
