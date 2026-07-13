#!/bin/sh
set -eu

: "${PGBOUNCER_ADMIN_PASSWORD:?PGBOUNCER_ADMIN_PASSWORD is required}"
: "${PGBOUNCER_STATS_PASSWORD:?PGBOUNCER_STATS_PASSWORD is required}"

userlist=/etc/pgbouncer/userlist.txt

umask 077
cat > "${userlist}" <<EOF
"pgbouncer_admin" "${PGBOUNCER_ADMIN_PASSWORD}"
"pgbouncer_stats" "${PGBOUNCER_STATS_PASSWORD}"
EOF

exec /entrypoint.sh "$@"
