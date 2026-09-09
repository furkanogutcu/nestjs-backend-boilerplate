import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { SubjectRateLimit } from '@shared/decorators/subject-rate-limit.decorator';
import { SubjectRateLimitPolicy } from '@shared/interfaces/rate-limit-rule.interface';

import { CurrentUser } from '../decorators/current-user.decorator';
import {
  AccountDeletionStatusResponse,
  accountDeletionStatusResponseSchema,
  DataExportResponse,
  dataExportResponseSchema,
} from './schemas/privacy.response';
import { AccountDeletionService } from './services/account-deletion.service';
import { DataExportService } from './services/data-export.service';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('me')
export class PrivacyController {
  constructor(
    private readonly accountDeletionService: AccountDeletionService,
    private readonly dataExportService: DataExportService,
  ) {}

  @Get('deletion')
  @ApiOperation({ summary: 'Get deletion status', description: 'Whether an erasure is pending, and when it happens.' })
  @ResponseDto({
    schema: accountDeletionStatusResponseSchema,
    description: 'Current deletion state.',
    errors: [HttpStatus.UNAUTHORIZED],
  })
  async status(@CurrentUser() user: { id: string }): Promise<AccountDeletionStatusResponse> {
    return this.toStatusResponse(await this.accountDeletionService.status({ userId: user.id }));
  }

  @Post('deletion')
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @ApiOperation({
    summary: 'Request account deletion',
    description:
      'Schedules erasure after the grace period. The account keeps working until then so the request can be withdrawn.',
  })
  @ResponseDto({
    schema: accountDeletionStatusResponseSchema,
    status: HttpStatus.ACCEPTED,
    description: 'Deletion scheduled.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.CONFLICT, HttpStatus.TOO_MANY_REQUESTS],
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async requestDeletion(@CurrentUser() user: { id: string }): Promise<AccountDeletionStatusResponse> {
    return this.toStatusResponse(await this.accountDeletionService.request({ userId: user.id }));
  }

  @Delete('deletion')
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a deletion request', description: 'Only possible during the grace period.' })
  async cancelDeletion(@CurrentUser() user: { id: string }): Promise<void> {
    await this.accountDeletionService.cancel({ userId: user.id });
  }

  @Get('export')
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @ApiOperation({
    summary: 'Export personal data',
    description: 'Everything the service holds about the authenticated person, without any credential material.',
  })
  @ResponseDto({
    schema: dataExportResponseSchema,
    description: 'The personal-data export.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS],
  })
  async exportData(@CurrentUser() user: { id: string }): Promise<DataExportResponse> {
    return await this.dataExportService.export({ userId: user.id });
  }

  private toStatusResponse(status: {
    requestedAt: Date | null;
    scheduledFor: Date | null;
  }): AccountDeletionStatusResponse {
    return {
      requested_at: status.requestedAt?.toISOString() ?? null,
      scheduled_for: status.scheduledFor?.toISOString() ?? null,
    };
  }
}
