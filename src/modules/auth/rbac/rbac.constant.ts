// ! The one role the boot sync guarantees exists and keeps holding every permission. `admin:create` grants it,
// ! so it is the way back in when role data is misconfigured — the admin API must never let it be deleted.
export const SUPERUSER_ROLE_NAME = 'superuser';

export const USER_PERMISSIONS_CACHE_TTL_SECONDS = 300;
