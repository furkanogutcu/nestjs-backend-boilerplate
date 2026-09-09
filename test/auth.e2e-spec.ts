import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Controller, Get, INestApplication, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { Mock } from 'vitest';
import { z } from 'zod';

import { ClockService } from '@infrastructure/clock/clock.service';
import { IdempotencyService } from '@infrastructure/idempotency/idempotency.service';
import { AuthController } from '@modules/auth/auth.controller';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Session } from '@modules/auth/entities/session.entity';
import { User } from '@modules/auth/entities/user.entity';
import { OAuthProvider } from '@modules/auth/enums/oauth-provider.enum';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
import { OAuthController } from '@modules/auth/oauth/oauth.controller';
import { OAuthService } from '@modules/auth/oauth/services/oauth.service';
import { ProfileController } from '@modules/auth/profile/profile.controller';
import { ProfileService } from '@modules/auth/profile/profile.service';
import { SessionsRepository } from '@modules/auth/repositories/sessions.repository';
import { UsersRepository } from '@modules/auth/repositories/users.repository';
import { AuthService } from '@modules/auth/services/auth.service';
import { RevocationService } from '@modules/auth/services/revocation.service';
import { SessionService } from '@modules/auth/services/session.service';
import { TokenService } from '@modules/auth/services/token.service';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { CacheControlInterceptor } from '@shared/interceptors/cache-control.interceptor';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';
import { AppZodValidationPipe } from '@shared/pipes/app-zod-validation.pipe';
import { createMockDataSource } from '@test/helpers';

@Controller('protected')
class ProtectedController {
  @Get()
  @ResponseDto({ schema: z.object({ id: z.string() }) })
  me(@CurrentUser() user: { id: string }): { id: string } {
    return { id: user.id };
  }
}

const USER_ID = '00000000-0000-4000-8000-000000000000';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let oauthService: DeepMocked<OAuthService>;

  beforeAll(async () => {
    const usersRepository = createMock<UsersRepository>();
    usersRepository.create.mockReturnValue({ isAnonymous: true } as User);
    usersRepository.save.mockResolvedValue({ id: USER_ID, isAnonymous: true } as User);

    const sessionsRepository = createMock<SessionsRepository>();
    sessionsRepository.create.mockImplementation((session) => session as Session);
    sessionsRepository.save.mockImplementation(async (session) => await Promise.resolve(session as Session));

    const revocationService = createMock<RevocationService>();
    revocationService.isRevoked.mockResolvedValue(false);

    const idempotencyService = createMock<IdempotencyService>();
    (idempotencyService.execute as unknown as Mock).mockImplementation(
      async (options: { compute: () => Promise<unknown> }) => await options.compute(),
    );

    const profileService = createMock<ProfileService>();
    profileService.getUserView.mockResolvedValue({
      id: USER_ID,
      isAnonymous: true,
      displayName: null,
      linkedProviders: [],
    });

    oauthService = createMock<OAuthService>();
    oauthService.issueSignInNonce.mockResolvedValue({ nonce: 'signin-nonce', expiresInSeconds: 300 });
    oauthService.signInWithGoogle.mockResolvedValue({
      accessToken: 'signin-access-token',
      refreshToken: 'signin-refresh-token',
      expiresInSeconds: 900,
      user: {
        id: USER_ID,
        isAnonymous: false,
        displayName: 'Alice',
        linkedProviders: [{ provider: OAuthProvider.Google, email: 'a@example.com' }],
      },
    });
    oauthService.signInWithApple.mockResolvedValue({
      accessToken: 'signin-access-token',
      refreshToken: 'signin-refresh-token',
      expiresInSeconds: 900,
      user: {
        id: USER_ID,
        isAnonymous: false,
        displayName: 'Bob',
        linkedProviders: [{ provider: OAuthProvider.Apple, email: 'b@privaterelay.appleid.com' }],
      },
    });
    oauthService.signInWithGameCenter.mockResolvedValue({
      accessToken: 'signin-access-token',
      refreshToken: 'signin-refresh-token',
      expiresInSeconds: 900,
      user: {
        id: USER_ID,
        isAnonymous: false,
        displayName: null,
        linkedProviders: [{ provider: OAuthProvider.GameCenter, email: null }],
      },
    });
    oauthService.signInWithPlayGames.mockResolvedValue({
      accessToken: 'signin-access-token',
      refreshToken: 'signin-refresh-token',
      expiresInSeconds: 900,
      user: {
        id: USER_ID,
        isAnonymous: false,
        displayName: 'Carol',
        linkedProviders: [{ provider: OAuthProvider.PlayGames, email: null }],
      },
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, OAuthController, ProfileController, ProtectedController],
      providers: [
        AuthService,
        TokenService,
        SessionService,
        ClockService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: SessionsRepository, useValue: sessionsRepository },
        { provide: RevocationService, useValue: revocationService },
        { provide: IdempotencyService, useValue: idempotencyService },
        { provide: OAuthService, useValue: oauthService },
        { provide: ProfileService, useValue: profileService },
        { provide: getDataSourceToken(), useValue: createMockDataSource() },
        { provide: APP_PIPE, useClass: AppZodValidationPipe },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(contextBuilder);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'api/v' });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a guest user and issues an access token (public, non-cacheable)', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/guest').expect(201);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: USER_ID, is_anonymous: true },
    });
    expect(typeof response.body.data.access_token).toBe('string');
    expect(typeof response.body.data.refresh_token).toBe('string');
  });

  it('rejects an authenticated route without a token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/protected').expect(401);

    expect(response.body.error).toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a refresh request that carries no refresh token in the body or a cookie', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({}).expect(401);

    expect(response.body.error).toMatchObject({ code: 'invalid_refresh_token' });
  });

  it('rejects a guest request with a too-short Idempotency-Key', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/guest').set('Idempotency-Key', 'short').expect(400);
  });

  it('rejects logout without a token', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(401);
  });

  it('rejects nonce issuance without a token', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/link/nonce').expect(401);
  });

  it('rejects /auth/me without a token', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('returns the current user on /auth/me (authenticated, non-cacheable)', async () => {
    const guest = await request(app.getHttpServer()).post('/api/v1/auth/guest').expect(201);
    const token = guest.body.data.access_token as string;

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      id: USER_ID,
      is_anonymous: true,
      display_name: null,
      linked_providers: [],
    });
  });

  it('rejects google linking without a token', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/link/google').send({ id_token: 'x' }).expect(401);
  });

  it('rejects google linking with a token but a missing id_token', async () => {
    const guest = await request(app.getHttpServer()).post('/api/v1/auth/guest').expect(201);
    const token = guest.body.data.access_token as string;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/link/google')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('rejects apple linking without a token', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/link/apple').send({ id_token: 'x' }).expect(401);
  });

  it('rejects apple linking with a token but a missing refresh_token', async () => {
    const guest = await request(app.getHttpServer()).post('/api/v1/auth/guest').expect(201);
    const token = guest.body.data.access_token as string;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/link/apple')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_token: 'x' })
      .expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('issues a sign-in nonce without a token (public, non-cacheable)', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/signin/nonce').expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({ nonce: 'signin-nonce', expires_in: 300 });
  });

  it('signs in with a Google identity and returns a token pair and user (public, non-cacheable)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signin/google')
      .send({ id_token: 'google-id-token' })
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: USER_ID, is_anonymous: false },
    });
    expect(typeof response.body.data.access_token).toBe('string');
  });

  it('rejects a Google sign-in with a missing id_token', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/signin/google').send({}).expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('signs in with an Apple identity and returns a token pair and user (public, non-cacheable)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signin/apple')
      .send({ id_token: 'apple-id-token' })
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: USER_ID, is_anonymous: false },
    });
  });

  it('rejects Game Center linking without a token', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/link/game-center').send({ team_player_id: 'x' }).expect(401);
  });

  it('rejects Game Center linking with a token but missing signature fields', async () => {
    const guest = await request(app.getHttpServer()).post('/api/v1/auth/guest').expect(201);
    const token = guest.body.data.access_token as string;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/link/game-center')
      .set('Authorization', `Bearer ${token}`)
      .send({ team_player_id: 'x' })
      .expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('signs in with a Game Center identity and returns a token pair and user (public, non-cacheable)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signin/game-center')
      .send({
        team_player_id: 'G:1234567890',
        public_key_url: 'https://static.gc.apple.com/public-key/gc-prod.cer',
        signature: 'c2lnbmF0dXJl',
        salt: 'c2FsdA==',
        timestamp: 1717500000000,
      })
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: USER_ID, is_anonymous: false },
    });
  });

  it('rejects a Game Center sign-in with missing fields', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/signin/game-center').send({}).expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('rejects Play Games linking without a token', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/link/play-games').send({ server_auth_code: 'x' }).expect(401);
  });

  it('rejects Play Games linking with a token but a missing server_auth_code', async () => {
    const guest = await request(app.getHttpServer()).post('/api/v1/auth/guest').expect(201);
    const token = guest.body.data.access_token as string;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/link/play-games')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('signs in with a Play Games identity and returns a token pair and user (public, non-cacheable)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signin/play-games')
      .send({ server_auth_code: 'play-games-server-auth-code' })
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: USER_ID, is_anonymous: false },
    });
  });

  it('rejects a Play Games sign-in with a missing server_auth_code', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/signin/play-games').send({}).expect(400);

    expect(response.body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('returns 404 when signing in with a Google identity that has no account', async () => {
    oauthService.signInWithGoogle.mockRejectedValueOnce(
      new AppNotFoundException({ resourceName: 'Account', code: ExceptionCode.OauthAccountNotFound }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signin/google')
      .send({ id_token: 'unknown-identity' })
      .expect(404);

    expect(response.body.error).toMatchObject({ code: 'oauth_account_not_found' });
  });

  it('revokes the current session on logout (204)', async () => {
    const guest = await request(app.getHttpServer()).post('/api/v1/auth/guest').expect(201);
    const token = guest.body.data.access_token as string;

    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
  });
});
