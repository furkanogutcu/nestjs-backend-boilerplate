import { Injectable } from '@nestjs/common';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as enDictionary, translations } from '@zxcvbn-ts/language-en';

import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { PASSWORD_MIN_STRENGTH_SCORE } from '../constants/auth.constant';

// * Offline strength check (no external service): zxcvbn scores 0-4 against the common + English word lists, so a
// * leaked/common/keyboard-walk password is rejected before it is ever hashed.
@Injectable()
export class PasswordStrengthService {
  private readonly zxcvbn = new ZxcvbnFactory({
    dictionary: { ...commonDictionary, ...enDictionary },
    graphs: adjacencyGraphs,
    translations,
  });

  // * Reject anything below the floor. userInputs (e.g. the account email) fold into the dictionary so an
  // * address-derived password is penalised. Called only on register/reset — login is never gated, so pre-existing
  // * weak passwords keep working.
  assertStrong({ password, userInputs = [] }: { password: string; userInputs?: string[] }): void {
    if (this.zxcvbn.check(password, userInputs).score < PASSWORD_MIN_STRENGTH_SCORE) {
      throw new AppBadRequestException({
        code: ExceptionCode.WeakPassword,
        message: 'Password is too weak or common.',
      });
    }
  }
}
