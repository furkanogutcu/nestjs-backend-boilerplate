import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { register, Registry, RegistryContentType } from 'prom-client';

import { Public } from '@shared/decorators/public.decorator';

const OPENMETRICS_ACCEPT = 'application/openmetrics-text';

@Controller('metrics')
export class MetricsController {
  private readonly registry = register as Registry<RegistryContentType>;

  @Get()
  @Public()
  @ApiOperation({ summary: 'Metrics' })
  // eslint-disable-next-line no-restricted-syntax -- NestJS route handler params are bound by @Req/@Res decorators
  async getMetrics(@Req() request: Request, @Res() response: Response): Promise<void> {
    const acceptsOpenMetrics = (request.headers.accept ?? '').includes(OPENMETRICS_ACCEPT);

    this.registry.setContentType(
      acceptsOpenMetrics ? Registry.OPENMETRICS_CONTENT_TYPE : Registry.PROMETHEUS_CONTENT_TYPE,
    );

    response.set('Content-Type', this.registry.contentType);
    response.send(await this.registry.metrics());
  }
}
