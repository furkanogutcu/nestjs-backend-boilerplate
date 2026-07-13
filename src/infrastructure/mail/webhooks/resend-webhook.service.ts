import { Injectable, Logger } from '@nestjs/common';
import { Resend, type WebhookEventPayload } from 'resend';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { CacheKey } from '@shared/utils/cache-key.util';

import { MailSuppressionReason } from '../enums/mail-suppression-reason.enum';
import { MAIL_SUPPRESSION_TTL_MS, MAIL_WEBHOOK_INBOX_TTL_SECONDS } from '../mail.constant';
import { MailSuppressionRepository } from '../repositories/mail-suppression.repository';

interface IResendWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);
  private readonly resend = new Resend(env.RESEND_API_KEY);

  constructor(
    private readonly suppressionRepository: MailSuppressionRepository,
    private readonly redisService: RedisService,
    private readonly clock: ClockService,
  ) {}

  async handle(params: { payload: string; headers: IResendWebhookHeaders }): Promise<void> {
    const event = this.verify(params);

    // * Replay/inbox guard: a valid signature stays acceptable for Svix's 5-minute tolerance, so a captured signed
    // * event could be re-POSTed. Claim the first delivery by its Svix message id and drop any repeat before it acts.
    if (!(await this.claimDelivery(params.headers.id))) {
      return;
    }

    if (event.type === 'email.bounced') {
      // * Only permanent bounces warrant suppression; a transient bounce (full mailbox, greylisting) may clear.
      if (event.data.bounce.type !== 'Transient') {
        await this.suppress({
          recipients: event.data.to,
          reason: MailSuppressionReason.Bounce,
          metadata: { emailId: event.data.email_id, bounce: event.data.bounce },
        });
      }

      return;
    }

    if (event.type === 'email.complained') {
      await this.suppress({
        recipients: event.data.to,
        reason: MailSuppressionReason.Complaint,
        metadata: { emailId: event.data.email_id },
      });
    }
  }

  private verify(params: { payload: string; headers: IResendWebhookHeaders }): WebhookEventPayload {
    const { payload, headers } = params;

    try {
      return this.resend.webhooks.verify({ payload, headers, webhookSecret: env.RESEND_WEBHOOK_SECRET ?? '' });
    } catch {
      throw new AppUnauthorizedException({ message: 'Invalid Resend webhook signature' });
    }
  }

  // * Single-use claim on the Svix message id. Empty id would collapse every empty-id event onto one key, so reject
  // * it outright (a signed event always carries one). SET NX succeeds only for the first delivery of a given id.
  private async claimDelivery(svixId: string): Promise<boolean> {
    if (!svixId) {
      throw new AppUnauthorizedException({ message: 'Missing Svix message id' });
    }

    const key = CacheKey.join(appConfig.redis.keyPrefixes.mailWebhookInbox, svixId);
    const result = await this.redisService.getClient().set(key, '1', 'EX', MAIL_WEBHOOK_INBOX_TTL_SECONDS, 'NX');

    return result === 'OK';
  }

  private async suppress(params: {
    recipients: string[];
    reason: MailSuppressionReason;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const { recipients, reason, metadata } = params;
    // * Bounded window (not permanent) so a false-positive or a now-fixed address recovers; a repeat bounce refreshes it.
    const expiresAt = new Date(this.clock.epochMillis() + MAIL_SUPPRESSION_TTL_MS);

    for (const email of recipients) {
      await this.suppressionRepository.suppress({ email, reason, expiresAt, metadata });
    }

    this.logger.log(`Suppressed ${recipients.length} address(es) via Resend webhook (${reason})`);
  }
}
