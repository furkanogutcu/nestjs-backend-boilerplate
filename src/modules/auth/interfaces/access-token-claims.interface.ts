export interface IAccessTokenClaims {
  sub: string;
  sid: string;
  fid: string;
  /** Absolute expiry as issued by the signer (epoch seconds, the raw JWT `exp`). */
  exp: number;
}
