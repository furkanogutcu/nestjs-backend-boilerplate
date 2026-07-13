import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerMessage } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import {
  dedupIdOf,
  parseReplayArgs,
  resolveReplayTarget,
  shouldReplay,
} from '@infrastructure/kafka/reliability/dlq/replay.util';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

const event = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', eventVersion: 1, timestamp: '1' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
} as KafkaEvent;

describe('replay helpers', () => {
  describe('parseReplayArgs', () => {
    it('parses the topic and flags', () => {
      const argv = [
        '--topic',
        'session_revoked.dlq',
        '--consumer',
        'g',
        '--limit',
        '10',
        '--filter',
        'abc',
        '--dry-run',
        '--force',
      ];

      expect(parseReplayArgs(argv)).toEqual({
        topic: 'session_revoked.dlq',
        consumer: 'g',
        limit: 10,
        filter: 'abc',
        dryRun: true,
        force: true,
      });
    });

    it('defaults the optional flags', () => {
      expect(parseReplayArgs(['--topic', 'session_revoked.dlq'])).toEqual({
        topic: 'session_revoked.dlq',
        consumer: undefined,
        limit: undefined,
        filter: undefined,
        dryRun: false,
        force: false,
      });
    });

    it('throws when the topic is missing', () => {
      expect(() => parseReplayArgs(['--limit', '5'])).toThrow('--topic');
    });

    it('throws when --force is used without --consumer', () => {
      expect(() => parseReplayArgs(['--topic', 'session_revoked.dlq', '--force'])).toThrow(
        '--force requires --consumer',
      );
    });
  });

  describe('resolveReplayTarget', () => {
    it('targets the original topic with the original key', () => {
      const message = { message: { key: Buffer.from('agg-1') } } as unknown as IKafkaConsumerMessage;

      expect(resolveReplayTarget({ message, event })).toEqual({ topic: 'session_revoked', key: 'agg-1', event });
    });
  });

  describe('shouldReplay', () => {
    it('replays everything without a filter', () => {
      expect(shouldReplay({ event })).toBe(true);
    });

    it('matches the filter against eventId or dedupKey', () => {
      expect(shouldReplay({ event, filter: event.meta.eventId })).toBe(true);
      expect(
        shouldReplay({ event: { ...event, meta: { ...event.meta, dedupKey: 'trade:1' } }, filter: 'trade:1' }),
      ).toBe(true);
      expect(shouldReplay({ event, filter: 'other' })).toBe(false);
    });
  });

  describe('dedupIdOf', () => {
    it('prefers dedupKey then falls back to eventId', () => {
      expect(dedupIdOf(event)).toBe(event.meta.eventId);
      expect(dedupIdOf({ ...event, meta: { ...event.meta, dedupKey: 'trade:1' } })).toBe('trade:1');
    });
  });
});
