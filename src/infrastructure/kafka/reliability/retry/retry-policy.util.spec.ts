import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  attemptNumber,
  baseTopicOf,
  matchRetryTier,
  nextDestination,
} from '@infrastructure/kafka/reliability/retry/retry-policy.util';

describe('@infrastructure/kafka/reliability/retry/retry-policy.util', () => {
  describe('matchRetryTier', () => {
    it('matches each tier topic to its index and delay', () => {
      expect(matchRetryTier('session_revoked.retry.5s')).toEqual({ index: 0, delayMs: 5_000 });
      expect(matchRetryTier('session_revoked.retry.1m')).toEqual({ index: 1, delayMs: 60_000 });
      expect(matchRetryTier('session_revoked.retry.10m')).toEqual({ index: 2, delayMs: 600_000 });
    });

    it('returns null for the main topic and the dlq', () => {
      expect(matchRetryTier('session_revoked')).toBeNull();
      expect(matchRetryTier('session_revoked.dlq')).toBeNull();
    });
  });

  describe('nextDestination', () => {
    it('routes a main-topic failure to the first retry tier', () => {
      expect(nextDestination({ baseTopic: KafkaTopic.SessionRevoked, currentTierIndex: null })).toBe(
        'session_revoked.retry.5s',
      );
    });

    it('routes a retry-tier failure to the next tier', () => {
      expect(nextDestination({ baseTopic: KafkaTopic.SessionRevoked, currentTierIndex: 0 })).toBe(
        'session_revoked.retry.1m',
      );
      expect(nextDestination({ baseTopic: KafkaTopic.SessionRevoked, currentTierIndex: 1 })).toBe(
        'session_revoked.retry.10m',
      );
    });

    it('routes the last tier to the dlq', () => {
      expect(nextDestination({ baseTopic: KafkaTopic.SessionRevoked, currentTierIndex: 2 })).toBe(
        'session_revoked.dlq',
      );
    });
  });

  describe('attemptNumber', () => {
    it('counts the cumulative attempt', () => {
      expect(attemptNumber(null)).toBe(1);
      expect(attemptNumber(0)).toBe(2);
      expect(attemptNumber(2)).toBe(4);
    });
  });

  describe('baseTopicOf', () => {
    it('strips the retry suffix from a retry-tier topic', () => {
      expect(baseTopicOf('session_revoked.retry.5s')).toBe('session_revoked');
      expect(baseTopicOf('session_revoked.retry.1m')).toBe('session_revoked');
      expect(baseTopicOf('session_revoked.retry.10m')).toBe('session_revoked');
    });

    it('returns a non-retry topic unchanged', () => {
      expect(baseTopicOf('session_revoked')).toBe('session_revoked');
      expect(baseTopicOf('session_revoked.dlq')).toBe('session_revoked.dlq');
    });
  });
});
