import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@shared/decorators/public.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { SubjectRateLimit } from '@shared/decorators/subject-rate-limit.decorator';
import { SubjectRateLimitPolicy } from '@shared/interfaces/rate-limit-rule.interface';

import { TOKEN_TYPE } from '../constants/auth.constant';
import { ClientHeaders } from '../decorators/client-headers.decorator';
import { RefreshCookie } from '../interceptors/refresh-cookie.interceptor';
import type { IClientHeaders } from '../interfaces/client-headers.interface';
import { ICredentialsResult } from './interfaces/credentials-result.interface';
import { PasswordService } from './password.service';
import { CredentialsResponse, credentialsResponseSchema } from './schemas/credentials.response';
import { ForgotPasswordRequest } from './schemas/forgot-password.request';
import { LoginRequest } from './schemas/login.request';
import { RegisterRequest } from './schemas/register.request';
import { ResendVerificationRequest } from './schemas/resend-verification.request';
import { ResetPasswordRequest } from './schemas/reset-password.request';
import { VerifyEmailRequest } from './schemas/verify-email.request';

@ApiTags('Auth')
@Controller('auth')
export class PasswordController {
  constructor(private readonly passwordService: PasswordService) {}

  @Post('register')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @ApiOperation({
    summary: 'Register',
    description:
      'Creates an account from an email and password and returns a token pair immediately (the user is signed in with an unverified email). A verification email is sent; the email stays unverified until its link is used.',
  })
  @ResponseDto({
    schema: credentialsResponseSchema,
    status: HttpStatus.CREATED,
    description: 'Account created; token pair and user summary returned.',
    errors: [HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT],
  })
  async register(@Body() body: RegisterRequest, @ClientHeaders() client: IClientHeaders): Promise<CredentialsResponse> {
    const result = await this.passwordService.register({
      email: body.email,
      password: body.password,
      userAgent: client.userAgent,
    });

    return this.toCredentialsResponse(result);
  }

  @Post('login')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login',
    description:
      'Exchanges an email and password for a token pair. Returns a generic 401 whether the email or the password was wrong.',
  })
  @ResponseDto({
    schema: credentialsResponseSchema,
    description: 'Authenticated; token pair and user summary returned.',
    errors: [HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED],
  })
  async login(@Body() body: LoginRequest, @ClientHeaders() client: IClientHeaders): Promise<CredentialsResponse> {
    const result = await this.passwordService.login({
      email: body.email,
      password: body.password,
      userAgent: client.userAgent,
    });

    return this.toCredentialsResponse(result);
  }

  @Post('verify-email')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Verify email',
    description:
      'Consumes a single-use verification token from the emailed link and marks the email verified. Returns 204.',
  })
  async verifyEmail(@Body() body: VerifyEmailRequest): Promise<void> {
    await this.passwordService.verifyEmail({ token: body.token });
  }

  @Post('resend-verification')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Resend verification',
    description:
      'Sends a fresh verification email if the address belongs to an unverified account. Always returns 204 (never reveals whether the email exists).',
  })
  async resendVerification(@Body() body: ResendVerificationRequest): Promise<void> {
    await this.passwordService.resendVerification({ email: body.email });
  }

  @Post('forgot-password')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Forgot password',
    description:
      'Sends a password-reset email if the address belongs to a password account. Always returns 204 (never reveals whether the email exists).',
  })
  async forgotPassword(@Body() body: ForgotPasswordRequest): Promise<void> {
    await this.passwordService.forgotPassword({ email: body.email });
  }

  @Post('reset-password')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reset password',
    description:
      'Consumes a single-use reset token, sets the new password, and revokes every existing session. Returns 204; the user then logs in with the new password.',
  })
  async resetPassword(@Body() body: ResetPasswordRequest): Promise<void> {
    await this.passwordService.resetPassword({ token: body.token, password: body.password });
  }

  private toCredentialsResponse(result: ICredentialsResult): CredentialsResponse {
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      token_type: TOKEN_TYPE,
      expires_in: result.expiresInSeconds,
      user: {
        id: result.user.id,
        email: result.user.email,
        is_email_verified: result.user.emailVerifiedAt !== null,
        is_anonymous: result.user.isAnonymous,
      },
    };
  }
}
