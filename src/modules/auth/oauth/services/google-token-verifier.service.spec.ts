import { OAuth2Client } from 'google-auth-library';
import type { Mock } from 'vitest';

import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { GoogleTokenVerifier } from './google-token-verifier.service';

describe('GoogleTokenVerifier', () => {
  let verifier: GoogleTokenVerifier;
  let verifyIdToken: Mock;

  beforeEach(() => {
    verifier = new GoogleTokenVerifier();
    verifyIdToken = vi.fn();
    (verifier as unknown as { client: OAuth2Client }).client = { verifyIdToken } as unknown as OAuth2Client;
  });

  function ticketWith(payload: Record<string, unknown>): unknown {
    return { getPayload: () => payload };
  }

  it('extracts the identity from a valid token with a verified email', async () => {
    verifyIdToken.mockResolvedValue(
      ticketWith({ sub: 'google-1', email: 'a@example.com', email_verified: true, name: 'Alice', nonce: 'n1' }),
    );

    await expect(verifier.verify({ idToken: 'token' })).resolves.toEqual({
      providerUserId: 'google-1',
      email: 'a@example.com',
      name: 'Alice',
      nonce: 'n1',
    });
  });

  it('omits the email when it is not verified', async () => {
    verifyIdToken.mockResolvedValue(ticketWith({ sub: 'google-1', email: 'a@example.com', email_verified: false }));

    const identity = await verifier.verify({ idToken: 'token' });

    expect(identity.email).toBeUndefined();
  });

  it('rejects when verification throws', async () => {
    verifyIdToken.mockRejectedValue(new Error('invalid signature'));

    await expect(verifier.verify({ idToken: 'token' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects when the payload has no subject', async () => {
    verifyIdToken.mockResolvedValue(ticketWith({ email: 'a@example.com' }));

    await expect(verifier.verify({ idToken: 'token' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('accepts a token whose authorized party is a trusted client', async () => {
    verifyIdToken.mockResolvedValue(
      ticketWith({ sub: 'google-1', azp: 'test-client.apps.googleusercontent.com', nonce: 'n1' }),
    );

    await expect(verifier.verify({ idToken: 'token' })).resolves.toMatchObject({ providerUserId: 'google-1' });
  });

  it('rejects a token whose authorized party is outside the trusted client set', async () => {
    verifyIdToken.mockResolvedValue(ticketWith({ sub: 'google-1', azp: 'attacker-web-client', nonce: 'n1' }));

    await expect(verifier.verify({ idToken: 'token' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });
});
