import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { DataSource, IsNull } from 'typeorm';

import { SnakeNamingStrategy } from '@database/strategies/snake-naming.strategy';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { IdempotencyService } from '@infrastructure/idempotency/idempotency.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { generateUuid } from '@shared/utils/uuid.util';
import { SCHEMA_MIGRATIONS } from '@test/helpers';

import { OAuthAccount } from '../../entities/oauth-account.entity';
import { Session } from '../../entities/session.entity';
import { OAuthAccountSubscriber } from '../../entities/subscribers/oauth-account.subscriber';
import { User } from '../../entities/user.entity';
import { OAuthProvider } from '../../enums/oauth-provider.enum';
import { OAuthAccountsRepository } from '../../repositories/oauth-accounts.repository';
import { SessionsRepository } from '../../repositories/sessions.repository';
import { UsersRepository } from '../../repositories/users.repository';
import { AuthService } from '../../services/auth.service';
import { RevocationService } from '../../services/revocation.service';
import { SessionService } from '../../services/session.service';
import { TokenService } from '../../services/token.service';
import { AppleTokenVerifier } from './apple-token-verifier.service';
import { GameCenterVerifier } from './game-center-verifier.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { OAuthService } from './oauth.service';
import { PlayGamesVerifier } from './play-games-verifier.service';

describe('OAuthService (integration)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;
  let sessionService: SessionService;
  let googleVerifier: DeepMocked<GoogleTokenVerifier>;
  let appleVerifier: DeepMocked<AppleTokenVerifier>;
  let gameCenterVerifier: DeepMocked<GameCenterVerifier>;
  let playGamesVerifier: DeepMocked<PlayGamesVerifier>;
  let service: OAuthService;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    redisContainer = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(redisContainer.getConnectionUrl());

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      entities: [User, Session, OAuthAccount],
      migrations: SCHEMA_MIGRATIONS,
      subscribers: [OAuthAccountSubscriber],
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    googleVerifier = createMock<GoogleTokenVerifier>();
    appleVerifier = createMock<AppleTokenVerifier>();
    gameCenterVerifier = createMock<GameCenterVerifier>();
    playGamesVerifier = createMock<PlayGamesVerifier>();
    sessionService = new SessionService(
      new SessionsRepository(dataSource),
      dataSource,
      createMock<RevocationService>(),
      new ClockService(),
      createMock<AuditService>(),
    );
    const usersRepository = new UsersRepository(dataSource);
    const authService = new AuthService(
      sessionService,
      new TokenService(),
      createMock<IdempotencyService>(),
      usersRepository,
    );
    service = new OAuthService(
      redisService,
      sessionService,
      authService,
      usersRepository,
      new OAuthAccountsRepository(dataSource),
      googleVerifier,
      appleVerifier,
      gameCenterVerifier,
      playGamesVerifier,
    );
  });

  afterAll(async () => {
    redis.disconnect();
    await dataSource.destroy();
    await pgContainer.stop();
    await redisContainer.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
    await dataSource.query('TRUNCATE "oauth_accounts", "sessions", "users" CASCADE');
  });

  async function newUserWithRefresh(): Promise<{ userId: string; refreshToken: string }> {
    const user = await dataSource.getRepository(User).save({ id: generateUuid(), isAnonymous: true });
    const { refreshToken } = await sessionService.issue({ userId: user.id, linked: false });

    return { userId: user.id, refreshToken };
  }

  it('links a Google account, promotes the user, and consumes the nonce once', async () => {
    const { userId, refreshToken } = await newUserWithRefresh();
    const nonce = await service.issueNonce({ userId });
    googleVerifier.verify.mockResolvedValue({
      providerUserId: 'google-1',
      email: 'a@example.com',
      name: 'Alice',
      nonce,
    });

    const view = await service.linkGoogle({ idToken: 'id', refreshToken });

    expect(view.isAnonymous).toBe(false);
    expect(view.displayName).toBe('Alice');
    expect(view.linkedProviders).toEqual([{ provider: OAuthProvider.Google, email: 'a@example.com' }]);

    await expect(service.linkGoogle({ idToken: 'id', refreshToken })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('links an Apple account, storing the relay email and the client-supplied name', async () => {
    const { userId, refreshToken } = await newUserWithRefresh();
    const nonce = await service.issueNonce({ userId });
    appleVerifier.verify.mockResolvedValue({ providerUserId: 'apple-1', email: 'a@privaterelay.appleid.com', nonce });

    const view = await service.linkApple({ idToken: 'id', refreshToken, name: 'Bob' });

    expect(view.isAnonymous).toBe(false);
    expect(view.displayName).toBe('Bob');
    expect(view.linkedProviders).toEqual([{ provider: OAuthProvider.Apple, email: 'a@privaterelay.appleid.com' }]);

    // * Read the raw column (bypassing the entity transformer) to prove the email is encrypted at rest.
    const [stored] = await dataSource.query<{ email: string }[]>(
      'SELECT email FROM oauth_accounts WHERE provider_user_id = $1',
      ['apple-1'],
    );
    expect(stored.email).not.toBe('a@privaterelay.appleid.com');
    expect(stored.email.startsWith('v1:')).toBe(true);
  });

  it('rejects linking a Google account already owned by another user (409)', async () => {
    const first = await newUserWithRefresh();
    const firstNonce = await service.issueNonce({ userId: first.userId });
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: firstNonce });
    await service.linkGoogle({ idToken: 'id', refreshToken: first.refreshToken });

    const second = await newUserWithRefresh();
    const secondNonce = await service.issueNonce({ userId: second.userId });
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: secondNonce });

    await expect(service.linkGoogle({ idToken: 'id', refreshToken: second.refreshToken })).rejects.toBeInstanceOf(
      AppConflictException,
    );
  });

  async function linkGoogleAccount(providerUserId: string): Promise<string> {
    const { userId, refreshToken } = await newUserWithRefresh();
    const nonce = await service.issueNonce({ userId });
    googleVerifier.verify.mockResolvedValue({ providerUserId, nonce });
    await service.linkGoogle({ idToken: 'id', refreshToken });

    return userId;
  }

  it('signs in to an existing account and issues a distinct session per device (multi-device)', async () => {
    const userId = await linkGoogleAccount('google-1');

    const firstNonce = await service.issueSignInNonce();
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: firstNonce.nonce });
    const first = await service.signInWithGoogle({ idToken: 'id' });

    const secondNonce = await service.issueSignInNonce();
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: secondNonce.nonce });
    const second = await service.signInWithGoogle({ idToken: 'id' });

    expect(first.user.id).toBe(userId);
    expect(second.user.id).toBe(userId);
    expect(first.refreshToken).not.toBe(second.refreshToken);

    const active = await dataSource
      .getRepository(Session)
      .find({ where: { userId, revokedAt: IsNull() }, select: { familyId: true } });
    const distinctFamilies = new Set(active.map((session) => session.familyId));
    expect(distinctFamilies.size).toBeGreaterThanOrEqual(3);
  });

  it('rejects sign-in for an unknown provider identity (404) after consuming the nonce', async () => {
    const nonce = await service.issueSignInNonce();
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'unknown', nonce: nonce.nonce });

    await expect(service.signInWithGoogle({ idToken: 'id' })).rejects.toBeInstanceOf(AppNotFoundException);
  });

  it('signs in to an existing Apple account', async () => {
    const { userId, refreshToken } = await newUserWithRefresh();
    const linkNonce = await service.issueNonce({ userId });
    appleVerifier.verify.mockResolvedValue({
      providerUserId: 'apple-1',
      email: 'a@privaterelay.appleid.com',
      nonce: linkNonce,
    });
    await service.linkApple({ idToken: 'id', refreshToken, name: 'Bob' });

    const signinNonce = await service.issueSignInNonce();
    appleVerifier.verify.mockResolvedValue({ providerUserId: 'apple-1', nonce: signinNonce.nonce });
    const result = await service.signInWithApple({ idToken: 'id' });

    expect(result.user.id).toBe(userId);
    expect(result.user.linkedProviders).toEqual([
      { provider: OAuthProvider.Apple, email: 'a@privaterelay.appleid.com' },
    ]);
  });

  it('links a Game Center identity (no nonce) and signs back into it', async () => {
    const { userId, refreshToken } = await newUserWithRefresh();
    gameCenterVerifier.verify.mockResolvedValue({ providerUserId: 'G:gc-1' });

    const linked = await service.linkGameCenter({
      teamPlayerId: 'G:gc-1',
      publicKeyUrl: 'https://static.gc.apple.com/key.cer',
      signature: 'sig',
      salt: 'salt',
      timestamp: Date.now(),
      refreshToken,
    });

    expect(linked.isAnonymous).toBe(false);
    expect(linked.linkedProviders).toEqual([{ provider: OAuthProvider.GameCenter, email: null }]);

    const result = await service.signInWithGameCenter({
      teamPlayerId: 'G:gc-1',
      publicKeyUrl: 'https://static.gc.apple.com/key.cer',
      signature: 'sig-2',
      salt: 'salt',
      timestamp: Date.now(),
    });

    expect(result.user.id).toBe(userId);
    expect(result.refreshToken).not.toBe(refreshToken);
  });

  it('links a Play Games identity (no nonce), backfills the name, and signs back into it', async () => {
    const { userId, refreshToken } = await newUserWithRefresh();
    playGamesVerifier.verify.mockResolvedValue({ providerUserId: 'pgs-1', name: 'Carol' });

    const linked = await service.linkPlayGames({ serverAuthCode: 'code', refreshToken });

    expect(linked.isAnonymous).toBe(false);
    expect(linked.displayName).toBe('Carol');
    expect(linked.linkedProviders).toEqual([{ provider: OAuthProvider.PlayGames, email: null }]);

    const result = await service.signInWithPlayGames({ serverAuthCode: 'code-2' });

    expect(result.user.id).toBe(userId);
    expect(result.refreshToken).not.toBe(refreshToken);
  });

  it('rejects a replayed sign-in nonce (single-use)', async () => {
    await linkGoogleAccount('google-1');

    const nonce = await service.issueSignInNonce();
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: nonce.nonce });
    await service.signInWithGoogle({ idToken: 'id' });

    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: nonce.nonce });
    await expect(service.signInWithGoogle({ idToken: 'id' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });
});
