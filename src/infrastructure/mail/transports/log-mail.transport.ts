import { Injectable, Logger } from '@nestjs/common';

import { IMailMessage, IMailSendResult, IMailTransport } from '@shared/interfaces/mail-transport.interface';

// * No-op driver for non-production: renders nothing to the network, just logs the outgoing mail so local/CI runs
// * never depend on a real ESP. Selected via MAIL_DRIVER=log (the default outside production).
@Injectable()
export class LogMailTransport implements IMailTransport {
  private readonly logger = new Logger(LogMailTransport.name);

  // eslint-disable-next-line @typescript-eslint/require-await -- IMailTransport.send is async by contract; the log driver has no async work.
  async send(params: { message: IMailMessage; idempotencyKey?: string }): Promise<IMailSendResult> {
    const { message } = params;

    this.logger.log(`Mail (not sent — log driver) to=${message.to} subject="${message.subject}"`);

    return { id: null };
  }
}
