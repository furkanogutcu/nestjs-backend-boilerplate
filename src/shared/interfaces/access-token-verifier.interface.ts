// * The verified identity carried by a valid access token — the minimal, transport-agnostic shape a non-HTTP
// * entry point (the realtime WS handshake) needs to authenticate and scope a connection. Named by meaning, not
// * by the raw JWT claim keys (sub/sid/fid), so consumers never couple to the token encoding.
export interface IVerifiedIdentity {
  userId: string;
  sessionId: string;
  familyId: string;
  /** Absolute access-token expiry (epoch ms) — lets a long-lived transport end the connection when the credential dies. */
  tokenExpiresAtEpochMillis: number;
}

// * Provider-agnostic access-token verification port: verify a bearer access token's signature/claims and return
// * the identity, or throw when it is missing/invalid/expired. Implemented by the auth layer, consumed by
// * infrastructure entry points via the ACCESS_TOKEN_VERIFIER token. Callable off the request context (no
// * ExecutionContext, no HTTP), which is what makes it usable from a WebSocket handshake.
export interface IAccessTokenVerifier {
  verify(params: { token: string }): Promise<IVerifiedIdentity>;
}
