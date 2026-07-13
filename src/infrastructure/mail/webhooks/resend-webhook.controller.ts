import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '@shared/decorators/public.decorator';

import { ResendWebhookService } from './resend-webhook.service';

// * VERSION_NEUTRAL keeps the path at /webhooks/resend (off the /api/v<n> prefix): the URL is an external contract
// * configured in the Resend dashboard and must not move when the API is versioned.
@Controller({ path: 'webhooks/resend', version: VERSION_NEUTRAL })
export class ResendWebhookController {
  constructor(private readonly service: ResendWebhookService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resend webhook' })
  // eslint-disable-next-line no-restricted-syntax -- NestJS route handler params are bound by @Req/@Headers decorators
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<void> {
    await this.service.handle({
      payload: request.rawBody?.toString('utf8') ?? '',
      headers: {
        id: headers['svix-id'] ?? '',
        timestamp: headers['svix-timestamp'] ?? '',
        signature: headers['svix-signature'] ?? '',
      },
    });
  }
}
