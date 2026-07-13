import { NestFactory } from '@nestjs/core';

import { OutboxRequeueModule } from '@infrastructure/kafka/reliability/outbox/scripts/outbox-requeue.module';
import { OutboxRequeueService } from '@infrastructure/kafka/reliability/outbox/scripts/outbox-requeue.service';
import { parseRequeueArgs } from '@infrastructure/kafka/reliability/outbox/scripts/outbox-requeue.util';

async function requeue(): Promise<void> {
  const options = parseRequeueArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(OutboxRequeueModule, { logger: ['error', 'warn', 'log'] });

  try {
    await app.get(OutboxRequeueService).run(options);
  } finally {
    await app.close();
  }
}

void requeue().catch((error) => {
  console.error('Outbox requeue failed:', error);
  process.exit(1);
});
