import { Injectable } from '@nestjs/common';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as enDictionary, translations } from '@zxcvbn-ts/language-en';

import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { PASSWORD_MIN_STRENGTH_SCORE } from '../constants/auth.constant';

@Injectable()
export class PasswordStrengthService {
  private readonly zxcvbn = new ZxcvbnFactory({
    dictionary: { ...commonDictionary, ...enDictionary },
    graphs: adjacencyGraphs,
    translations,
  });

  assertStrong({ password, userInputs = [] }: { password: string; userInputs?: string[] }): void {
    if (this.zxcvbn.check(password, userInputs).score < PASSWORD_MIN_STRENGTH_SCORE) {
      throw new AppBadRequestException({
        code: ExceptionCode.WeakPassword,
        message: 'Password is too weak or common.',
      });
    }
  }
}
