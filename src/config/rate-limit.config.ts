import { IRateLimitOptions, SubjectRateLimitPolicy } from '@shared/interfaces/rate-limit-rule.interface';

export const subjectRateLimitConfig: Record<
  Exclude<SubjectRateLimitPolicy, SubjectRateLimitPolicy.Off>,
  IRateLimitOptions
> = {
  [SubjectRateLimitPolicy.Standard]: {
    duration: 60,
    points: 100,
  },
  [SubjectRateLimitPolicy.Strict]: {
    duration: 60,
    points: 10,
  },
  [SubjectRateLimitPolicy.Flexible]: {
    duration: 60,
    points: 250,
  },
  [SubjectRateLimitPolicy.Sensitive]: {
    duration: 60,
    points: 5,
  },
};

export const ipRateLimitConfig: IRateLimitOptions = {
  duration: 60,
  points: 300,
};
