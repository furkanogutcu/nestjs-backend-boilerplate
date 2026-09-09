import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditAction, AuditSubjectType } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { SubjectRateLimit } from '@shared/decorators/subject-rate-limit.decorator';
import { SubjectRateLimitPolicy } from '@shared/interfaces/rate-limit-rule.interface';

import { CurrentUser } from '../decorators/current-user.decorator';
import { MfaCodeRequest } from './schemas/mfa-code.request';
import { MfaEnrolmentResponse, mfaEnrolmentResponseSchema } from './schemas/mfa-enrolment.response';
import { MfaRecoveryCodesResponse, mfaRecoveryCodesResponseSchema } from './schemas/mfa-recovery-codes.response';
import { MfaService } from './services/mfa.service';

@ApiTags('Auth')
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly auditService: AuditService,
  ) {}

  @Post('enrol')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @ApiOperation({
    summary: 'Begin MFA enrolment',
    description:
      'Generates a TOTP secret for the current user and returns it with an otpauth:// URI. Nothing is enforced until the code is confirmed.',
  })
  @ResponseDto({
    schema: mfaEnrolmentResponseSchema,
    description: 'Secret and provisioning URI, shown once.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.CONFLICT, HttpStatus.TOO_MANY_REQUESTS],
  })
  async enrol(@CurrentUser() user: { id: string }): Promise<MfaEnrolmentResponse> {
    const enrolment = await this.mfaService.beginEnrolment({ userId: user.id });

    return { secret: enrolment.secret, otpauth_uri: enrolment.otpauthUri };
  }

  @Post('confirm')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @ApiOperation({
    summary: 'Confirm MFA enrolment',
    description: 'Verifies the first TOTP code, enables MFA and returns the single-use recovery codes.',
  })
  @ResponseDto({
    schema: mfaRecoveryCodesResponseSchema,
    description: 'Recovery codes, returned only here.',
    errors: [
      HttpStatus.UNAUTHORIZED,
      HttpStatus.CONFLICT,
      HttpStatus.UNPROCESSABLE_ENTITY,
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  })
  async confirm(@CurrentUser() user: { id: string }, @Body() body: MfaCodeRequest): Promise<MfaRecoveryCodesResponse> {
    const { recoveryCodes } = await this.mfaService.confirmEnrolment({ userId: user.id, code: body.code });

    await this.auditService.record({
      action: AuditAction.AuthMfaEnabled,
      actorUserId: user.id,
      subjectType: AuditSubjectType.User,
      subjectId: user.id,
    });

    return { recovery_codes: recoveryCodes };
  }

  @Delete()
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @ApiOperation({
    summary: 'Disable MFA',
    description:
      'Turns MFA off. Requires a current code: a stolen session must not be able to strip the second factor.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@CurrentUser() user: { id: string }, @Body() body: MfaCodeRequest): Promise<void> {
    await this.mfaService.verify({ userId: user.id, code: body.code });
    await this.mfaService.disable({ userId: user.id });

    await this.auditService.record({
      action: AuditAction.AuthMfaDisabled,
      actorUserId: user.id,
      subjectType: AuditSubjectType.User,
      subjectId: user.id,
    });
  }
}
