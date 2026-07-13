import { SetMetadata } from '@nestjs/common';

import { subjectRateLimitConfig } from '@config/rate-limit.config';

import {
  IRateLimitOptions,
  ISubjectRateLimitRule,
  SubjectRateLimitPolicy,
} from '../interfaces/rate-limit-rule.interface';

export const SUBJECT_RATE_LIMIT_KEY = 'subject_rate_limit_key';

export const SubjectRateLimit = (params: { policy?: SubjectRateLimitPolicy; options?: IRateLimitOptions } = {}) => {
  const { policy = SubjectRateLimitPolicy.Standard, options } = params;

  if (policy === SubjectRateLimitPolicy.Off) {
    return SetMetadata(SUBJECT_RATE_LIMIT_KEY, { policy: SubjectRateLimitPolicy.Off });
  }

  const rule: ISubjectRateLimitRule = {
    policy,
    options: {
      ...subjectRateLimitConfig[policy],
      ...options,
    },
  };

  return SetMetadata(SUBJECT_RATE_LIMIT_KEY, rule);
};
