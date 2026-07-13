export enum KafkaTopic {
  // * A refresh-token session (or a whole token family) was revoked by logout, reuse detection or family-cap
  // * eviction — NOT by normal rotation (that would kick sockets on every token refresh). The realtime fanout
  // * consumer disconnects the matching live sockets. Enforcement stays in the Redis denylist checked at every
  // * verify; this event is best-effort connection hygiene on top.
  SessionRevoked = 'session_revoked',
}
