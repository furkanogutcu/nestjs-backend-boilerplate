// * RFC 6238 defaults: 6 digits over 30-second steps, SHA-1 — what every authenticator app assumes.
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_ALGORITHM = 'SHA1';

// ! One step of clock skew either way. Widening this multiplies the codes valid at any moment, which is exactly
// ! the brute-force surface; 1 is the standard tolerance and should not be raised to paper over clock drift.
export const TOTP_WINDOW = 1;

export const TOTP_SECRET_BYTES = 20;

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_BYTES = 10;
