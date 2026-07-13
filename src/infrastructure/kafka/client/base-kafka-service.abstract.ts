import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, LogEntry, logLevel as KafkaJSLogLevel, SASLOptions } from 'kafkajs';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';

type KafkaLoggerMethod = 'error' | 'warn' | 'debug' | 'log';

@Injectable()
export abstract class BaseKafkaService implements OnModuleInit, OnModuleDestroy {
  protected readonly kafka: Kafka;

  constructor() {
    this.kafka = new Kafka({
      clientId: `${appConfig.slug}-${env.NODE_ENV.toLowerCase()}-kafka-client`,
      brokers: env.KAFKA_BROKERS,
      ssl: env.KAFKA_SSL,
      sasl: this.buildSasl(),
      logCreator: BaseKafkaService.kafkaLogCreator,
    });
  }

  abstract onModuleInit(): Promise<void> | void;
  abstract onModuleDestroy(): Promise<void> | void;

  private buildSasl(): SASLOptions | undefined {
    if (!env.KAFKA_SASL_MECHANISM) {
      return undefined;
    }

    return {
      mechanism: env.KAFKA_SASL_MECHANISM,
      username: env.KAFKA_SASL_USERNAME!,
      password: env.KAFKA_SASL_PASSWORD!,
    };
  }

  private static kafkaLogCreator(): (entry: LogEntry) => void {
    const logger = new Logger('Kafka');

    return ({ level, log }: LogEntry) => {
      const { message, ...kafka } = log;

      const method: KafkaLoggerMethod =
        level === KafkaJSLogLevel.ERROR
          ? 'error'
          : level === KafkaJSLogLevel.WARN
            ? 'warn'
            : level === KafkaJSLogLevel.INFO
              ? 'log'
              : 'debug';

      logger[method]({ msg: message, kafka });
    };
  }
}
