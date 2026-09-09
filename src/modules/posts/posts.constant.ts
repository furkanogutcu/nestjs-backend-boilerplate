// * Published posts are read far more often than they change, and every write invalidates the entries it
// * touches — so the TTL only bounds staleness from writes this instance did not see.
export const PUBLISHED_POST_CACHE_TTL_SECONDS = 120;

export const POST_COVER_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const POST_COVER_MAX_BYTES = 2 * 1024 * 1024;
