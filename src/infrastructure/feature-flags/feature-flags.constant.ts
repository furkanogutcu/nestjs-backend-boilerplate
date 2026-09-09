// * Short by design: a flag flipped in the admin API should take effect in seconds, and the read is a single
// * indexed primary-key lookup when the cache misses.
export const FEATURE_FLAG_CACHE_TTL_SECONDS = 30;
