export interface IClientHeaders {
  userAgent?: string;
  idempotencyKey?: string;
  // * Carried alongside the headers so a service can attribute an audit record without reaching for the request.
  ipAddress?: string;
  requestId?: string;
}
