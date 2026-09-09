import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { MfaController } from './mfa.controller';
import { MfaService } from './services/mfa.service';

describe('MfaController', () => {
  let mfaService: DeepMocked<MfaService>;
  let controller: MfaController;
  const user = { id: 'user-1' };

  beforeEach(() => {
    mfaService = createMock<MfaService>();
    controller = new MfaController(mfaService);
  });

  describe('enrol', () => {
    it('returns the secret and provisioning URI in wire format', async () => {
      mfaService.beginEnrolment.mockResolvedValue({ secret: 'SECRET', otpauthUri: 'otpauth://totp/x' });

      await expect(controller.enrol(user)).resolves.toEqual({
        secret: 'SECRET',
        otpauth_uri: 'otpauth://totp/x',
      });
      expect(mfaService.beginEnrolment).toHaveBeenCalledWith({ userId: 'user-1' });
    });
  });

  describe('confirm', () => {
    it('returns the recovery codes produced by the service', async () => {
      mfaService.confirmEnrolment.mockResolvedValue({ recoveryCodes: ['aaaa', 'bbbb'] });

      await expect(controller.confirm(user, { code: '123456' })).resolves.toEqual({
        recovery_codes: ['aaaa', 'bbbb'],
      });
      expect(mfaService.confirmEnrolment).toHaveBeenCalledWith({ userId: 'user-1', code: '123456' });
    });
  });

  describe('disable', () => {
    it('verifies a current code before removing the credential', async () => {
      await controller.disable(user, { code: '123456' });

      expect(mfaService.verify).toHaveBeenCalledWith({ userId: 'user-1', code: '123456' });
      expect(mfaService.disable).toHaveBeenCalledWith({ userId: 'user-1' });
    });

    it('does not disable when the code fails verification', async () => {
      mfaService.verify.mockRejectedValue(new Error('invalid'));

      await expect(controller.disable(user, { code: '000000' })).rejects.toThrow('invalid');
      expect(mfaService.disable).not.toHaveBeenCalled();
    });
  });
});
