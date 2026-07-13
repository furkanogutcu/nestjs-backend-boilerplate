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
    // * Fail-closed (enableOfflineQueue=false): a command issued while down rejects instead of buffering silently, so Redis-only guarantees (idempotency, replay guards) surface a 503. BullMQ client keeps the default offline queue — it needs it for blocking commands.
    this.client = this.createClient({
      name: 'general',
      options: { commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS, enableOfflineQueue: false },
    });
    // * getClient() hands out a wrapped handle so a connectivity error becomes a 503 at the source; callers degrading gracefully just catch it.
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
