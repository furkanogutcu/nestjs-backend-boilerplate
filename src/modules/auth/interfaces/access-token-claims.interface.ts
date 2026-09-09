export interface IAccessTokenClaims {
  sub: string;
  sid: string;
  fid: string;
  // * Epoch seconds (the raw JWT `exp`), not milliseconds.
  exp: number;
}
