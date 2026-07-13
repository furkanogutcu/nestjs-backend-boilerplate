import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { IDEMPOTENCY_LOCK_TTL_SECONDS } from '@infrastructure/idempotency/idempotency.constant';
import { IdempotencyService } from '@infrastructure/idempotency/idempotency.service';
import { generateUuid } from '@shared/utils/uuid.util';

import { IDEMPOTENCY_REFRESH_TTL_SECONDS, REFRESH_TOKEN_SEPARATOR } from '../constants/auth.constant';
import { IGuestSession } from '../interfaces/guest-session.interface';
import { ITokenPair } from '../interfaces/token-pair.interface';
import { UsersRepository } from '../repositories/users.repository';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly idempotencyService: IdempotencyService,
    private readonly usersRepository: UsersRepository,
  ) {}

  async createGuest({ userAgent }: { userAgent?: string | null } = {}): Promise<IGuestSession> {
    const user = await this.usersRepository.save(
      this.usersRepository.create({ id: generateUuid(), isAnonymous: true }),
    );

    const tokens = await this.issueSessionForUser({ userId: user.id, userAgent, linked: false });

    return { user, ...tokens };
  }

  async refresh({
    refreshToken,
    idempotencyKey,
  }: {
    refreshToken: string;
    idempotencyKey?: string;
  }): Promise<ITokenPair> {
    if (!idempotencyKey) {
      return await this.rotate({ refreshToken });
    }

    const [sessionId] = refreshToken.split(REFRESH_TOKEN_SEPARATOR);

    return await this.idempotencyService.execute({
      scope: 'auth:refresh',
      principal: sessionId,
      key: idempotencyKey,
      fingerprint: createHash('sha256').update(refreshToken).digest('hex'),
      lockTtlSeconds: IDEMPOTENCY_LOCK_TTL_SECONDS,
      responseTtlSeconds: IDEMPOTENCY_REFRESH_TTL_SECONDS,
      compute: async () => await this.rotate({ refreshToken }),
    });
  }

  async logout({ sessionId }: { sessionId: string }): Promise<void> {
    await this.sessionService.revoke({ sessionId });
  }

  async issueSessionForUser({
    userId,
    userAgent,
    linked,
  }: {
    userId: string;
    userAgent?: string | null;
    linked: boolean;
  }): Promise<ITokenPair> {
    const { session, refreshToken } = await this.sessionService.issue({ userId, userAgent, linked });
    const { token, expiresInSeconds } = await this.tokenService.signAccessToken({
      userId,
      sessionId: session.id,
      familyId: session.familyId,
    });

    return { accessToken: token, refreshToken, expiresInSeconds };
  }

  private async rotate({ refreshToken }: { refreshToken: string }): Promise<ITokenPair> {
    const { session, refreshToken: rotatedRefreshToken } = await this.sessionService.rotate({ refreshToken });
    const { token, expiresInSeconds } = await this.tokenService.signAccessToken({
      userId: session.userId,
      sessionId: session.id,
      familyId: session.familyId,
    });

    return { accessToken: token, refreshToken: rotatedRefreshToken, expiresInSeconds };
  }
}
