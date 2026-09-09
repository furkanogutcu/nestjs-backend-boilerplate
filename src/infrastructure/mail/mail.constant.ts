import { MS_PER_DAY } from '@shared/constants/unit.constant';

export const MAIL_SUPPRESSION_TTL_MS = 30 * MS_PER_DAY;

// ! Must stay above Svix's 5-minute signature tolerance, or a captured event is replayable once the key expires.
export const MAIL_WEBHOOK_INBOX_TTL_SECONDS = 10 * 60;
