import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RateLimiterRes } from 'rate-limiter-flexible';
import request from 'supertest';

import { ipRateLimitConfig } from '@config/rate-limit.config';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
import { RevocationService } from '@modules/auth/services/revocation.service';
import { TokenService } from '@modules/auth/services/token.service';
import { Public } from '@shared/decorators/public.decorator';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { IpRateLimiterGuard } from '@shared/guards/ip-rate-limit.guard';
import { RequireHttpsGuard } from '@shared/guards/require-https.guard';
import { SubjectRateLimiterGuard } from '@shared/guards/subject-rate-limit.guard';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';

@Controller('protected')
class ProtectedController {
  @Get()
  read(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller('open')
class OpenController {
  @Get()
  @Public()
  read(): { ok: boolean } {
    return { ok: true };
  }
}

// * Asserts guard ordering: an exhausted per-IP budget 429s before AuthGuard inspects the token (collaborators stubbed).
describe('Rate-limit guard ordering (e2e)', () => {
  let app: INestApplication;
  let rateLimitService: DeepMocked<RateLimitService>;
  let tokenService: DeepMocked<TokenService>;
  let revocationService: DeepMocked<RevocationService>;

  beforeAll(async () => {
    rateLimitService = createMock<RateLimitService>();
    tokenService = createMock<TokenService>();
    revocationService = createMock<RevocationService>();

    const moduleRef = await Test.createTestingModule({
      controllers: [ProtectedController, OpenController],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_GUARD, useClass: RequireHttpsGuard },
        { provide: APP_GUARD, useClass: IpRateLimiterGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: SubjectRateLimiterGuard },
        { provide: RateLimitService, useValue: rateLimitService },
        { provide: TokenService, useValue: tokenService },
        { provide: RevocationService, useValue: revocationService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(contextBuilder);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitService.consumeByKey.mockResolvedValue(createMock<RateLimiterRes>({ msBeforeNext: 1000 }));
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 1, msBeforeNext: 1000 }));
    revocationService.isRevoked.mockResolvedValue(false);
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      sid: 'session-1',
      fid: 'family-1',
      exp: 1767225600,
    });
  });

  it('consumes the per-IP budget before authentication, then rejects an invalid token with 401', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(new AppUnauthorizedException());

    await request(app.getHttpServer()).get('/protected').set('Authorization', 'Bearer invalid').expect(401);

    expect(rateLimitService.consumeByKey).toHaveBeenCalledWith(expect.objectContaining({ options: ipRateLimitConfig }));
    expect(tokenService.verifyAccessToken).toHaveBeenCalled();
  });

  it('blocks with 429 before AuthGuard runs when the per-IP budget is exhausted', async () => {
    rateLimitService.consumeByKey.mockRejectedValue(new RateLimiterRes(0, 4000, ipRateLimitConfig.points));
    tokenService.verifyAccessToken.mockRejectedValue(new AppUnauthorizedException());

    const response = await request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', 'Bearer invalid')
      .expect(429);

    expect(response.headers['retry-after']).toBe('4');
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('applies the per-IP floor to public routes as well', async () => {
    rateLimitService.consumeByKey.mockRejectedValue(new RateLimiterRes(0, 4000, ipRateLimitConfig.points));

    await request(app.getHttpServer()).get('/open').expect(429);

    expect(rateLimitService.consumeByKey).toHaveBeenCalledWith(expect.objectContaining({ options: ipRateLimitConfig }));
  });

  it('passes through every layer when the token is valid and both budgets remain', async () => {
    await request(app.getHttpServer()).get('/protected').set('Authorization', 'Bearer valid').expect(200);

    expect(rateLimitService.consumeByKey).toHaveBeenCalled();
    expect(tokenService.verifyAccessToken).toHaveBeenCalled();
    expect(rateLimitService.consume).toHaveBeenCalled();
  });

  it('still enforces the subject limiter after authentication succeeds', async () => {
    rateLimitService.consume.mockRejectedValue(new RateLimiterRes(0, 2000, 5));

    await request(app.getHttpServer()).get('/protected').set('Authorization', 'Bearer valid').expect(429);

    expect(tokenService.verifyAccessToken).toHaveBeenCalled();
    expect(rateLimitService.consume).toHaveBeenCalled();
  });
});
