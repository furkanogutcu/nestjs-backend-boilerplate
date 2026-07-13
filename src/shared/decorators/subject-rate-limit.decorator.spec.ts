import { Reflector } from '@nestjs/core';

import { subjectRateLimitConfig } from '@config/rate-limit.config';

import { IRateLimitOptions, SubjectRateLimitPolicy } from '../interfaces/rate-limit-rule.interface';
import { SUBJECT_RATE_LIMIT_KEY, SubjectRateLimit } from './subject-rate-limit.decorator';

const reflector = new Reflector();

function ruleFor(decorator: ClassDecorator): unknown {
  @decorator
  class Target {}

  return reflector.get(SUBJECT_RATE_LIMIT_KEY, Target);
}

describe('SubjectRateLimit', () => {
  it('stores only the Off marker for the Off policy', () => {
    expect(ruleFor(SubjectRateLimit({ policy: SubjectRateLimitPolicy.Off }))).toEqual({
      policy: SubjectRateLimitPolicy.Off,
    });
  });

  it('defaults to the Standard policy with its configured options', () => {
    expect(ruleFor(SubjectRateLimit())).toEqual({
      policy: SubjectRateLimitPolicy.Standard,
      options: subjectRateLimitConfig[SubjectRateLimitPolicy.Standard],
    });
  });

  it('merges option overrides onto the policy defaults', () => {
    expect(
      ruleFor(SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict, options: { points: 5 } as IRateLimitOptions })),
    ).toEqual({
      policy: SubjectRateLimitPolicy.Strict,
      options: { ...subjectRateLimitConfig[SubjectRateLimitPolicy.Strict], points: 5 },
    });
  });
});
