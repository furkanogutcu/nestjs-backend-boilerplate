import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { randomBytes } from 'crypto';
import { QueryFailedError } from 'typeorm';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { CacheKey } from '@shared/utils/cache-key.util';
import { generateUuid } from '@shared/utils/uuid.util';

import { OAUTH_NONCE_BYTES, OAUTH_NONCE_TTL_SECONDS } from '../../constants/auth.constant';
import { OAuthProvider } from '../../enums/oauth-provider.enum';
import { IOAuthIdentity } from '../../interfaces/oauth-identity.interface';
import { ISignInResult } from '../../interfaces/sign-in-result.interface';
import { IUserView } from '../../interfaces/user-view.interface';
import { OAuthAccountsRepository } from '../../repositories/oauth-accounts.repository';
import { UsersRepository } from '../../repositories/users.repository';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { sanitizeDisplayName } from '../../utils/display-name.util';
import { AppleTokenVerifier } from './apple-token-verifier.service';
import { GameCenterVerifier } from './game-center-verifier.service';
import { GoogleTokenVerifier } from './google-token-verifier.service';
import { PlayGamesVerifier } from './play-games-verifier.service';

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly noncePrefix = appConfig.redis.keyPrefixes.oauthNonce;
  private readonly signinNoncePrefix = appConfig.redis.keyPrefixes.oauthSigninNonce;

  constructor(
    private readonly redisService: RedisService,
    private readonly sessionService: SessionService,
    private readonly authService: AuthService,
    private readonly usersRepository: UsersRepository,
    private readonly oauthAccountsRepository: OAuthAccountsRepository,
    private readonly googleVerifier: GoogleTokenVerifier,
    private readonly appleVerifier: AppleTokenVerifier,
    private readonly gameCenterVerifier: GameCenterVerifier,
    private readonly playGamesVerifier: PlayGamesVerifier,
  ) {}

  async issueNonce({ userId }: { userId: string }): Promise<string> {
    const nonce = randomBytes(OAUTH_NONCE_BYTES).toString('base64url');
    await this.redisService.getClient().set(this.nonceKey({ userId, nonce }), '1', 'EX', OAUTH_NONCE_TTL_SECONDS);

    return nonce;
  }

  async issueSignInNonce(): Promise<{ nonce: string; expiresInSeconds: number }> {
    const nonce = randomBytes(OAUTH_NONCE_BYTES).toString('base64url');
    await this.redisService.getClient().set(this.signinNonceKey(nonce), '1', 'EX', env.SIGNIN_NONCE_TTL_SECONDS);

    return { nonce, expiresInSeconds: env.SIGNIN_NONCE_TTL_SECONDS };
  }

  async linkGoogle({ idToken, refreshToken }: { idToken: string; refreshToken: string }): Promise<IUserView> {
    const { userId } = await this.sessionService.verifyForStepUp({ refreshToken });
    const identity = await this.googleVerifier.verify({ idToken });
    await this.consumeNonce({ userId, nonce: identity.nonce });

    return await this.link({ userId, provider: OAuthProvider.Google, identity });
  }

  async linkApple({
    idToken,
    refreshToken,
    name,
  }: {
    idToken: string;
    refreshToken: string;
    name?: string;
  }): Promise<IUserView> {
    const { userId } = await this.sessionService.verifyForStepUp({ refreshToken });
    const identity = await this.appleVerifier.verify({ idToken });
    await this.consumeNonce({ userId, nonce: identity.nonce });

    // * Apple never returns the name in the ID token; the client forwards it (untrusted) on first authorization.
    return await this.link({ userId, provider: OAuthProvider.Apple, identity: { ...identity, name } });
  }

  // * Game Center has no server-issued nonce: the signature's freshness window and replay guard stand in; the refresh token still proves step-up possession.
  async linkGameCenter({
    teamPlayerId,
    publicKeyUrl,
    signature,
    salt,
    timestamp,
    refreshToken,
  }: {
    teamPlayerId: string;
    publicKeyUrl: string;
    signature: string;
    salt: string;
    timestamp: number;
    refreshToken: string;
  }): Promise<IUserView> {
    const { userId } = await this.sessionService.verifyForStepUp({ refreshToken });
    const identity = await this.gameCenterVerifier.verify({ teamPlayerId, publicKeyUrl, signature, salt, timestamp });

    return await this.link({ userId, provider: OAuthProvider.GameCenter, identity });
  }

  async linkPlayGames({
    serverAuthCode,
    refreshToken,
  }: {
    serverAuthCode: string;
    refreshToken: string;
  }): Promise<IUserView> {
    const { userId } = await this.sessionService.verifyForStepUp({ refreshToken });
    const identity = await this.playGamesVerifier.verify({ serverAuthCode });

    return await this.link({ userId, provider: OAuthProvider.PlayGames, identity });
  }

  async signInWithGoogle({
    idToken,
    userAgent,
  }: {
    idToken: string;
    userAgent?: string | null;
  }): Promise<ISignInResult> {
    const identity = await this.googleVerifier.verify({ idToken });
    await this.consumeSignInNonce({ nonce: identity.nonce });

    return await this.signIn({ provider: OAuthProvider.Google, identity, userAgent });
  }

  async signInWithApple({
    idToken,
    userAgent,
  }: {
    idToken: string;
    userAgent?: string | null;
  }): Promise<ISignInResult> {
    const identity = await this.appleVerifier.verify({ idToken });
    await this.consumeSignInNonce({ nonce: identity.nonce });

    return await this.signIn({ provider: OAuthProvider.Apple, identity, userAgent });
  }

  async signInWithGameCenter({
    teamPlayerId,
    publicKeyUrl,
    signature,
    salt,
    timestamp,
    userAgent,
  }: {
    teamPlayerId: string;
    publicKeyUrl: string;
    signature: string;
    salt: string;
    timestamp: number;
    userAgent?: string | null;
  }): Promise<ISignInResult> {
    const identity = await this.gameCenterVerifier.verify({ teamPlayerId, publicKeyUrl, signature, salt, timestamp });

    return await this.signIn({ provider: OAuthProvider.GameCenter, identity, userAgent });
  }

  async signInWithPlayGames({
    serverAuthCode,
    userAgent,
  }: {
    serverAuthCode: string;
    userAgent?: string | null;
  }): Promise<ISignInResult> {
    const identity = await this.playGamesVerifier.verify({ serverAuthCode });

    return await this.signIn({ provider: OAuthProvider.PlayGames, identity, userAgent });
  }

  // * Pre-auth account takeover surface: verify token -> consume nonce -> ONLY THEN resolve the account.
  private async signIn({
    provider,
    identity,
    userAgent,
  }: {
    provider: OAuthProvider;
    identity: IOAuthIdentity;
    userAgent?: string | null;
  }): Promise<ISignInResult> {
    const account = await this.oauthAccountsRepository.findOne({
      where: { provider, providerUserId: identity.providerUserId },
    });

    if (!account) {
      this.logger.warn(`Sign-in attempt for an unlinked provider identity (provider=${provider})`);
      Sentry.captureMessage('signin_no_account', { level: 'warning', tags: { provider } });
      throw new AppNotFoundException({
        resourceName: 'Account',
        code: ExceptionCode.OauthAccountNotFound,
        message: 'No account is linked to this provider identity.',
      });
    }

    const tokens = await this.authService.issueSessionForUser({
      userId: account.userId,
      userAgent,
      linked: true,
    });
    const user = await this.buildUserView(account.userId);

    return { ...tokens, user };
  }

  private async consumeNonce({ userId, nonce }: { userId: string; nonce?: string }): Promise<void> {
    await this.deleteNonceOrThrow({
      key: nonce ? this.nonceKey({ userId, nonce }) : null,
      logMessage: `OAuth nonce missing or replayed (user_id=${userId})`,
      eventName: 'oauth_nonce_replay',
      tags: { user_id: userId },
    });
  }

  private async consumeSignInNonce({ nonce }: { nonce?: string }): Promise<void> {
    await this.deleteNonceOrThrow({
      key: nonce ? this.signinNonceKey(nonce) : null,
      logMessage: 'Sign-in nonce missing or replayed',
      eventName: 'signin_nonce_replay',
      tags: {},
    });
  }

  private async deleteNonceOrThrow({
    key,
    logMessage,
    eventName,
    tags,
  }: {
    key: string | null;
    logMessage: string;
    eventName: string;
    tags: Record<string, string>;
  }): Promise<void> {
    const removed = key ? await this.redisService.getClient().del(key) : 0;

    if (removed !== 1) {
      this.logger.warn(logMessage);
      Sentry.captureMessage(eventName, { level: 'warning', tags });
      throw new AppUnauthorizedException({
        code: ExceptionCode.InvalidOauthToken,
        message: 'Invalid or expired nonce.',
      });
    }
  }

  private async link({
    userId,
    provider,
    identity,
  }: {
    userId: string;
    provider: OAuthProvider;
    identity: IOAuthIdentity;
  }): Promise<IUserView> {
    const existing = await this.oauthAccountsRepository.findOne({
      where: { provider, providerUserId: identity.providerUserId },
    });

    if (existing) {
      if (existing.userId !== userId) {
        throw this.alreadyLinked();
      }

      return await this.buildUserView(userId);
    }

    try {
      await this.oauthAccountsRepository.save(
        this.oauthAccountsRepository.create({
          id: generateUuid(),
          userId,
          provider,
          providerUserId: identity.providerUserId,
          email: identity.email ?? null,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.alreadyLinked();
      }

      throw error;
    }

    await this.promoteUser({ userId, identity });

    return await this.buildUserView(userId);
  }

  private async promoteUser({ userId, identity }: { userId: string; identity: IOAuthIdentity }): Promise<void> {
    const user = await this.usersRepository.findOneByOrFail({ id: userId });
    user.isAnonymous = false;

    if (!user.displayName) {
      const displayName = sanitizeDisplayName(identity.name);

      if (displayName) {
        user.displayName = displayName;
      }
    }

    await this.usersRepository.save(user);
  }

  private async buildUserView(userId: string): Promise<IUserView> {
    const user = await this.usersRepository.findOneByOrFail({ id: userId });
    const accounts = await this.oauthAccountsRepository.find({ where: { userId } });

    return {
      id: user.id,
      isAnonymous: user.isAnonymous,
      displayName: user.displayName,
      linkedProviders: accounts.map((account) => ({ provider: account.provider, email: account.email })),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError && (error.driverError as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    );
  }

  private alreadyLinked(): AppConflictException {
    return new AppConflictException({
      conflictedFields: ['provider'],
      message: 'This account is already linked to another user.',
      code: ExceptionCode.OauthAccountAlreadyLinked,
    });
  }

  private nonceKey({ userId, nonce }: { userId: string; nonce: string }): string {
    return CacheKey.join(this.noncePrefix, userId, nonce);
  }

  private signinNonceKey(nonce: string): string {
    return CacheKey.join(this.signinNoncePrefix, nonce);
  }
}
