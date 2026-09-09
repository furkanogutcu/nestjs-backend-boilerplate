import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { readdir, readFile } from 'fs/promises';
import handlebars from 'handlebars';
import { join } from 'path';

import { env } from '@config/env.config';
import { MAIL_TRANSPORT } from '@shared/constants/mail-transport.constant';
import { AppInternalException } from '@shared/exceptions/internal.exception';
import type { IMailTransport } from '@shared/interfaces/mail-transport.interface';

import { MailSuppressionRepository } from './repositories/mail-suppression.repository';
import { ISendMailParams } from './schemas/send-mail.schema';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly templatesDir = join(__dirname, 'templates');
  private readonly templates = new Map<string, ReturnType<typeof handlebars.compile>>();

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: IMailTransport,
    private readonly suppressionRepository: MailSuppressionRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadTemplates();
  }

  async send(params: { payload: ISendMailParams; idempotencyKey?: string; securityCritical?: boolean }): Promise<void> {
    const { payload, idempotencyKey, securityCritical } = params;
    const template = this.templates.get(payload.template);

    if (!template) {
      throw new AppInternalException({ message: `Mail template "${payload.template}" not found` });
    }

    await trace.getTracer('mail').startActiveSpan(
      'mail.send',
      {
        kind: SpanKind.PRODUCER,
        attributes: { 'mail.template': payload.template, 'mail.recipient_domain': payload.to.split('@')[1] ?? '' },
      },
      async (span) => {
        try {
          if (!securityCritical && (await this.suppressionRepository.isSuppressed(payload.to))) {
            span.setAttribute('mail.suppressed', true);
            // ! Domain only, never the full address (PII).
            this.logger.warn(
              `Mail skipped (recipient domain=${payload.to.split('@')[1] ?? 'unknown'}): address is on the suppression list`,
            );

            return;
          }

          const result = await this.transport.send({
            message: {
              from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`,
              to: payload.to,
              subject: payload.subject,
              html: template(payload.context),
            },
            idempotencyKey,
          });

          if (result.id) {
            span.setAttribute('mail.message_id', result.id);
          }
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private async loadTemplates(): Promise<void> {
    let files: string[];

    try {
      files = await readdir(this.templatesDir);
    } catch {
      this.logger.warn(`Mail templates directory not found: ${this.templatesDir}`);
      return;
    }

    for (const file of files.filter((name) => name.endsWith('.hbs'))) {
      const content = await readFile(join(this.templatesDir, file), 'utf-8');

      this.templates.set(file.replace(/\.hbs$/, ''), handlebars.compile(content));
    }

    this.logger.log(`Loaded ${this.templates.size} mail template(s)`);
  }
}
