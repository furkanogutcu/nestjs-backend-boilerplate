import { MAX_DISPLAY_NAME_LENGTH } from '../constants/auth.constant';

export function sanitizeDisplayName(name?: string | null): string | null {
  if (!name) {
    return null;
  }

  const normalized = name
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_DISPLAY_NAME_LENGTH);
}
