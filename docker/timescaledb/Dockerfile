# pgbackrest binary lives in this image so Postgres' archive_command can call it directly.
# Scheduled backups run in the woblerr/pgbackrest sidecar — same version, shared volumes.

ARG TIMESCALEDB_VERSION=2.27.1-pg16
FROM timescale/timescaledb:${TIMESCALEDB_VERSION}

USER root

RUN apk add --no-cache \
        bash \
        pgbackrest \
        tzdata \
    && mkdir -p \
        /var/lib/pgbackrest \
        /var/log/pgbackrest \
        /var/spool/pgbackrest \
        /etc/pgbackrest \
        /etc/pgbackrest/conf.d \
    && chown -R postgres:postgres \
        /var/lib/pgbackrest \
        /var/log/pgbackrest \
        /var/spool/pgbackrest \
        /etc/pgbackrest \
    && chmod 750 \
        /var/lib/pgbackrest \
        /var/log/pgbackrest \
        /var/spool/pgbackrest \
        /etc/pgbackrest

COPY docker/pgbackrest/pgbackrest.conf.template /etc/pgbackrest/pgbackrest.conf.template
COPY docker/postgres/init/01-bootstrap.sh /docker-entrypoint-initdb.d/01-bootstrap.sh
COPY docker/postgres/init/02-bootstrap.sql.template /docker-entrypoint-initdb.d/02-bootstrap.sql.template
COPY docker/timescaledb/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod 750 \
        /docker-entrypoint-initdb.d/01-bootstrap.sh \
        /usr/local/bin/entrypoint.sh \
    && chown postgres:postgres \
        /etc/pgbackrest/pgbackrest.conf.template

USER postgres

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["postgres"]
