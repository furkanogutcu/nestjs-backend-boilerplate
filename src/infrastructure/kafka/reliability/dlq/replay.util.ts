import { IKafkaConsumerMessage } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

export interface IReplayOptions {
  topic: string;
  consumer?: string;
  limit?: number;
  filter?: string;
  dryRun: boolean;
  force: boolean;
}

export interface IReplayTarget {
  topic: string;
  key?: string;
  event: KafkaEvent;
}

export function parseReplayArgs(argv: string[]): IReplayOptions {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);

    return index !== -1 ? argv[index + 1] : undefined;
  };

  const topic = valueOf('--topic');

  if (!topic) {
    throw new Error('--topic <dlq-topic> is required');
  }

  const limit = valueOf('--limit');
  const consumer = valueOf('--consumer');
  const force = argv.includes('--force');

  if (force && !consumer) {
    throw new Error('--force requires --consumer <groupId> so the inbox delete is scoped to a single consumer group');
  }

  return {
    topic,
    consumer,
    limit: limit ? Number(limit) : undefined,
    filter: valueOf('--filter'),
    dryRun: argv.includes('--dry-run'),
    force,
  };
}

export function resolveReplayTarget(params: { message: IKafkaConsumerMessage; event: KafkaEvent }): IReplayTarget {
  const { message, event } = params;

  return { topic: event.topic, key: message.message.key?.toString(), event };
}

export function shouldReplay(params: { event: KafkaEvent; filter?: string }): boolean {
  const { event, filter } = params;

  if (!filter) {
    return true;
  }

  return event.meta.eventId === filter || event.meta.dedupKey === filter;
}

export function dedupIdOf(event: KafkaEvent): string {
  return event.meta.dedupKey ?? event.meta.eventId;
}
