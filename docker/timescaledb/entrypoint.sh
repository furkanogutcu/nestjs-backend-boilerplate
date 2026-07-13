#!/bin/bash
set -euo pipefail

template=/etc/pgbackrest/pgbackrest.conf.template
target=/etc/pgbackrest/pgbackrest.conf

if [ -f "$template" ]; then
  missing=()
  for var in R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY R2_SECRET_KEY BACKUP_ENCRYPTION_PASSPHRASE; do
    if [ -z "${!var:-}" ]; then
      missing+=("$var")
    fi
  done

  if [ "${#missing[@]}" -ne 0 ]; then
    # Don't block Postgres boot on backup config; surface clearly and continue.
    echo "[entrypoint] WARN pgbackrest config NOT rendered, missing: ${missing[*]}" >&2
  else
    umask 077
    eval "cat <<__PGBR_EOF__
$(cat "$template")
__PGBR_EOF__
" > "$target"
    chmod 600 "$target"
    echo "[entrypoint] pgbackrest config rendered at $target"
  fi
fi

exec docker-entrypoint.sh "$@"
