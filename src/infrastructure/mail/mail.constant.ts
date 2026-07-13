import { MS_PER_DAY } from '@shared/constants/unit.constant';

// * How long a bounce/complaint suppression holds before it lapses. Bounded (not permanent) so a false-positive or a
// * now-fixed address can receive transactional mail again; a genuine repeat bounce simply refreshes the window.
export const MAIL_SUPPRESSION_TTL_MS = 30 * MS_PER_DAY;

// * Replay window for the inbound webhook inbox key, comfortably above Svix's 5-minute signature tolerance so a
// * captured, still-valid signed event cannot be re-applied.
export const MAIL_WEBHOOK_INBOX_TTL_SECONDS = 10 * 60;
