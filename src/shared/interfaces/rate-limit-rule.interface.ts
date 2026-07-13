export enum SubjectRateLimitPolicy {
  Flexible = 'flexible',
  Standard = 'standard',
  Strict = 'strict',
  Sensitive = 'sensitive',
  Off = 'off',
}

export interface IRateLimitOptions {
  duration: number;
  points: number;
  blockDuration?: number;
  inMemoryBlockOnConsumed?: number;
  inMemoryBlockDuration?: number;
}

export interface ISubjectRateLimitRule {
  policy: SubjectRateLimitPolicy;
  options: IRateLimitOptions;
}

export type RateLimitContext = {
  request: {
    ip_address: string;
    path: string;
    method: string;
    user_id?: string;
  };
};
