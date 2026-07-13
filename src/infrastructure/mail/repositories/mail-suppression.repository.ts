import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';

import { generateUuid } from '@shared/utils/uuid.util';

import { MailSuppression } from '../entities/mail-suppression.entity';
import { MailSuppressionReason } from '../enums/mail-suppression-reason.enum';

@Injectable()
export class MailSuppressionRepository extends Repository<MailSuppression> {
  constructor(dataSource: DataSource) {
    super(MailSuppression, dataSource.createEntityManager());
  }

  // * A LAPSED suppression no longer blocks: an address is suppressed only while its window is open (or permanent).
  async isSuppressed(email: string): Promise<boolean> {
    const normalized = email.toLowerCase();

    return await this.existsBy([
      { email: normalized, expiresAt: IsNull() },
      { email: normalized, expiresAt: MoreThan(new Date()) },
    ]);
  }

  async suppress(params: {
    email: string;
    reason: MailSuppressionReason;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { email, reason, expiresAt, metadata } = params;

    // * ON CONFLICT UPDATE refreshes the suppression window on a repeat bounce (a genuinely new event — Svix replays
    // * are stopped upstream by the webhook inbox guard), so a lapsed-then-rebounced address is re-suppressed afresh.
    await this.query(
      `INSERT INTO "mail_suppressions" ("id", "email", "reason", "metadata", "expires_at") VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("email") DO UPDATE SET "reason" = EXCLUDED."reason", "metadata" = EXCLUDED."metadata", "expires_at" = EXCLUDED."expires_at"`,
      [generateUuid(), email.toLowerCase(), reason, metadata ? JSON.stringify(metadata) : null, expiresAt],
    );
  }
}
