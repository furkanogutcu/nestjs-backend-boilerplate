import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { AccessTokenVerifierModule } from '@modules/auth/access-token-verifier.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { IpRateLimiterGuard } from '@shared/guards/ip-rate-limit.guard';
import { RequireHttpsGuard } from '@shared/guards/require-https.guard';
import { SubjectRateLimiterGuard } from '@shared/guards/subject-rate-limit.guard';
import { CacheControlInterceptor } from '@shared/interceptors/cache-control.interceptor';
import { IdempotencyInterceptor } from '@shared/interceptors/idempotency.interceptor';
import { MetricsInterceptor } from '@shared/interceptors/metrics.interceptor';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { AppZodValidationPipe } from '@shared/pipes/app-zod-validation.pipe';

@Module({
  imports: [InfrastructureModule, AuthModule, AccessTokenVerifierModule],
  providers: [
    { provide: APP_PIPE, useClass: AppZodValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: RequireHttpsGuard },
    { provide: APP_GUARD, useClass: IpRateLimiterGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: SubjectRateLimiterGuard },
  ],
})
export class AppModule {}
