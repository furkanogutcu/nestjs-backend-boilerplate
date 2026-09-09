import { Injectable, Logger } from '@nestjs/common';

import { IMailMessage, IMailSendResult, IMailTransport } from '@shared/interfaces/mail-transport.interface';

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
