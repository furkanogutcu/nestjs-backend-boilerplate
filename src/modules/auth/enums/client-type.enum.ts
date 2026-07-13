export enum ClientType {
  // * Browser SPA: the refresh token is delivered as an HttpOnly cookie (JS cannot read it) and CSRF-protected.
  Web = 'web',
  // * Native app: secure OS storage, so the refresh token travels in the JSON body / Bearer header — no cookies.
  Mobile = 'mobile',
}
