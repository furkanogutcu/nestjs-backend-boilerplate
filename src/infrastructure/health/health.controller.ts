import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import type { Response } from 'express';

import { ClockService } from '@infrastructure/clock/clock.service';
import { KafkaHealthIndicator } from '@infrastructure/kafka/observability/kafka.health-indicator';
import { Public } from '@shared/decorators/public.decorator';

import { RedisHealthIndicator } from './redis.health-indicator';

const READINESS_CACHE_TTL_MS = 2000;

@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private cache: { at: number; healthy: boolean } | null = null;
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly databaseIndicator: TypeOrmHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly kafkaIndicator: KafkaHealthIndicator,
    private readonly clock: ClockService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness' })
  liveness(@Res() res: Response): void {
    res.status(HttpStatus.OK).json({ status: 'ok' });
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness' })
  async readiness(@Res() res: Response): Promise<void> {
    const healthy = await this.resolveReadiness();

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({ status: healthy ? 'ok' : 'error' });
  }

  private async resolveReadiness(): Promise<boolean> {
    if (this.cache && this.clock.epochMillis() - this.cache.at < READINESS_CACHE_TTL_MS) {
      return this.cache.healthy;
    }

    if (!this.inFlight) {
      this.inFlight = this.runReadinessCheck();
    }

    return await this.inFlight;
  }

  private async runReadinessCheck(): Promise<boolean> {
    let healthy: boolean;

    try {
      await this.healthCheckService.check([
        async () => await this.databaseIndicator.pingCheck('database'),
        async () => await this.redisIndicator.isHealthy('redis'),
        () => this.kafkaIndicator.isHealthy('kafka'),
      ]);
      healthy = true;
    } catch (error) {
      this.logger.warn(`Readiness check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      healthy = false;
    }

    this.cache = { at: this.clock.epochMillis(), healthy };
    this.inFlight = null;

    return healthy;
  }
}
