import { Injectable } from '@nestjs/common';
import { JWTPayload, jwtVerify, SignJWT } from 'jose';

import { env } from '@config/env.config';
import { AppInternalException } from '@shared/exceptions/internal.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { IAccessTokenClaims } from '../interfaces/access-token-claims.interface';

@Injectable()
export class TokenService {
  private readonly algorithm = 'HS256' as const;
  private readonly keys = new Map(
    Object.entries(env.JWT_ACCESS_KEYS).map(([kid, secret]) => [kid, new TextEncoder().encode(secret)]),
  );
  private readonly activeKid = env.JWT_ACCESS_ACTIVE_KID;
  private readonly activeKey = this.resolveActiveKey();

  async signAccessToken({
    userId,
    sessionId,
    familyId,
  }: {
    userId: string;
    sessionId: string;
    familyId: string;
  }): Promise<{ token: string; expiresInSeconds: number }> {
    const expiresInSeconds = env.JWT_ACCESS_TTL_SECONDS;

    const token = await new SignJWT({ sid: sessionId, fid: familyId })
      .setProtectedHeader({ alg: this.algorithm, kid: this.activeKid })
      .setSubject(userId)
      .setIssuedAt()
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(this.activeKey);

    return { token, expiresInSeconds };
  }

  async verifyAccessToken({ token }: { token: string }): Promise<IAccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, (header) => this.resolveVerifyKey(header), {
        algorithms: [this.algorithm],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      });

      return this.toClaims(payload);
    } catch (error) {
      if (error instanceof AppUnauthorizedException) {
        throw error;
      }

      throw new AppUnauthorizedException();
    }
  }

  private resolveActiveKey(): Uint8Array {
    const activeKey = this.keys.get(this.activeKid);

    if (!activeKey) {
      throw new AppInternalException({ message: 'Active JWT signing key id is not present in the key set' });
    }

    return activeKey;
  }

  private resolveVerifyKey(header: { kid?: string }): Uint8Array {
    const key = header.kid ? this.keys.get(header.kid) : undefined;

    if (!key) {
      throw new AppUnauthorizedException();
    }

    return key;
  }

  private toClaims(payload: JWTPayload): IAccessTokenClaims {
    const { sub, sid, fid, exp } = payload;

    // * A token without an expiry is never issued here; accepting one would create an unbounded credential.
    if (!sub || typeof sid !== 'string' || typeof fid !== 'string' || typeof exp !== 'number') {
      throw new AppUnauthorizedException();
    }

    return { sub, sid, fid, exp };
  }
}
