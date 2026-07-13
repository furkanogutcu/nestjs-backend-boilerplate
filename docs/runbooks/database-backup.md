# Database backup runbook

Which backups exist, where they live, how to trigger them manually, and what to
do when something appears wrong. Used together with `database-restore.md`.

## Summary

| What                     | When                 | Where                                                   |
| ------------------------ | -------------------- | ------------------------------------------------------- |
| WAL archive (continuous) | every transaction    | Cloudflare R2, encrypted                                |
| Differential backup      | daily 03:00 UTC      | Cloudflare R2, encrypted                                |
| Full backup              | weekly Sun 02:00 UTC | Cloudflare R2, encrypted                                |
| Retention (PITR window)  | 30 days              | pgBackRest prunes automatically on the next full backup |

Everything older than 30 days is deleted automatically once the next full backup
completes.

## Architecture in one paragraph

The `archive_command` runs inside the Timescale container (the image was custom-built to
include the `pgbackrest` binary). It pushes WAL files to a local spool volume
(`/var/spool/pgbackrest`, shared with the sidecar), and a separate `pgbackrest` sidecar
(`woblerr/pgbackrest`) flushes them asynchronously to R2 and runs the scheduled
`backup --type=full|diff` commands. Both ends use the same `pgbackrest.conf` (both render it
at boot from `docker/pgbackrest/pgbackrest.conf.template` with the same env).

## Initial setup (one-time)

Run this once, immediately after the first production deploy. No backup can be taken without
`stanza-create`.

```bash
# On the host:
docker compose -f docker-compose.production.yml exec pgbackrest \
  pgbackrest --stanza=main stanza-create

# Verify the stanza is healthy end to end (this also pushes a test WAL):
docker compose -f docker-compose.production.yml exec pgbackrest \
  pgbackrest --stanza=main check

# First full backup (do not wait for cron):
docker compose -f docker-compose.production.yml exec pgbackrest \
  pgbackrest --stanza=main backup --type=full
```

On a fresh DB, the first full backup taking a few minutes is normal. Subsequent diffs are much
smaller.

## Trigger a manual backup

```bash
# Full (equivalent of the Sunday cron)
docker compose -f docker-compose.production.yml exec pgbackrest \
  pgbackrest --stanza=main backup --type=full

# Differential (equivalent of the daily cron)
docker compose -f docker-compose.production.yml exec pgbackrest \
  pgbackrest --stanza=main backup --type=diff
```

## Status check

```bash
# Backup catalog (size, type, timestamps, retention status)
docker compose exec pgbackrest pgbackrest info

# Is WAL archiving flowing?
docker compose exec timescaledb psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "SELECT * FROM pg_stat_archiver;"
```

Watch for:

- `archived_count` is increasing, `failed_count` stays at zero
- `pgbackrest info` shows a `wal start/stop` range close to "now"
- backups older than the retention limit are not unexpectedly stuck

## Credentials and secrets

| Secret                           | Where stored        | When rotated                     |
| -------------------------------- | ------------------- | -------------------------------- |
| `R2_ACCESS_KEY`, `R2_SECRET_KEY` | Dokploy env (prod)  | suspected leak; quarterly        |
| `BACKUP_ENCRYPTION_PASSPHRASE`   | Dokploy env (prod)  | suspected leak; repo is re-keyed |
| Postgres `pgbackrest` user pw    | (uses local socket) | never                            |

**Critical:** Keep a copy of `BACKUP_ENCRYPTION_PASSPHRASE` in a vault outside the VPS
(password manager, 1Password vault). If it is lost, every backup in R2 becomes an unrecoverable
block of ciphertext.

### Rotating the encryption passphrase

pgBackRest cannot re-encrypt existing backups in place. To rotate:

1. Add the new passphrase in Dokploy as `BACKUP_ENCRYPTION_PASSPHRASE_NEW`.
2. Run `stanza-create --force` against a new `repo2-*` config with the new key.
3. Run a fresh `backup --type=full` to the new repo.
4. Once at least ≥1 successful full has completed to the new repo, keep the old repo read-only
   for the duration of the PITR window, then decommission it. Never delete the old key until
   the old repo is retired.

## Alarms to wire (Prometheus)

| Metric                          | Threshold                            | Why                                         |
| ------------------------------- | ------------------------------------ | ------------------------------------------- |
| `pg_stat_archiver_failed_count` | increase within 5 min                | `archive_command` is failing → WAL piles up |
| `pg_wal_size_bytes` (custom)    | > 5 GiB                              | spool is not draining to R2                 |
| `pg_stat_replication`           | (when a replica exists)              | replica lag                                 |
| No backup                       | no successful diff for over 36 hours | cron missed or the sidecar went down        |

Parsing `pgbackrest info --output=json` from a cron-triggered exporter is the standard
"is the backup OK" probe. To avoid adding a new component, use Dokploy's scheduled tasks to
call `info` weekly and alarm on stale backups.

## Monthly drill

Restore the latest full + WAL to a disposable environment using
`docs/runbooks/database-restore.md`. Record the elapsed wall-clock time (RTO budget = 1 h). Log
the result with the date in the team log. An untested backup is not a backup.
