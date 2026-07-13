import { once } from 'node:events';

import { OAuth2Client } from 'google-auth-library';

import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { PLAY_GAMES_FETCH_TIMEOUT_MS, PLAY_GAMES_RESPONSE_MAX_BYTES } from '../../constants/auth.constant';
import { PlayGamesVerifier } from './play-games-verifier.service';

describe('PlayGamesVerifier', () => {
  let verifier: PlayGamesVerifier;
  let getToken: jest.Mock;

  beforeEach(() => {
    verifier = new PlayGamesVerifier();
    getToken = jest.fn();
    (verifier as unknown as { client: OAuth2Client }).client = { getToken } as unknown as OAuth2Client;
  });

  function mockPlayersResponse({
    body,
    ok = true,
    contentLength = null,
  }: {
    body: unknown;
    ok?: boolean;
    contentLength?: string | null;
  }): void {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      headers: { get: (name: string) => (name === 'content-length' ? contentLength : null) },
      json: async () => await Promise.resolve(body),
    });
  }

  it('exchanges the server auth code and resolves the player identity', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    mockPlayersResponse({ body: { playerId: 'pgs-1', displayName: 'Carol' } });

    await expect(verifier.verify({ serverAuthCode: 'code' })).resolves.toEqual({
      providerUserId: 'pgs-1',
      name: 'Carol',
    });
    expect(getToken).toHaveBeenCalledWith('code');
  });

  it('rejects when the code exchange returns no access token', async () => {
    getToken.mockResolvedValue({ tokens: {} });

    await expect(verifier.verify({ serverAuthCode: 'code' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects when the code exchange fails', async () => {
    getToken.mockRejectedValue(new Error('invalid_grant'));

    await expect(verifier.verify({ serverAuthCode: 'bad' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects on a non-ok response even when the body would otherwise be a valid player', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    mockPlayersResponse({ body: { playerId: 'pgs-1', displayName: 'Carol' }, ok: false });

    await expect(verifier.verify({ serverAuthCode: 'code' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('never follows a redirect off the pinned Google endpoint', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    mockPlayersResponse({ body: { playerId: 'pgs-1' } });

    await verifier.verify({ serverAuthCode: 'code' });

    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });

  it('rejects a player response whose declared size exceeds the cap', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    mockPlayersResponse({ body: { playerId: 'pgs-1' }, contentLength: String(PLAY_GAMES_RESPONSE_MAX_BYTES + 1) });

    await expect(verifier.verify({ serverAuthCode: 'code' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects when the player request fails (network error or timeout abort)', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(verifier.verify({ serverAuthCode: 'code' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects when the player payload has no playerId', async () => {
    getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    mockPlayersResponse({ body: { displayName: 'No Id' } });

    await expect(verifier.verify({ serverAuthCode: 'code' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('aborts and rejects when the player request exceeds the fetch timeout', async () => {
    jest.useFakeTimers();
    getToken.mockResolvedValue({ tokens: { access_token: 'access-token' } });
    global.fetch = jest.fn().mockImplementation(async (...args: unknown[]) => {
      const { signal } = args[1] as { signal: AbortSignal };
      await once(signal, 'abort');
      throw new Error('aborted');
    });

    const assertion = expect(verifier.verify({ serverAuthCode: 'code' })).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    await jest.advanceTimersByTimeAsync(PLAY_GAMES_FETCH_TIMEOUT_MS);
    await assertion;

    jest.useRealTimers();
  });
});
