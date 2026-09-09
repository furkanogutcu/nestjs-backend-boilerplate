import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Redis, RedisOptions } from 'ioredis';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';

import { wrapRedisClient } from './redis-client-wrapper';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly failClosedClient: Redis;
  private readonly bullClient: Redis;

  constructor() {
    // ! Fail-closed: a command issued while down must reject, not buffer. BullMQ keeps the offline queue — it blocks.
    this.client = this.createClient({
      name: 'general',
      options: { commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS, enableOfflineQueue: false },
    });
    this.failClosedClient = wrapRedisClient(this.client);
    this.bullClient = this.createClient({ name: 'bullmq', options: { maxRetriesPerRequest: null } });
  }

  getClient(): Redis {
    return this.failClosedClient;
  }

  getBullConnection(): Redis {
    return this.bullClient;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.quit(this.client), this.quit(this.bullClient)]);
  }

  private createClient(params: { name: string; options: RedisOptions }): Redis {
    const { name, options } = params;
    const client = new Redis(env.REDIS_URL, {
      connectionName: `${appConfig.slug}:${name}`,
      ...options,
    });

    client.on('error', (error: Error) => {
      this.logger.error(`Redis client "${name}" error: ${error.message}`);
    });

    return client;
  }

  private async quit(client: Redis): Promise<void> {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }
}
