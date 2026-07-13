#!/usr/bin/env bash
set -euo pipefail

required=(
  PGBOUNCER_AUTH_PASSWORD
  POSTGRES_EXPORTER_PASSWORD
)
for var in "${required[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "[bootstrap] missing required env var: ${var}" >&2
    exit 1
  fi
done

template_dir="$(dirname "$0")"
rendered="${template_dir}/02-bootstrap.rendered.sql"

escape_sql() { printf "%s" "$1" | sed "s/'/''/g"; }

PGBOUNCER_AUTH_PASSWORD_SQL=$(escape_sql "${PGBOUNCER_AUTH_PASSWORD}")
POSTGRES_EXPORTER_PASSWORD_SQL=$(escape_sql "${POSTGRES_EXPORTER_PASSWORD}")
POSTGRES_DB_SQL=$(escape_sql "${POSTGRES_DB}")

sed \
  -e "s|@@PGBOUNCER_AUTH_PASSWORD@@|${PGBOUNCER_AUTH_PASSWORD_SQL}|g" \
  -e "s|@@POSTGRES_EXPORTER_PASSWORD@@|${POSTGRES_EXPORTER_PASSWORD_SQL}|g" \
  -e "s|@@POSTGRES_DB@@|${POSTGRES_DB_SQL}|g" \
  "${template_dir}/02-bootstrap.sql.template" > "${rendered}"

psql \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --set ON_ERROR_STOP=1 \
  --file "${rendered}"

# Delete the rendered file so cleartext passwords don't linger in /docker-entrypoint-initdb.d.
rm -f "${rendered}"
