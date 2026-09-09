import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import * as OTPAuth from 'otpauth';
import { Repository } from 'typeorm';

import { ClockService } from '@infrastructure/clock/clock.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { AppUnprocessableEntityException } from '@shared/exceptions/unprocessable-entity.exception';

import { User } from '../../entities/user.entity';
import { MfaCredential } from '../entities/mfa-credential.entity';
import { TOTP_ALGORITHM, TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '../mfa.constant';
import { MfaService } from './mfa.service';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function totpFor(secret: string, timestamp = NOW): string {
  return new OTPAuth.TOTP({
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate({ timestamp });
}

describe('MfaService', () => {
  let credentials: DeepMocked<Repository<MfaCredential>>;
  let users: DeepMocked<Repository<User>>;
  let clock: DeepMocked<ClockService>;
  let service: MfaService;

  beforeEach(() => {
    credentials = createMock<Repository<MfaCredential>>();
    users = createMock<Repository<User>>();
    clock = createMock<ClockService>();
    clock.epochMillis.mockReturnValue(NOW);
    clock.date.mockReturnValue(new Date(NOW));
    users.findOne.mockResolvedValue({ id: 'user-1', email: 'admin@example.com' } as User);
    service = new MfaService(credentials, users, clock);
  });

  describe('beginEnrolment', () => {
    it('stores an unconfirmed credential and returns a provisioning URI', async () => {
      credentials.findOne.mockResolvedValue(null);

      const result = await service.beginEnrolment({ userId: 'user-1' });

      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.otpauthUri).toContain('otpauth://totp/');
      expect(result.otpauthUri).toContain('admin%40example.com');
      expect(credentials.upsert).toHaveBeenCalledWith(expect.objectContaining({ confirmedAt: null }), ['userId']);
    });

    it('labels the credential with the user id when the account has no email', async () => {
      credentials.findOne.mockResolvedValue(null);
      users.findOne.mockResolvedValue({ id: 'user-1', email: null } as User);

      expect((await service.beginEnrolment({ userId: 'user-1' })).otpauthUri).toContain('user-1');
    });

    it('refuses to restart enrolment once MFA is already confirmed', async () => {
      credentials.findOne.mockResolvedValue({ confirmedAt: new Date(NOW) } as MfaCredential);

      await expect(service.beginEnrolment({ userId: 'user-1' })).rejects.toBeInstanceOf(AppConflictException);
    });

    it('lets an abandoned, unconfirmed enrolment be restarted', async () => {
      credentials.findOne.mockResolvedValue({ confirmedAt: null } as MfaCredential);

      await expect(service.beginEnrolment({ userId: 'user-1' })).resolves.toBeDefined();
    });
  });

  describe('confirmEnrolment', () => {
    it('confirms with a valid code and returns recovery codes stored hashed', async () => {
      credentials.findOne.mockResolvedValue({ secret: SECRET, confirmedAt: null } as MfaCredential);

      const { recoveryCodes } = await service.confirmEnrolment({ userId: 'user-1', code: totpFor(SECRET) });

      expect(recoveryCodes).toHaveLength(10);
      const [, update] = credentials.update.mock.calls[0] as [unknown, { recoveryCodeHashes: string[] }];
      expect(update.recoveryCodeHashes).toHaveLength(10);
      expect(update.recoveryCodeHashes).not.toContain(recoveryCodes[0]);
    });

    it('rejects an invalid code', async () => {
      credentials.findOne.mockResolvedValue({ secret: SECRET, confirmedAt: null } as MfaCredential);

      await expect(service.confirmEnrolment({ userId: 'user-1', code: '000000' })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
    });

    it('refuses to confirm twice', async () => {
      credentials.findOne.mockResolvedValue({ secret: SECRET, confirmedAt: new Date(NOW) } as MfaCredential);

      await expect(service.confirmEnrolment({ userId: 'user-1', code: totpFor(SECRET) })).rejects.toBeInstanceOf(
        AppConflictException,
      );
    });

    it('fails when there is no enrolment in progress', async () => {
      credentials.findOne.mockResolvedValue(null);

      await expect(service.confirmEnrolment({ userId: 'user-1', code: '123456' })).rejects.toBeInstanceOf(
        AppUnprocessableEntityException,
      );
    });
  });

  describe('requirementFor', () => {
    it('requires MFA for an account holding any role, even before enrolment', async () => {
      credentials.findOne.mockResolvedValue(null);

      await expect(service.requirementFor({ userId: 'user-1', hasRole: true })).resolves.toEqual({
        enrolled: false,
        required: true,
      });
    });

    it('requires MFA for a plain user who enrolled voluntarily', async () => {
      credentials.findOne.mockResolvedValue({ confirmedAt: new Date(NOW) } as MfaCredential);

      await expect(service.requirementFor({ userId: 'user-1', hasRole: false })).resolves.toEqual({
        enrolled: true,
        required: true,
      });
    });

    it('does not require MFA for a plain user who never enrolled', async () => {
      credentials.findOne.mockResolvedValue(null);

      await expect(service.requirementFor({ userId: 'user-1', hasRole: false })).resolves.toEqual({
        enrolled: false,
        required: false,
      });
    });

    it('treats an unconfirmed credential as not enrolled', async () => {
      credentials.findOne.mockResolvedValue({ confirmedAt: null } as MfaCredential);

      await expect(service.requirementFor({ userId: 'user-1', hasRole: false })).resolves.toEqual({
        enrolled: false,
        required: false,
      });
    });
  });

  describe('verify', () => {
    it('accepts a current TOTP code and records the use', async () => {
      credentials.findOne.mockResolvedValue({
        secret: SECRET,
        confirmedAt: new Date(NOW),
        recoveryCodeHashes: [],
      } as unknown as MfaCredential);

      await expect(service.verify({ userId: 'user-1', code: totpFor(SECRET) })).resolves.toBeUndefined();
      expect(credentials.update).toHaveBeenCalledWith({ userId: 'user-1' }, { lastUsedAt: new Date(NOW) });
    });

    it('accepts a code from the previous time step (clock skew)', async () => {
      credentials.findOne.mockResolvedValue({
        secret: SECRET,
        confirmedAt: new Date(NOW),
        recoveryCodeHashes: [],
      } as unknown as MfaCredential);

      const previousStep = totpFor(SECRET, NOW - TOTP_PERIOD_SECONDS * 1000);

      await expect(service.verify({ userId: 'user-1', code: previousStep })).resolves.toBeUndefined();
    });

    it('consumes a recovery code and keeps the others', async () => {
      const codes = ['aaaa', 'bbbb', 'cccc'];
      credentials.findOne.mockResolvedValue({
        secret: SECRET,
        confirmedAt: new Date(NOW),
        recoveryCodeHashes: codes.map((code) => service.hash(code)),
      } as unknown as MfaCredential);

      await service.verify({ userId: 'user-1', code: 'bbbb' });

      const [, update] = credentials.update.mock.calls[0] as [unknown, { recoveryCodeHashes: string[] }];
      expect(update.recoveryCodeHashes).toEqual([service.hash('aaaa'), service.hash('cccc')]);
    });

    it('rejects a recovery code that was already consumed', async () => {
      credentials.findOne.mockResolvedValue({
        secret: SECRET,
        confirmedAt: new Date(NOW),
        recoveryCodeHashes: [service.hash('aaaa')],
      } as unknown as MfaCredential);

      await expect(service.verify({ userId: 'user-1', code: 'bbbb' })).rejects.toBeInstanceOf(AppUnauthorizedException);
    });

    it('rejects any code while the credential is unconfirmed', async () => {
      credentials.findOne.mockResolvedValue({
        secret: SECRET,
        confirmedAt: null,
        recoveryCodeHashes: [],
      } as unknown as MfaCredential);

      await expect(service.verify({ userId: 'user-1', code: totpFor(SECRET) })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
    });
  });

  describe('disable', () => {
    it('removes the credential', async () => {
      credentials.delete.mockResolvedValue({ affected: 1, raw: [] });

      await expect(service.disable({ userId: 'user-1' })).resolves.toBeUndefined();
    });

    it('fails when MFA was not enabled', async () => {
      credentials.delete.mockResolvedValue({ affected: 0, raw: [] });

      await expect(service.disable({ userId: 'user-1' })).rejects.toBeInstanceOf(AppUnprocessableEntityException);
    });
  });

  describe('provisionConfirmed', () => {
    it('hands over an already-active credential with recovery codes', async () => {
      const result = await service.provisionConfirmed({ userId: 'user-1' });

      expect(result.recoveryCodes).toHaveLength(10);
      expect(result.otpauthUri).toContain('otpauth://totp/');
      expect(credentials.upsert).toHaveBeenCalledWith(expect.objectContaining({ confirmedAt: new Date(NOW) }), [
        'userId',
      ]);
    });
  });
});
