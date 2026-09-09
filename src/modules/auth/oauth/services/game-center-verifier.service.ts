import { Injectable } from '@nestjs/common';
import { createHash, createVerify, X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppException } from '@shared/exceptions/app.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppInternalException } from '@shared/exceptions/internal.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { CacheKey } from '@shared/utils/cache-key.util';
import { isResponseWithinSizeCap } from '@shared/utils/http.util';

import {
  GAME_CENTER_CERT_CACHE_MAX_ENTRIES,
  GAME_CENTER_CERT_CACHE_TTL_MS,
  GAME_CENTER_CERT_MAX_BYTES,
  GAME_CENTER_FETCH_TIMEOUT_MS,
  GAME_CENTER_INTERMEDIATE_CA_FILE,
  GAME_CENTER_PUBLIC_KEY_HOSTS,
  GAME_CENTER_REPLAY_GUARD_TTL_SECONDS,
  GAME_CENTER_ROOT_CA_FILE,
  GAME_CENTER_SUBJECT_ORGANIZATION,
  GAME_CENTER_TIMESTAMP_SKEW_SECONDS,
} from '../../constants/auth.constant';
import { IOAuthIdentity } from '../../interfaces/oauth-identity.interface';

interface IGameCenterAssertion {
  teamPlayerId: string;
  publicKeyUrl: string;
  signature: string;
  salt: string;
  timestamp: number;
}

interface ICachedCertificate {
  certificate: X509Certificate;
  fetchedAt: number;
}

@Injectable()
export class GameCenterVerifier {
  private readonly replayPrefix = appConfig.redis.keyPrefixes.gameCenterReplay;
  private readonly certificateCache = new Map<string, ICachedCertificate>();
  private readonly certsDir = join(__dirname, 'certs');
  private readonly intermediateCa = this.loadTrustAnchor(GAME_CENTER_INTERMEDIATE_CA_FILE);
  private readonly rootCa = this.loadTrustAnchor(GAME_CENTER_ROOT_CA_FILE);

  constructor(
    private readonly redisService: RedisService,
    private readonly clock: ClockService,
  ) {
    // * Fail fast on a corrupt bundle: the pinned intermediate must itself chain to the pinned root.
    if (!this.intermediateCa.verify(this.rootCa.publicKey)) {
      throw new AppInternalException({ message: 'Game Center trust anchor chain is invalid' });
    }
  }

  async verify(assertion: IGameCenterAssertion): Promise<IOAuthIdentity> {
    try {
      const certificateUrl = this.assertTrustedUrl(assertion.publicKeyUrl);
      this.assertFresh(assertion.timestamp);

      const certificate = await this.fetchCertificate(certificateUrl);
      this.assertCertificateValidity(certificate);
      this.assertIssuedByApple(certificate);

      if (!this.signatureMatches({ certificate, assertion })) {
        throw this.invalidSignature();
      }

      await this.assertNotReplayed(assertion.signature);

      return { providerUserId: assertion.teamPlayerId };
    } catch (error) {
      // ! Let a deliberate 401/503 through; only unexpected failures normalize to an invalid signature.
      if (error instanceof AppException) {
        throw error;
      }

      throw this.invalidSignature();
    }
  }

  private assertTrustedUrl(publicKeyUrl: string): string {
    let url: URL;

    try {
      url = new URL(publicKeyUrl);
    } catch {
      throw this.invalidSignature();
    }

    const host = url.hostname.toLowerCase();
    const trusted = url.protocol === 'https:' && GAME_CENTER_PUBLIC_KEY_HOSTS.has(host);

    if (!trusted) {
      throw this.invalidSignature();
    }

    return `${url.origin}${url.pathname}`;
  }

  private assertFresh(timestamp: number): void {
    const driftSeconds = Math.abs(this.clock.epochMillis() - timestamp) / 1000;

    if (driftSeconds > GAME_CENTER_TIMESTAMP_SKEW_SECONDS) {
      throw this.invalidSignature();
    }
  }

  private async fetchCertificate(certificateUrl: string): Promise<X509Certificate> {
    const cached = this.certificateCache.get(certificateUrl);

    if (cached && this.clock.epochMillis() - cached.fetchedAt < GAME_CENTER_CERT_CACHE_TTL_MS) {
      return cached.certificate;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GAME_CENTER_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(certificateUrl, { signal: controller.signal, redirect: 'error' });

      if (!response.ok) {
        throw this.invalidSignature();
      }

      if (!isResponseWithinSizeCap({ response, maxBytes: GAME_CENTER_CERT_MAX_BYTES })) {
        throw this.invalidSignature();
      }

      const certificate = new X509Certificate(Buffer.from(await response.arrayBuffer()));
      this.cacheCertificate({ certificateUrl, certificate });

      return certificate;
    } finally {
      clearTimeout(timeout);
    }
  }

  private cacheCertificate({
    certificateUrl,
    certificate,
  }: {
    certificateUrl: string;
    certificate: X509Certificate;
  }): void {
    if (
      !this.certificateCache.has(certificateUrl) &&
      this.certificateCache.size >= GAME_CENTER_CERT_CACHE_MAX_ENTRIES
    ) {
      const oldest = this.certificateCache.keys().next().value;

      if (oldest !== undefined) {
        this.certificateCache.delete(oldest);
      }
    }

    this.certificateCache.set(certificateUrl, { certificate, fetchedAt: this.clock.epochMillis() });
  }

  private assertCertificateValidity(certificate: X509Certificate): void {
    const now = this.clock.epochMillis();

    if (now < certificate.validFromDate.getTime() || now > certificate.validToDate.getTime()) {
      throw this.invalidSignature();
    }
  }

  // ! Second layer behind host pinning: an unrelated code-signing cert served from the pinned host must not pass.
  private assertIssuedByApple(certificate: X509Certificate): void {
    if (!certificate.verify(this.intermediateCa.publicKey)) {
      throw this.invalidSignature();
    }

    const organizationMatches = certificate.subject
      .split('\n')
      .some((line) => line === GAME_CENTER_SUBJECT_ORGANIZATION);

    if (!organizationMatches) {
      throw this.invalidSignature();
    }
  }

  private signatureMatches({
    certificate,
    assertion,
  }: {
    certificate: X509Certificate;
    assertion: IGameCenterAssertion;
  }): boolean {
    const signature = Buffer.from(assertion.signature, 'base64');

    return env.GAME_CENTER_BUNDLE_IDS.some((bundleId) => {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(this.buildPayload({ assertion, bundleId }));
      verifier.end();

      return verifier.verify(certificate.publicKey, signature);
    });
  }

  private buildPayload({ assertion, bundleId }: { assertion: IGameCenterAssertion; bundleId: string }): Buffer {
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigUInt64BE(BigInt(assertion.timestamp));

    return Buffer.concat([
      Buffer.from(assertion.teamPlayerId, 'utf8'),
      Buffer.from(bundleId, 'utf8'),
      timestamp,
      Buffer.from(assertion.salt, 'base64'),
    ]);
  }

  private async assertNotReplayed(signature: string): Promise<void> {
    // ! Fingerprint the DECODED bytes: base64 decoding is lenient, so a re-encoded copy would bypass the replay guard.
    const fingerprint = createHash('sha256').update(Buffer.from(signature, 'base64')).digest('hex');
    const key = CacheKey.join(this.replayPrefix, fingerprint);
    const stored = await this.redisService.getClient().set(key, '1', 'EX', GAME_CENTER_REPLAY_GUARD_TTL_SECONDS, 'NX');

    if (stored !== 'OK') {
      throw this.invalidSignature();
    }
  }

  private invalidSignature(): AppUnauthorizedException {
    return new AppUnauthorizedException({
      code: ExceptionCode.InvalidOauthToken,
      message: 'Invalid Game Center identity signature.',
    });
  }

  private loadTrustAnchor(fileName: string): X509Certificate {
    try {
      return new X509Certificate(readFileSync(join(this.certsDir, fileName), 'utf-8'));
    } catch (error) {
      throw new AppInternalException({
        message: `Failed to load Game Center trust anchor "${fileName}"`,
        error: error instanceof Error ? error : undefined,
      });
    }
  }
}
