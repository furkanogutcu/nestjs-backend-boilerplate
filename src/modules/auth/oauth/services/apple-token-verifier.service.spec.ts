import { jwtVerify } from 'jose';

import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { AppleTokenVerifier } from './apple-token-verifier.service';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
}));

const mockedJwtVerify = jest.mocked(jwtVerify);

function resolveWith(payload: Record<string, unknown>): void {
  mockedJwtVerify.mockResolvedValue({ payload } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
}

describe('AppleTokenVerifier', () => {
  let verifier: AppleTokenVerifier;

  beforeEach(() => {
    mockedJwtVerify.mockReset();
    verifier = new AppleTokenVerifier();
  });

  it('extracts the identity from a valid token with a verified email', async () => {
    resolveWith({ sub: 'apple-1', email: 'a@example.com', email_verified: true, nonce: 'n1' });

    await expect(verifier.verify({ idToken: 'token' })).resolves.toEqual({
      providerUserId: 'apple-1',
      email: 'a@example.com',
      nonce: 'n1',
    });
  });

  it('treats a string "true" email_verified as verified', async () => {
    resolveWith({ sub: 'apple-1', email: 'a@example.com', email_verified: 'true' });

    await expect(verifier.verify({ idToken: 'token' })).resolves.toMatchObject({ email: 'a@example.com' });
  });

  it('omits the email when email_verified is the string "false"', async () => {
    resolveWith({ sub: 'apple-1', email: 'a@example.com', email_verified: 'false' });

    const identity = await verifier.verify({ idToken: 'token' });

    expect(identity.email).toBeUndefined();
  });

  it('rejects when verification throws', async () => {
    mockedJwtVerify.mockRejectedValue(new Error('bad signature'));

    await expect(verifier.verify({ idToken: 'token' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects when the payload has no subject', async () => {
    resolveWith({ email: 'a@example.com' });

    await expect(verifier.verify({ idToken: 'token' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });
});
