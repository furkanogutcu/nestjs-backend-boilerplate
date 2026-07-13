export interface IMailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface IMailSendResult {
  // * Provider message id, or null for drivers that do not emit one (e.g. the log driver).
  id: string | null;
}

// * Provider-agnostic mail send contract. `idempotencyKey` deduplicates the provider-side send so a queue retry
// * never delivers the same mail twice. Implementations must throw on failure: a bullmq UnrecoverableError for
// * permanent failures (invalid payload, rejected address) so the queue stops retrying, or any other Error for
// * transient failures (network, rate limit, 5xx) so the queue retries under its backoff policy.
export interface IMailTransport {
  send(params: { message: IMailMessage; idempotencyKey?: string }): Promise<IMailSendResult>;
}
