import { Logger } from '@nestjs/common';
import { Kafka, logLevel } from 'kafkajs';

import { env } from '@config/env.config';
import { BaseKafkaService } from '@infrastructure/kafka/client/base-kafka-service.abstract';

jest.mock('kafkajs', () => {
  const actual = jest.requireActual('kafkajs');

  return { ...actual, Kafka: jest.fn() };
});
jest.mock('@config/env.config', () => ({
  env: { NODE_ENV: 'test', KAFKA_BROKERS: ['localhost:9092'], KAFKA_SSL: false },
}));

class TestKafkaService extends BaseKafkaService {
  onModuleInit(): void {}
  onModuleDestroy(): void {}
}

type MutableSaslEnv = {
  KAFKA_SASL_MECHANISM?: string;
  KAFKA_SASL_USERNAME?: string;
  KAFKA_SASL_PASSWORD?: string;
};

function lastKafkaConfig(): ReturnType<typeof jest.mocked<typeof Kafka>>['mock']['calls'][number][0] {
  return jest.mocked(Kafka).mock.calls.at(-1)![0];
}

describe('BaseKafkaService', () => {
  beforeEach(() => {
    const sasl = env as MutableSaslEnv;
    sasl.KAFKA_SASL_MECHANISM = undefined;
    sasl.KAFKA_SASL_USERNAME = undefined;
    sasl.KAFKA_SASL_PASSWORD = undefined;
  });

  it('builds the Kafka client from configuration', () => {
    new TestKafkaService();

    const config = lastKafkaConfig();
    expect(config.clientId).toBe('app-test-kafka-client');
    expect(config.brokers).toEqual(['localhost:9092']);
    expect(config.sasl).toBeUndefined();
  });

  it('configures SASL when a mechanism is provided', () => {
    const sasl = env as MutableSaslEnv;
    sasl.KAFKA_SASL_MECHANISM = 'plain';
    sasl.KAFKA_SASL_USERNAME = 'user';
    sasl.KAFKA_SASL_PASSWORD = 'pass';

    new TestKafkaService();

    expect(lastKafkaConfig().sasl).toEqual({ mechanism: 'plain', username: 'user', password: 'pass' });
  });

  describe('log creator', () => {
    it.each([
      ['error', logLevel.ERROR],
      ['warn', logLevel.WARN],
      ['log', logLevel.INFO],
      ['debug', logLevel.DEBUG],
      ['debug', logLevel.NOTHING],
      // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
    ])('routes a kafka %s entry to the matching logger method', (method, level) => {
      const spy = jest.spyOn(Logger.prototype, method as 'error').mockImplementation(() => undefined);
      new TestKafkaService();

      const logCreator = lastKafkaConfig().logCreator;
      const write = logCreator!(level);
      write({
        namespace: 'test',
        label: 'LABEL',
        level,
        log: { timestamp: '1', logger: 'kafka', message: 'hello', extra: 1 },
      });

      expect(spy).toHaveBeenCalledWith({ msg: 'hello', kafka: expect.objectContaining({ extra: 1 }) });
    });
  });
});
