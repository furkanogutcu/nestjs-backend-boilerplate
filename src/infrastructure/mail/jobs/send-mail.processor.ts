import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { Job } from 'bullmq';

import { extractJobTrace } from '@infrastructure/queues/queue-trace.util';
import { AppQueue } from '@shared/enums/queue.enum';

import { MailService } from '../mail.service';
import { ISendMailParams, sendMailSchema } from '../schemas/send-mail.schema';

@Processor(AppQueue.SendMail, { concurrency: 5 })
export class SendMailProcessor extends WorkerHost {
  private readonly logger = new Logger(SendMailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<ISendMailParams>): Promise<void> {
    const parentContext = extractJobTrace(job.data);

    await context.with(
      parentContext,
      async () =>
        await trace.getTracer('bullmq').startActiveSpan(
          'bullmq.process send-mail',
          {
            kind: SpanKind.CONSUMER,
            attributes: { 'messaging.system': 'bullmq', 'messaging.destination.name': 'send-mail' },
          },
          async (span) => {
            try {
              const payload = sendMailSchema.parse(job.data);

              await this.mailService.send({
                payload,
                idempotencyKey: job.id,
                securityCritical: payload.securityCritical,
              });
            } catch (error) {
              span.recordException(error as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw error;
            } finally {
              span.end();
            }
          },
        ),
    );
  }

  @OnWorkerEvent('failed')
  // eslint-disable-next-line no-restricted-syntax -- BullMQ worker event handler signature is fixed (job, error)
  onFailed(job: Job<ISendMailParams>, error: Error): void {
    this.logger.error(
      `Mail job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${error.message}`,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Mail worker error: ${error.message}`);
  }
}
