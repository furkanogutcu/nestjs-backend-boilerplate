// * Must load before instrumented modules so replay spans reach the OTel pipeline.
import '@infrastructure/observability/tracing';

import { NestFactory } from '@nestjs/core';

import { DlqReplayModule } from '@infrastructure/kafka/reliability/dlq/dlq-replay.module';
import { DlqReplayService } from '@infrastructure/kafka/reliability/dlq/dlq-replay.service';
import { parseReplayArgs } from '@infrastructure/kafka/reliability/dlq/replay.util';

async function replay(): Promise<void> {
  const options = parseReplayArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(DlqReplayModule, { logger: false });

  try {
    await app.get(DlqReplayService).run(options);
  } finally {
    await app.close();
  }
}

void replay().catch((error) => {
  console.error('DLQ replay failed:', error);
  process.exit(1);
});
