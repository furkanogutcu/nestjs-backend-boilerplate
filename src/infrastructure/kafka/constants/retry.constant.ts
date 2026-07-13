export interface IRetryTier {
  suffix: string;
  delayMs: number;
}

export const RETRY_TIERS: readonly IRetryTier[] = [
  { suffix: 'retry.5s', delayMs: 5_000 },
  { suffix: 'retry.1m', delayMs: 60_000 },
  { suffix: 'retry.10m', delayMs: 600_000 },
] as const;
