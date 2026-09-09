import { once } from 'node:events';

import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { createSign, generateKeyPairSync, KeyObject } from 'crypto';
import { Redis } from 'ioredis';
import type { Mock } from 'vitest';

import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import {
  GAME_CENTER_CERT_CACHE_MAX_ENTRIES,
  GAME_CENTER_CERT_MAX_BYTES,
  GAME_CENTER_FETCH_TIMEOUT_MS,
  GAME_CENTER_TIMESTAMP_SKEW_SECONDS,
} from '../../constants/auth.constant';
import { GameCenterVerifier } from './game-center-verifier.service';

// * X509 parsing is mocked, but createSign/createVerify run for real, so the signature check is genuine.
const APPLE_SUBJECT = 'C=US\nST=California\nL=Cupertino\nO=Apple Inc.\nOU=management:idms.group.533771\nCN=Apple Inc.';

const certState: {
  publicKey: KeyObject | null;
  validFromDate: Date;
  validToDate: Date;
  subject: string;
  chainValid: boolean;
} = {
  publicKey: null,
  validFromDate: new Date('2020-01-01T00:00:00.000Z'),
  validToDate: new Date('2099-01-01T00:00:00.000Z'),
  subject: APPLE_SUBJECT,
  chainValid: true,
};

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');

  class MockX509Certificate {
    private readonly leaf: boolean;
    private readonly caKey: { ca: symbol } | null;

    constructor(source: unknown) {
      this.leaf = Buffer.isBuffer(source);
      this.caKey = this.leaf ? null : { ca: Symbol('ca') };
    }

    get publicKey(): unknown {
      return this.leaf ? certState.publicKey : this.caKey;
    }

    get subject(): string {
      return certState.subject;
    }

    get validFromDate(): Date {
      return certState.validFromDate;
    }

    get validToDate(): Date {
      return certState.validToDate;
    }

    verify(): boolean {
      return this.leaf ? certState.chainValid : true;
    }
  }

  return { ...actual, X509Certificate: MockX509Certificate };
});

const BUNDLE_ID = 'com.app.test';
const PUBLIC_KEY_URL = 'https://static.gc.apple.com/public-key/gc-prod.cer';

describe('GameCenterVerifier', () => {
  let verifier: GameCenterVerifier;
  let redis: DeepMocked<Redis>;
  let privateKey: KeyObject;

  beforeAll(() => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keyPair.privateKey;
    certState.publicKey = keyPair.publicKey;
  });

  beforeEach(() => {
    certState.subject = APPLE_SUBJECT;
    certState.chainValid = true;

    redis = createMock<Redis>();
    redis.set.mockResolvedValue('OK');
    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    verifier = new GameCenterVerifier(redisService, new ClockService());

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => await Promise.resolve(new ArrayBuffer(0)),
    });
  });

  function buildAssertion(
    overrides: Partial<{ teamPlayerId: string; bundleId: string; timestamp: number; publicKeyUrl: string }> = {},
  ): { teamPlayerId: string; publicKeyUrl: string; signature: string; salt: string; timestamp: number } {
    const teamPlayerId = overrides.teamPlayerId ?? 'G:1234567890';
    const bundleId = overrides.bundleId ?? BUNDLE_ID;
    const timestamp = overrides.timestamp ?? Date.now();
    const salt = Buffer.from('game-center-salt').toString('base64');

    const timestampBuffer = Buffer.alloc(8);
    timestampBuffer.writeBigUInt64BE(BigInt(timestamp));
    const payload = Buffer.concat([
      Buffer.from(teamPlayerId, 'utf8'),
      Buffer.from(bundleId, 'utf8'),
      timestampBuffer,
      Buffer.from(salt, 'base64'),
    ]);

    const signer = createSign('RSA-SHA256');
    signer.update(payload);
    signer.end();

    return {
      teamPlayerId,
      publicKeyUrl: overrides.publicKeyUrl ?? PUBLIC_KEY_URL,
      signature: signer.sign(privateKey).toString('base64'),
      salt,
      timestamp,
    };
  }

  it('returns the identity for a valid signature', async () => {
    await expect(verifier.verify(buildAssertion())).resolves.toEqual({ providerUserId: 'G:1234567890' });
  });

  it('fetches the certificate without following redirects', async () => {
    await verifier.verify(buildAssertion());

    expect(global.fetch).toHaveBeenCalledWith(PUBLIC_KEY_URL, expect.objectContaining({ redirect: 'error' }));
  });

  it('reuses one cached fetch across query-string variants of the same certificate path', async () => {
    const base = 'https://static.gc.apple.com/public-key/gc-prod.cer';

    await verifier.verify(buildAssertion({ teamPlayerId: 'G:1', publicKeyUrl: `${base}?v=1` }));
    await verifier.verify(buildAssertion({ teamPlayerId: 'G:2', publicKeyUrl: `${base}?v=2` }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(base, expect.objectContaining({ redirect: 'error' }));
  });

  it('bounds the certificate cache by evicting the oldest entry when full', async () => {
    const path = (index: number): string => `https://static.gc.apple.com/public-key/gc-${index}.cer`;

    for (let index = 0; index <= GAME_CENTER_CERT_CACHE_MAX_ENTRIES; index++) {
      await verifier.verify(buildAssertion({ teamPlayerId: `G:${index}`, publicKeyUrl: path(index) }));
    }

    const fetchesAfterFill = (global.fetch as Mock).mock.calls.length;

    await verifier.verify(
      buildAssertion({ teamPlayerId: 'G:newest', publicKeyUrl: path(GAME_CENTER_CERT_CACHE_MAX_ENTRIES) }),
    );
    expect((global.fetch as Mock).mock.calls.length).toBe(fetchesAfterFill);

    await verifier.verify(buildAssertion({ teamPlayerId: 'G:evicted', publicKeyUrl: path(0) }));
    expect((global.fetch as Mock).mock.calls.length).toBe(fetchesAfterFill + 1);
  });

  it('accepts the sandbox Game Center host', async () => {
    await expect(
      verifier.verify(buildAssertion({ publicKeyUrl: 'https://sandbox.gc.apple.com/public-key/gc-sandbox.cer' })),
    ).resolves.toEqual({ providerUserId: 'G:1234567890' });
  });

  it.each([
    ['a non-apple host', 'https://evil.example.com/gc.cer'],
    ['an apple.com host outside the pinned Game Center set', 'https://evil.apple.com/gc.cer'],
    ['a non-https scheme', 'http://static.gc.apple.com/gc.cer'],
  ])('rejects a publicKeyUrl on %s', async (_label, publicKeyUrl) => {
    await expect(verifier.verify(buildAssertion({ publicKeyUrl }))).rejects.toBeInstanceOf(AppUnauthorizedException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a leaf certificate not signed by the pinned intermediate', async () => {
    certState.chainValid = false;

    await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('rejects a leaf certificate whose subject is not Apple', async () => {
    certState.subject = 'C=US\nO=Evil Inc.\nCN=Evil Inc.';

    await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('writes the replay guard with a TTL that covers the full two-sided freshness window', async () => {
    await verifier.verify(buildAssertion());

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('game-center-replay'),
      '1',
      'EX',
      2 * GAME_CENTER_TIMESTAMP_SKEW_SECONDS,
      'NX',
    );
  });

  it('rejects an assertion verified against an expired certificate', async () => {
    const originalValidTo = certState.validToDate;
    certState.validToDate = new Date(Date.now() - 1000);

    try {
      await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
    } finally {
      certState.validToDate = originalValidTo;
    }
  });

  it('rejects when the certificate endpoint returns a non-ok response', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, arrayBuffer: async () => await Promise.resolve(new ArrayBuffer(0)) });

    await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('normalizes an unexpected certificate fetch failure to an invalid-signature rejection', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('aborts and rejects when the certificate fetch exceeds the timeout', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockImplementation(async (...args: unknown[]) => {
      const { signal } = args[1] as { signal: AbortSignal };
      await once(signal, 'abort');
      throw new Error('aborted');
    });

    const assertion = expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
    await vi.advanceTimersByTimeAsync(GAME_CENTER_FETCH_TIMEOUT_MS);
    await assertion;

    vi.useRealTimers();
  });

  it('rejects a signature whose timestamp is stale', async () => {
    await expect(verifier.verify(buildAssertion({ timestamp: Date.now() - 3600 * 1000 }))).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
  });

  it('rejects when the signature does not match the asserted identity', async () => {
    const assertion = buildAssertion();

    await expect(verifier.verify({ ...assertion, teamPlayerId: 'G:9999999999' })).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
  });

  it('rejects a signature that was already seen (replay)', async () => {
    redis.set.mockResolvedValueOnce(null as unknown as 'OK');

    await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('keys the replay guard on the decoded signature bytes, so a re-encoded copy hits the same guard slot', async () => {
    const assertion = buildAssertion();

    await verifier.verify(assertion);
    const firstKey = (redis.set.mock.calls[0] as unknown[])[0];

    const reEncoded = Buffer.from(assertion.signature, 'base64').toString('base64url');
    redis.set.mockClear();

    await verifier.verify({ ...assertion, signature: reEncoded });
    const secondKey = (redis.set.mock.calls[0] as unknown[])[0];

    expect(reEncoded).not.toBe(assertion.signature);
    expect(secondKey).toBe(firstKey);
  });

  it('rejects a certificate response whose declared size exceeds the cap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === 'content-length' ? String(GAME_CENTER_CERT_MAX_BYTES + 1) : null) },
      arrayBuffer: async () => await Promise.resolve(new ArrayBuffer(0)),
    });

    await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('fails closed with a 503 (not a 401) when the replay guard store is unavailable', async () => {
    redis.set.mockRejectedValue(new AppServiceUnavailableException());

    await expect(verifier.verify(buildAssertion())).rejects.toBeInstanceOf(AppServiceUnavailableException);
  });
});
