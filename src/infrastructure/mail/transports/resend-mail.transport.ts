import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { Resend } from 'resend';

import { env } from '@config/env.config';
import { IMailMessage, IMailSendResult, IMailTransport } from '@shared/interfaces/mail-transport.interface';

@Injectable()
export class ResendMailTransport implements IMailTransport {
  private readonly resend = new Resend(env.RESEND_API_KEY);

  async send(params: { message: IMailMessage; idempotencyKey?: string }): Promise<IMailSendResult> {
    const { message, idempotencyKey } = params;

    const { data, error } = await this.resend.emails.send(
      { from: message.from, to: message.to, subject: message.subject, html: message.html },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    if (error) {
      const description = `Resend send failed (${error.name}, status ${error.statusCode ?? 'none'}): ${error.message}`;

      // * 4xx other than 429 are permanent (invalid payload/address, auth) — a retry fails identically, so tell
      // * BullMQ to stop burning attempts. Network/unknown, 429 and 5xx are transient → plain Error triggers retry.
      if (error.statusCode !== null && error.statusCode < 500 && error.statusCode !== 429) {
        throw new UnrecoverableError(description);
      }

      throw new Error(description);
    }

    return { id: data.id };
  }
}
