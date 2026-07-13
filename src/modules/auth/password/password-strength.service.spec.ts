import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { PasswordStrengthService } from './password-strength.service';

describe('PasswordStrengthService', () => {
  let service: PasswordStrengthService;

  beforeEach(() => {
    service = new PasswordStrengthService();
  });

  it('rejects a common/leaked password as a weak-password bad request', () => {
    expect.assertions(2);

    try {
      service.assertStrong({ password: 'password123' });
    } catch (error) {
      expect(error).toBeInstanceOf(AppBadRequestException);
      expect((error as AppBadRequestException).code).toBe(ExceptionCode.WeakPassword);
    }
  });

  it('accepts a high-entropy passphrase', () => {
    expect(() => service.assertStrong({ password: 'correct-horse-battery-staple' })).not.toThrow();
  });

  it('penalises a password that matches a supplied user input (e.g. the account email)', () => {
    const password = 'correct-horse-battery-staple';

    // * Strong on its own, but rejected once the same string is fed as a user input — proves userInputs is honoured.
    expect(() => service.assertStrong({ password })).not.toThrow();
    expect(() => service.assertStrong({ password, userInputs: [password] })).toThrow(AppBadRequestException);
  });
});
