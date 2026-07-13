#!/bin/sh
set -eu

required="R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY R2_SECRET_KEY BACKUP_ENCRYPTION_PASSPHRASE"
for var in $required; do
  eval "value=\${$var:-}"
  if [ -z "$value" ]; then
    echo "[pgbackrest] missing required env var: $var" >&2
    exit 1
  fi
done

template=/etc/pgbackrest/pgbackrest.conf.template
target=/etc/pgbackrest/pgbackrest.conf

umask 077
eval "cat <<__PGBR_EOF__
$(cat "$template")
__PGBR_EOF__
" > "$target"
chmod 600 "$target"

exec /entrypoint.sh "$@"
