import { IncomingMessage } from 'node:http';

import { INestApplicationContext, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { Server, ServerOptions } from 'socket.io';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { CacheKey } from '@shared/utils/cache-key.util';
import { resolveClientIp, TrustProxyFn } from '@shared/utils/ip.util';

import { REALTIME_CONNECT_TIMEOUT_MS } from '../constants/realtime-connection.constant';
import { REALTIME_ENGINE_HANDSHAKE_IP_RATE_LIMIT } from '../constants/realtime-rate-limit.constant';
import { RealtimeMetricsService } from '../observability/realtime-metrics.service';

// * Socket.io adapter backed by Redis pub/sub so an emit on ANY instance fans out to that room's connections on
// * EVERY instance — the horizontal-scale primitive for 500k–1M sockets across many gateway nodes. Uses two
// * dedicated raw ioredis connections (pub + sub: a connection in subscriber mode cannot issue normal commands),
// * isolated from the fail-closed RedisService client and namespaced under the app's realtime key prefix.
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(private readonly appContext: INestApplicationContext) {
    super(appContext);
  }

  // eslint-disable-next-line no-restricted-syntax -- overrides IoAdapter.createIOServer, whose (port, options) signature is fixed by NestJS and called positionally
  createIOServer(port: number, options?: ServerOptions): Server {
    // * Engine-level pre-allocation gate: the namespace auth middleware only runs after the client sends the
    // * socket.io CONNECT packet, so a client that completes the raw upgrade and never CONNECTs would otherwise
    // * hold a socket (for connectTimeout) untouched by any budget. allowRequest runs BEFORE the Socket is
    // * allocated, so the per-IP flood gate here bounds that connection-exhaustion vector.
    const rateLimitService = this.appContext.get(RateLimitService, { strict: false });
    const metrics = this.appContext.get(RealtimeMetricsService, { strict: false });
    const expressApp = this.appContext.get(HttpAdapterHost, { strict: false }).httpAdapter.getInstance();

    const server = super.createIOServer(port, {
      ...options,
      connectTimeout: REALTIME_CONNECT_TIMEOUT_MS,
      // eslint-disable-next-line no-restricted-syntax -- engine.io allowRequest signature is fixed (req, callback)
      allowRequest: (
        request: IncomingMessage,
        callback: (err: string | null | undefined, success: boolean) => void,
      ) => {
        const trustFn = expressApp.get('trust proxy fn') as TrustProxyFn | undefined;

        void this.gateEngineRequest({ request, trustFn, rateLimitService, metrics, callback });
      },
    }) as Server;

    this.pubClient = new Redis(env.REDIS_URL, { connectionName: `${appConfig.slug}:realtime-pub` });
    this.subClient = this.pubClient.duplicate();
    for (const client of [this.pubClient, this.subClient]) {
      client.on('error', (error: Error) => {
        // * The pub/sub pair is the sole cross-instance transport for session-revocation kicks and the cluster-wide
        // * socket cap. Surfacing the error as a metric (not just a log) makes degradation alertable; readiness is
        // * intentionally NOT failed here — on a single instance that would be a self-DoS (see the audit remediation).
        metrics.recordAdapterError();
        this.logger.error(`Realtime Redis adapter error: ${error.message}`);
      });
    }

    server.adapter(createAdapter(this.pubClient, this.subClient, { key: appConfig.redis.keyPrefixes.realtime }));

    return server;
  }

  // * NestJS calls this on graceful shutdown; the two raw ioredis connections are created outside DI (this adapter
  // * is `new`ed in main.ts, so it cannot hook OnApplicationShutdown), so they are quit here to avoid leaking a
  // * connection pair across a hot-reload / rolling deploy.
  async close(server: Server): Promise<void> {
    // * allSettled: quit() rejects on an already-down connection; a failed quit must not abort the shutdown
    // * sequence (super.close would be skipped and the http server left dangling).
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
    await super.close(server);
  }

  private async gateEngineRequest({
    request,
    trustFn,
    rateLimitService,
    metrics,
    callback,
  }: {
    request: IncomingMessage;
    trustFn: TrustProxyFn | undefined;
    rateLimitService: RateLimitService;
    metrics: RealtimeMetricsService;
    callback: (err: string | null | undefined, success: boolean) => void;
  }): Promise<void> {
    const ip = resolveClientIp({ remoteAddress: request.socket?.remoteAddress, headers: request.headers, trustFn });

    try {
      await rateLimitService.consumeByKey({
        options: REALTIME_ENGINE_HANDSHAKE_IP_RATE_LIMIT,
        key: CacheKey.join('realtime-engine', ip),
      });

      callback(null, true);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        metrics.recordHandshake({ outcome: 'rejected', reason: 'rate_limited' });

        return callback('rate_limited', false);
      }

      // * Fail-open on limiter infrastructure errors (Redis down), mirroring the namespace tiers: the limiter is a
      // * throttle, not an auth control, and hard-rejecting here would keep every reconnecting client out for the
      // * whole Redis outage window. Token verification still runs in the namespace middleware.
      this.logger.error(
        `Realtime engine gate limiter unavailable, failing open: ${error instanceof Error ? error.message : 'unknown error'}`,
      );

      callback(null, true);
    }
  }
}
