export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_ALGORITHM = 'SHA1';

// ! One step either way. Widening this multiplies the codes valid at any moment — that is the brute-force surface.
export const TOTP_WINDOW = 1;

export const TOTP_SECRET_BYTES = 20;

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_BYTES = 10;
