import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Controller, Get, INestApplication, Logger, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthCheckResult, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import { z } from 'zod';

import { parseKeyring } from '@config/keyring.util';
import { ClockService } from '@infrastructure/clock/clock.service';
import { HealthController } from '@infrastructure/health/health.controller';
import { RedisHealthIndicator } from '@infrastructure/health/redis.health-indicator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
import { RevocationService } from '@modules/auth/services/revocation.service';
import { TokenService } from '@modules/auth/services/token.service';
import { Public } from '@shared/decorators/public.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';

@Controller('protected')
class ProtectedController {
  @Get()
  @ResponseDto({ schema: z.object({ id: z.string() }) })
  me(@CurrentUser() user: { id: string }): { id: string } {
    return { id: user.id };
  }
}

@Controller('mixed')
class MixedController {
  @Get('open')
  @Public()
  @ResponseDto({ schema: z.object({ ok: z.boolean() }) })
  open(): { ok: boolean } {
    return { ok: true };
  }

  @Get('closed')
  @ResponseDto({ schema: z.object({ id: z.string() }) })
  closed(@CurrentUser() user: { id: string }): { id: string } {
    return { id: user.id };
  }
}

const USER_ID = '00000000-0000-4000-8000-000000000000';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = '22222222-2222-4222-8222-222222222222';

const { keys: JWT_KEYS } = parseKeyring({ raw: process.env.JWT_ACCESS_KEYS ?? '', validateValue: () => null });
const ACTIVE_KID = process.env.JWT_ACCESS_ACTIVE_KID ?? '';
const RETIRED_KID = Object.keys(JWT_KEYS).find((kid) => kid !== ACTIVE_KID) ?? '';
const JWT_SECRET = new TextEncoder().encode(JWT_KEYS[ACTIVE_KID]);
const RETIRED_SECRET = new TextEncoder().encode(JWT_KEYS[RETIRED_KID]);
const JWT_ISSUER = process.env.JWT_ISSUER ?? 'app';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'app';

async function forgeToken(
  options: {
    claims?: Record<string, unknown>;
    subject?: string;
    issuer?: string;
    audience?: string;
    expirationTime?: string | number;
    secret?: Uint8Array;
    kid?: string;
  } = {},
): Promise<string> {
  const {
    claims = { sid: SESSION_ID, fid: FAMILY_ID },
    subject = USER_ID,
    issuer = JWT_ISSUER,
    audience = JWT_AUDIENCE,
    expirationTime = '900s',
    secret = JWT_SECRET,
    kid = ACTIVE_KID,
  } = options;

  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', kid })
    .setSubject(subject)
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expirationTime)
    .sign(secret);
}

describe('Auth protection (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let revocationService: DeepMocked<RevocationService>;

  async function validToken(): Promise<string> {
    const { token } = await tokenService.signAccessToken({
      userId: USER_ID,
      sessionId: SESSION_ID,
      familyId: FAMILY_ID,
    });

    return token;
  }

  beforeAll(async () => {
    revocationService = createMock<RevocationService>();
    revocationService.isRevoked.mockResolvedValue(false);

    const healthCheckService = createMock<HealthCheckService>();
    healthCheckService.check.mockResolvedValue({} as HealthCheckResult);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController, ProtectedController, MixedController],
      providers: [
        TokenService,
        ClockService,
        { provide: RevocationService, useValue: revocationService },
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: createMock<TypeOrmHealthIndicator>() },
        { provide: RedisHealthIndicator, useValue: createMock<RedisHealthIndicator>() },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    tokenService = moduleRef.get(TokenService);

    app = moduleRef.createNestApplication();
    app.use(contextBuilder);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'api/v' });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('public routes are reachable without a token', () => {
    it('serves the liveness probe', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    it('serves the readiness probe', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    it('serves a handler-level @Public route on an otherwise-protected controller', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/mixed/open').expect(200);

      expect(response.body).toEqual({ data: { ok: true } });
    });
  });

  describe('protected routes accept a valid bearer token', () => {
    it('attaches the user from the token and returns it', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${await validToken()}`)
        .expect(200);

      expect(response.body).toEqual({ data: { id: USER_ID } });
    });

    it('guards the protected sibling of a public route on the same controller', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/mixed/closed')
        .set('Authorization', `Bearer ${await validToken()}`)
        .expect(200);

      expect(response.body).toEqual({ data: { id: USER_ID } });
    });
  });

  describe('protected routes reject missing or malformed credentials', () => {
    it('rejects a request with no Authorization header', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/protected').expect(401);

      expect(response.body.error).toMatchObject({ code: 'unauthorized' });
    });

    it('rejects a non-Bearer Authorization scheme', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/protected')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);
    });

    it('rejects a Bearer scheme with an empty token', async () => {
      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', 'Bearer ').expect(401);
    });

    it('rejects a garbage (non-JWT) bearer token', async () => {
      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('protects the handler-level public controller sibling without a token', async () => {
      await request(app.getHttpServer()).get('/api/v1/mixed/closed').expect(401);
    });
  });

  describe('protected routes reject forged or expired tokens', () => {
    it('rejects a token signed with the wrong secret', async () => {
      const token = await forgeToken({ secret: new TextEncoder().encode('a-totally-different-secret-0123456789ab') });

      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('rejects an expired token', async () => {
      const token = await forgeToken({ expirationTime: Math.floor(Date.now() / 1000) - 60 });

      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('rejects a token missing the required session/family claims', async () => {
      const token = await forgeToken({ claims: {} });

      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('rejects a token minted by an untrusted issuer', async () => {
      const token = await forgeToken({ issuer: 'https://evil.example.com' });

      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('rejects a token whose kid is not in the keyring', async () => {
      const token = await forgeToken({ kid: 'retired-2020' });

      await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${token}`).expect(401);
    });
  });

  describe('protected routes accept tokens from a non-active key during rotation', () => {
    it('accepts a token signed with a known non-active kid', async () => {
      const token = await forgeToken({ secret: RETIRED_SECRET, kid: RETIRED_KID });

      const response = await request(app.getHttpServer())
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({ data: { id: USER_ID } });
    });
  });

  describe('protected routes honour the revocation denylist', () => {
    it('rejects an otherwise-valid token whose session has been revoked', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      revocationService.isRevoked.mockResolvedValueOnce(true);

      const response = await request(app.getHttpServer())
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${await validToken()}`)
        .expect(401);

      expect(response.body.error).toMatchObject({ code: 'unauthorized' });
      expect(revocationService.isRevoked).toHaveBeenCalledWith({ sessionId: SESSION_ID, familyId: FAMILY_ID });
    });
  });
});
