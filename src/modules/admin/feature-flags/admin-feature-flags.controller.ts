import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { FeatureFlag } from '@infrastructure/feature-flags/entities/feature-flag.entity';
import { FeatureFlagsService } from '@infrastructure/feature-flags/services/feature-flags.service';
import { RequirePermission } from '@modules/auth/rbac/decorators/require-permission.decorator';
import { Permission } from '@modules/auth/rbac/permission.enum';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';

import type { UpsertFeatureFlagRequest } from './schemas/admin-feature-flag';
import { AdminFeatureFlagResponse, adminFeatureFlagResponseSchema } from './schemas/admin-feature-flag';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/feature-flags')
export class AdminFeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  @RequirePermission(Permission.FeatureFlagsRead)
  @ApiOperation({ summary: 'List feature flags' })
  @ResponseDto({
    schema: adminFeatureFlagResponseSchema,
    description: 'Every known flag.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN],
  })
  async list(): Promise<AdminFeatureFlagResponse[]> {
    return (await this.featureFlagsService.list()).map((flag) => this.toResponse(flag));
  }

  @Put(':key')
  @RequirePermission(Permission.FeatureFlagsWrite)
  @ApiOperation({
    summary: 'Create or toggle a feature flag',
    description: 'Idempotent: creates the flag when it does not exist, otherwise updates it.',
  })
  @ResponseDto({
    schema: adminFeatureFlagResponseSchema,
    description: 'The stored flag.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN],
  })
  async upsert(@Param('key') key: string, @Body() body: UpsertFeatureFlagRequest): Promise<AdminFeatureFlagResponse> {
    return this.toResponse(
      await this.featureFlagsService.upsert({ key, enabled: body.enabled, description: body.description }),
    );
  }

  @Delete(':key')
  @RequirePermission(Permission.FeatureFlagsWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a feature flag',
    description: 'Routes gated on the key start failing closed again, as if the flag had never existed.',
  })
  async remove(@Param('key') key: string): Promise<void> {
    await this.featureFlagsService.remove({ key });
  }

  private toResponse(flag: FeatureFlag): AdminFeatureFlagResponse {
    return {
      key: flag.key,
      enabled: flag.enabled,
      description: flag.description,
      updated_at: flag.updatedAt.toISOString(),
    };
  }
}
