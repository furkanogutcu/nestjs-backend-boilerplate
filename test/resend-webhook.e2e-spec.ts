import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { versioningConfig } from '@config/app.config';
import { ResendWebhookController } from '@infrastructure/mail/webhooks/resend-webhook.controller';
import { ResendWebhookService } from '@infrastructure/mail/webhooks/resend-webhook.service';

describe('ResendWebhookController (e2e)', () => {
  let app: NestExpressApplication;
  const handle = vi.fn<(a0: unknown) => Promise<void>>().mockResolvedValue(undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ResendWebhookController],
      providers: [{ provide: ResendWebhookService, useValue: { handle } }],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
    app.useBodyParser('json');
    // * Enable the same URI versioning as the real app so this locks in that the webhook stays VERSION_NEUTRAL
    // * (reachable at /webhooks/resend, off the /api/v<n> prefix Resend must not have to track).
    app.enableVersioning(versioningConfig);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handle.mockClear();
  });

  it('forwards the raw body and Svix headers to the service and answers 204', async () => {
    const body = { type: 'email.bounced', data: { email_id: 'e1' } };

    await request(app.getHttpServer())
      .post('/webhooks/resend')
      .set('svix-id', 'msg_1')
      .set('svix-timestamp', '1700000000')
      .set('svix-signature', 'v1,abc')
      .send(body)
      .expect(204);

    expect(handle).toHaveBeenCalledWith({
      payload: JSON.stringify(body),
      headers: { id: 'msg_1', timestamp: '1700000000', signature: 'v1,abc' },
    });
  });

  it('defaults missing Svix headers to empty strings', async () => {
    await request(app.getHttpServer()).post('/webhooks/resend').send({ type: 'email.opened' }).expect(204);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ headers: { id: '', timestamp: '', signature: '' } }));
  });

  it('is not served under the versioned /api/v1 prefix', async () => {
    await request(app.getHttpServer()).post('/api/v1/webhooks/resend').send({ type: 'email.opened' }).expect(404);

    expect(handle).not.toHaveBeenCalled();
  });
});
