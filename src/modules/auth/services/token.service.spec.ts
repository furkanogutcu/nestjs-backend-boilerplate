import { decodeProtectedHeader, SignJWT } from 'jose';

import { parseKeyring } from '@config/keyring.util';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { TokenService } from './token.service';

const { keys } = parseKeyring({ raw: process.env.JWT_ACCESS_KEYS ?? '', validateValue: () => null });
const ACTIVE_KID = process.env.JWT_ACCESS_ACTIVE_KID ?? '';
const RETIRED_KID = Object.keys(keys).find((kid) => kid !== ACTIVE_KID) ?? '';
const activeSecret = new TextEncoder().encode(keys[ACTIVE_KID]);
const retiredSecret = new TextEncoder().encode(keys[RETIRED_KID]);

async function forge(options: {
  secret: Uint8Array;
  kid?: string;
  algorithm?: string;
  issuer?: string;
  audience?: string;
  payload?: Record<string, unknown>;
  withExpiry?: boolean;
}): Promise<string> {
  const {
    secret,
    kid,
    algorithm = 'HS256',
    issuer = 'app',
    audience = 'app',
    payload = { sid: 'session-1', fid: 'family-1' },
    withExpiry = true,
  } = options;

  const jwt = new SignJWT(payload)
    .setProtectedHeader(kid ? { alg: algorithm, kid } : { alg: algorithm })
    .setSubject('user-1')
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience);

  if (withExpiry) {
    jwt.setExpirationTime('15m');
  }

  return await jwt.sign(secret);
}

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    service = new TokenService();
  });

  it('signs and verifies an access token round-trip', async () => {
    const { token, expiresInSeconds } = await service.signAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
    });

    expect(typeof token).toBe('string');
    expect(expiresInSeconds).toBe(900);

    const claims = await service.verifyAccessToken({ token });

    expect(claims).toEqual({ sub: 'user-1', sid: 'session-1', fid: 'family-1', exp: expect.any(Number) });
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
  });

  it('stamps the active key id in the token header', async () => {
    const { token } = await service.signAccessToken({
      userId: 'user-1',
      sessionId: 'session-1',
      familyId: 'family-1',
    });

    expect(decodeProtectedHeader(token).kid).toBe(ACTIVE_KID);
  });

  it('verifies a token signed with a non-active but known key (rotation overlap)', async () => {
    const token = await forge({ secret: retiredSecret, kid: RETIRED_KID });

    const claims = await service.verifyAccessToken({ token });

    expect(claims).toEqual({ sub: 'user-1', sid: 'session-1', fid: 'family-1', exp: expect.any(Number) });
  });

  it('rejects a token whose kid is active but signed with the wrong secret', async () => {
    const token = await forge({
      secret: new TextEncoder().encode('a-totally-different-secret-0123456789ab'),
      kid: ACTIVE_KID,
    });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a token whose kid is not in the keyring (retired/unknown key)', async () => {
    const token = await forge({ secret: activeSecret, kid: 'retired-2020' });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a token with no kid header', async () => {
    const token = await forge({ secret: activeSecret });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a token signed with a non-HS256 algorithm (algorithm pinning)', async () => {
    const token = await forge({ secret: activeSecret, kid: ACTIVE_KID, algorithm: 'HS512' });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a token with the wrong issuer or audience', async () => {
    const token = await forge({ secret: activeSecret, kid: ACTIVE_KID, issuer: 'attacker', audience: 'attacker' });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a malformed token', async () => {
    await expect(service.verifyAccessToken({ token: 'not-a-jwt' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a validly signed token whose claims are missing the family id', async () => {
    const token = await forge({ secret: activeSecret, kid: ACTIVE_KID, payload: { sid: 'session-1' } });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a validly signed token whose session id claim is not a string', async () => {
    const token = await forge({ secret: activeSecret, kid: ACTIVE_KID, payload: { sid: 123, fid: 'family-1' } });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a validly signed token that carries no expiry (unbounded credential)', async () => {
    const token = await forge({ secret: activeSecret, kid: ACTIVE_KID, withExpiry: false });

    await expect(service.verifyAccessToken({ token })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });
});
