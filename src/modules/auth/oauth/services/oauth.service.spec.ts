import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Redis } from 'ioredis';
import { QueryFailedError } from 'typeorm';

import { RedisService } from '@infrastructure/redis/redis.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { OAuthAccount } from '../../entities/oauth-account.entity';
import { User } from '../../entities/user.entity';
import { OAuthProvider } from '../../enums/oauth-provider.enum';
import { OAuthAccountsRepository } from '../../repositories/oauth-accounts.repository';
import { UsersRepository } from '../../repositories/users.repository';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { AppleTokenVerifier } from './apple-token-verifier.service';
import { GameCenterVerifier } from './game-center-verifier.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { OAuthService } from './oauth.service';
import { PlayGamesVerifier } from './play-games-verifier.service';

describe('OAuthService', () => {
  let redis: DeepMocked<Redis>;
  let sessionService: DeepMocked<SessionService>;
  let authService: DeepMocked<AuthService>;
  let usersRepository: DeepMocked<UsersRepository>;
  let oauthAccountsRepository: DeepMocked<OAuthAccountsRepository>;
  let googleVerifier: DeepMocked<GoogleTokenVerifier>;
  let appleVerifier: DeepMocked<AppleTokenVerifier>;
  let gameCenterVerifier: DeepMocked<GameCenterVerifier>;
  let playGamesVerifier: DeepMocked<PlayGamesVerifier>;
  let service: OAuthService;

  const user = { id: 'user-1', isAnonymous: true, displayName: null } as User;

  beforeEach(() => {
    redis = createMock<Redis>();
    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    sessionService = createMock<SessionService>();
    authService = createMock<AuthService>();
    usersRepository = createMock<UsersRepository>();
    oauthAccountsRepository = createMock<OAuthAccountsRepository>();
    googleVerifier = createMock<GoogleTokenVerifier>();
    appleVerifier = createMock<AppleTokenVerifier>();
    gameCenterVerifier = createMock<GameCenterVerifier>();
    playGamesVerifier = createMock<PlayGamesVerifier>();

    sessionService.verifyForStepUp.mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' });
    authService.issueSessionForUser.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresInSeconds: 900,
    });
    googleVerifier.verify.mockResolvedValue({
      providerUserId: 'google-1',
      email: 'a@example.com',
      name: 'Alice',
      nonce: 'n1',
    });
    redis.del.mockResolvedValue(1);
    usersRepository.findOneByOrFail.mockResolvedValue({ ...user });
    usersRepository.save.mockImplementation(async (p) => await Promise.resolve(p as User));
    oauthAccountsRepository.create.mockImplementation((account) => account as OAuthAccount);
    oauthAccountsRepository.save.mockImplementation(async (account) => await Promise.resolve(account as OAuthAccount));

    service = new OAuthService(
      redisService,
      sessionService,
      authService,
      usersRepository,
      oauthAccountsRepository,
      googleVerifier,
      appleVerifier,
      gameCenterVerifier,
      playGamesVerifier,
    );
  });

  it('issues a nonce stored with a TTL', async () => {
    const nonce = await service.issueNonce({ userId: 'user-1' });

    expect(typeof nonce).toBe('string');
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('user-1'), '1', 'EX', 120);
  });

  it('links a new Google account and promotes the user', async () => {
    oauthAccountsRepository.findOne.mockResolvedValue(null);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.Google, email: 'a@example.com' } as OAuthAccount,
    ]);

    const view = await service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' });

    expect(redis.del).toHaveBeenCalled();
    expect(oauthAccountsRepository.save).toHaveBeenCalled();
    expect(usersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ isAnonymous: false, displayName: 'Alice' }),
    );
    expect(view.linkedProviders).toEqual([{ provider: OAuthProvider.Google, email: 'a@example.com' }]);
  });

  it('links a new Apple account, backfilling the display name from the client-supplied name', async () => {
    appleVerifier.verify.mockResolvedValue({
      providerUserId: 'apple-1',
      email: 'a@privaterelay.appleid.com',
      nonce: 'n1',
    });
    oauthAccountsRepository.findOne.mockResolvedValue(null);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.Apple, email: 'a@privaterelay.appleid.com' } as OAuthAccount,
    ]);

    await service.linkApple({ idToken: 'id', refreshToken: 'session-1.secret', name: 'Bob' });

    expect(redis.del).toHaveBeenCalled();
    expect(usersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ isAnonymous: false, displayName: 'Bob' }),
    );
  });

  it('links a new Game Center identity without consuming a nonce', async () => {
    gameCenterVerifier.verify.mockResolvedValue({ providerUserId: 'gc-1' });
    oauthAccountsRepository.findOne.mockResolvedValue(null);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.GameCenter, email: null } as OAuthAccount,
    ]);

    const view = await service.linkGameCenter({
      teamPlayerId: 'gc-1',
      publicKeyUrl: 'https://static.gc.apple.com/key.cer',
      signature: 'sig',
      salt: 'salt',
      timestamp: 1,
      refreshToken: 'session-1.secret',
    });

    expect(sessionService.verifyForStepUp).toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(oauthAccountsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ provider: OAuthProvider.GameCenter, providerUserId: 'gc-1' }),
    );
    expect(view.linkedProviders).toEqual([{ provider: OAuthProvider.GameCenter, email: null }]);
  });

  it('links a new Play Games identity, backfilling the display name from the resolved profile', async () => {
    playGamesVerifier.verify.mockResolvedValue({ providerUserId: 'pgs-1', name: 'Carol' });
    oauthAccountsRepository.findOne.mockResolvedValue(null);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.PlayGames, email: null } as OAuthAccount,
    ]);

    const view = await service.linkPlayGames({ serverAuthCode: 'code', refreshToken: 'session-1.secret' });

    expect(sessionService.verifyForStepUp).toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(usersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ isAnonymous: false, displayName: 'Carol' }),
    );
    expect(view.linkedProviders).toEqual([{ provider: OAuthProvider.PlayGames, email: null }]);
  });

  it('is idempotent when the same user re-links the same account', async () => {
    oauthAccountsRepository.findOne.mockResolvedValue({
      userId: 'user-1',
      provider: OAuthProvider.Google,
    } as OAuthAccount);
    oauthAccountsRepository.find.mockResolvedValue([]);

    await service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' });

    expect(oauthAccountsRepository.save).not.toHaveBeenCalled();
  });

  it('rejects linking an account already linked to another user', async () => {
    oauthAccountsRepository.findOne.mockResolvedValue({
      userId: 'other-user',
      provider: OAuthProvider.Google,
    } as OAuthAccount);

    await expect(service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' })).rejects.toBeInstanceOf(
      AppConflictException,
    );
  });

  it('treats a unique-violation on save as an already-linked conflict (concurrent link race)', async () => {
    oauthAccountsRepository.findOne.mockResolvedValue(null);
    const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
    oauthAccountsRepository.save.mockRejectedValue(new QueryFailedError('INSERT', undefined, driverError));

    await expect(service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' })).rejects.toBeInstanceOf(
      AppConflictException,
    );
  });

  it('propagates a non-unique database error on save instead of masking it as a conflict', async () => {
    oauthAccountsRepository.findOne.mockResolvedValue(null);
    const dbError = new Error('connection reset');
    oauthAccountsRepository.save.mockRejectedValue(dbError);

    await expect(service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' })).rejects.toBe(dbError);
  });

  it('keeps an existing display name when linking another provider', async () => {
    oauthAccountsRepository.findOne.mockResolvedValue(null);
    oauthAccountsRepository.find.mockResolvedValue([]);
    usersRepository.findOneByOrFail.mockResolvedValue({ ...user, displayName: 'ExistingName' });

    await service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' });

    expect(usersRepository.save).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'ExistingName' }));
  });

  it('rejects when the nonce is missing or already consumed and reports a security event', async () => {
    redis.del.mockResolvedValue(0);

    await expect(service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' })).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    expect(oauthAccountsRepository.save).not.toHaveBeenCalled();
  });

  it('rejects linking when the verified identity carries no nonce, without touching the denylist', async () => {
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1' });

    await expect(service.linkGoogle({ idToken: 'id', refreshToken: 'session-1.secret' })).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    expect(redis.del).not.toHaveBeenCalled();
    expect(oauthAccountsRepository.save).not.toHaveBeenCalled();
  });

  it('propagates step-up failures from the refresh token', async () => {
    sessionService.verifyForStepUp.mockRejectedValue(new AppUnauthorizedException());

    await expect(service.linkGoogle({ idToken: 'id', refreshToken: 'bad' })).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    expect(googleVerifier.verify).not.toHaveBeenCalled();
  });

  it('issues a sign-in nonce stored with a TTL and reports its expiry', async () => {
    const result = await service.issueSignInNonce();

    expect(typeof result.nonce).toBe('string');
    expect(result.expiresInSeconds).toBeGreaterThan(0);
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('signin'), '1', 'EX', result.expiresInSeconds);
  });

  it('signs in to the existing account linked to the provider and issues a session', async () => {
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: 'n1' });
    oauthAccountsRepository.findOne.mockResolvedValue({
      userId: 'user-1',
      provider: OAuthProvider.Google,
    } as OAuthAccount);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.Google, email: 'a@example.com' } as OAuthAccount,
    ]);

    const result = await service.signInWithGoogle({ idToken: 'id' });

    expect(authService.issueSessionForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      userAgent: undefined,
      linked: true,
    });
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.user.id).toBe('user-1');
  });

  it('signs in to the existing account linked to a Game Center identity and issues a session', async () => {
    gameCenterVerifier.verify.mockResolvedValue({ providerUserId: 'gc-1' });
    oauthAccountsRepository.findOne.mockResolvedValue({
      userId: 'user-1',
      provider: OAuthProvider.GameCenter,
    } as OAuthAccount);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.GameCenter, email: null } as OAuthAccount,
    ]);

    const result = await service.signInWithGameCenter({
      teamPlayerId: 'gc-1',
      publicKeyUrl: 'https://static.gc.apple.com/key.cer',
      signature: 'sig',
      salt: 'salt',
      timestamp: 1,
      userAgent: 'ua',
    });

    expect(authService.issueSessionForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      userAgent: 'ua',
      linked: true,
    });
    expect(result.user.id).toBe('user-1');
  });

  it('signs in to the existing account linked to a Play Games identity and issues a session', async () => {
    playGamesVerifier.verify.mockResolvedValue({ providerUserId: 'pgs-1', name: 'Carol' });
    oauthAccountsRepository.findOne.mockResolvedValue({
      userId: 'user-1',
      provider: OAuthProvider.PlayGames,
    } as OAuthAccount);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.PlayGames, email: null } as OAuthAccount,
    ]);

    const result = await service.signInWithPlayGames({ serverAuthCode: 'code', userAgent: 'ua' });

    expect(authService.issueSessionForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      userAgent: 'ua',
      linked: true,
    });
    expect(result.user.id).toBe('user-1');
  });

  it('rejects sign-in when the nonce is missing/replayed and never resolves the account [verify->consume->resolve]', async () => {
    redis.del.mockResolvedValue(0);
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1', nonce: 'n1' });

    await expect(service.signInWithGoogle({ idToken: 'id' })).rejects.toBeInstanceOf(AppUnauthorizedException);
    expect(oauthAccountsRepository.findOne).not.toHaveBeenCalled();
    expect(authService.issueSessionForUser).not.toHaveBeenCalled();
  });

  it('rejects sign-in when the verified identity carries no nonce, before resolving the account', async () => {
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'google-1' });

    await expect(service.signInWithGoogle({ idToken: 'id' })).rejects.toBeInstanceOf(AppUnauthorizedException);
    expect(redis.del).not.toHaveBeenCalled();
    expect(oauthAccountsRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects sign-in for an unlinked provider identity with 404 (no session issued)', async () => {
    googleVerifier.verify.mockResolvedValue({ providerUserId: 'unknown', nonce: 'n1' });
    oauthAccountsRepository.findOne.mockResolvedValue(null);

    await expect(service.signInWithGoogle({ idToken: 'id' })).rejects.toBeInstanceOf(AppNotFoundException);
    expect(authService.issueSessionForUser).not.toHaveBeenCalled();
  });

  it('signs in to the existing account linked to an Apple identity', async () => {
    appleVerifier.verify.mockResolvedValue({ providerUserId: 'apple-1', nonce: 'n1' });
    oauthAccountsRepository.findOne.mockResolvedValue({
      userId: 'user-1',
      provider: OAuthProvider.Apple,
    } as OAuthAccount);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.Apple, email: 'a@privaterelay.appleid.com' } as OAuthAccount,
    ]);

    const result = await service.signInWithApple({ idToken: 'id' });

    expect(authService.issueSessionForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      userAgent: undefined,
      linked: true,
    });
    expect(result.user.id).toBe('user-1');
  });
});
