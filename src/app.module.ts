import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { FeatureFlagGuard } from '@infrastructure/feature-flags/guards/feature-flag.guard';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { AdminModule } from '@modules/admin/admin.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
import { PermissionGuard } from '@modules/auth/rbac/guards/permission.guard';
import { RbacModule } from '@modules/auth/rbac/rbac.module';
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
  imports: [InfrastructureModule, AuthModule, RbacModule, AdminModule],
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
    // * After AuthGuard: permission checks need request.user to be resolved first.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // * Last of the authorisation guards: a route hidden behind an off flag should look absent, which is only
    // * a meaningful answer once the caller has been authenticated and authorised.
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
    { provide: APP_GUARD, useClass: SubjectRateLimiterGuard },
  ],
})
export class AppModule {}
