import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { env } from '@config/env.config';
import { MAIL_TRANSPORT } from '@shared/constants/mail-transport.constant';
import { AppQueue } from '@shared/enums/queue.enum';

import { MailProducer } from './jobs/mail.producer';
import { SendMailProcessor } from './jobs/send-mail.processor';
import { MailService } from './mail.service';
import { MailSuppressionRepository } from './repositories/mail-suppression.repository';
import { LogMailTransport } from './transports/log-mail.transport';
import { ResendMailTransport } from './transports/resend-mail.transport';
import { ResendWebhookController } from './webhooks/resend-webhook.controller';
import { ResendWebhookService } from './webhooks/resend-webhook.service';

const isResend = env.MAIL_DRIVER === 'resend';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: AppQueue.SendMail })],
  controllers: isResend ? [ResendWebhookController] : [],
  providers: [
    MailService,
    MailProducer,
    SendMailProcessor,
    MailSuppressionRepository,
    ...(isResend ? [ResendWebhookService] : []),
    { provide: MAIL_TRANSPORT, useClass: isResend ? ResendMailTransport : LogMailTransport },
  ],
  exports: [MailService, MailProducer],
})
export class MailModule {}
