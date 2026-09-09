export interface IMailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface IMailSendResult {
  id: string | null;
}

// ! Throw UnrecoverableError for permanent failures so the queue stops retrying; any other Error for transient ones.
export interface IMailTransport {
  send(params: { message: IMailMessage; idempotencyKey?: string }): Promise<IMailSendResult>;
}
