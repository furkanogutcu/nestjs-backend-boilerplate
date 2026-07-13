# Database restore runbook (PITR)

Roll the production database back to a specific point. Use it for an accidental `DROP TABLE`, a
bad migration, data corruption, or full disaster recovery.

**Pre-check:** what is needed

- Access to the production Dokploy environment (or `docker compose` on the VPS)
- `R2_*` credentials and `BACKUP_ENCRYPTION_PASSPHRASE` (verify _before_ starting)
- If doing PITR, the target timestamp in **UTC**. Postgres is UTC; do not pass local time.

## Decision: in-place vs fresh node

| Situation                                      | Use                                                   |
| ---------------------------------------------- | ----------------------------------------------------- |
| Bad logical change (DROP, wrong UPDATE)        | **Fresh node** — keep the corrupted one for forensics |
| Volume corruption / disk failure               | Fresh node                                            |
| Entire VPS is dead                             | Fresh node on a new VPS                               |
| Verified safe rollback in a low-traffic window | In-place (rarely the right call)                      |

Prefer a fresh node restore. The corrupted DB stays available so you can diff what changed, and
traffic is switched over only after the restore is verified.

## Fresh node PITR — step by step

### 1. Provision a new Postgres container with the same image

Either a new compose stack on a new VPS, or `docker compose` in a new directory on the same
host, with a fresh `timescaledb_data` volume:

```bash
# Prevent the new container from auto-starting so the restore can run against an empty data dir.
docker compose -f docker-compose.production.yml up -d --no-start timescaledb pgbackrest

# Make sure the data volume is empty (the restore requires an empty PGDATA).
docker compose -f docker-compose.production.yml run --rm --entrypoint='' timescaledb \
  sh -c 'rm -rf /var/lib/postgresql/data/* /var/lib/postgresql/data/.[!.]*'
```

### 2. Start the pgBackRest sidecar (Postgres does not need to be running for the restore)

```bash
docker compose -f docker-compose.production.yml up -d pgbackrest
```

### 3. Run the restore

**Restore to the latest available point** (typical "we lost everything, bring it back up"
scenario):

```bash
docker compose exec pgbackrest \
  pgbackrest --stanza=main --delta restore
```

**Restore to a specific time** (PITR):

```bash
# Time format: ISO 8601, UTC.
TARGET_TIME='2026-05-26 14:37:00+00'

docker compose exec pgbackrest \
  pgbackrest --stanza=main --delta \
  --type=time --target="${TARGET_TIME}" \
  --target-action=promote \
  restore
```

`--delta` makes the restore incremental against whatever is in PGDATA (fast on re-runs).
`--target-action=promote` ends the timeline at the target — Postgres comes up read-write.

### 4. Start Postgres and wait for it to replay WAL up to the target

```bash
docker compose up -d timescaledb
docker compose logs -f timescaledb
```

Watch for the `recovery stopping before commit of transaction ...` and `database system is ready
to accept connections` messages. These signal that recovery is complete.

### 5. Verify

```bash
docker compose exec timescaledb psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "
  SELECT now() AT TIME ZONE 'UTC' AS now_utc,
         pg_last_wal_replay_lsn(),
         (SELECT count(*) FROM pg_extension WHERE extname='timescaledb') AS timescale_ok;
"
```

Run smoke queries against the most important business tables. Verify that:

- row counts are within the expected order of magnitude
- the newest timestamps in the highest-traffic table are at or just before `TARGET_TIME`
  (not after)

### 6. Switch traffic over

Only after verification passes:

- Point the app's `DATABASE_URL` / `MIGRATION_DATABASE_URL` at the new instance
  (Dokploy env update + redeploy)
- Update DNS / internal routing if the host changed
- Park the old corrupted instance read-only for at least 24 h before deleting it

### 7. Re-bootstrap the backup chain

The restored cluster is on a new timeline. If pgBackRest complains about a timeline mismatch,
run `stanza-create --force`, then immediately trigger a fresh full backup so the PITR window
starts clean:

```bash
docker compose exec pgbackrest pgbackrest --stanza=main check
docker compose exec pgbackrest pgbackrest --stanza=main backup --type=full
```

## Monthly drill checklist

Once a month, restore the latest full + WAL to a disposable environment and run steps 1-5.
Record:

- [ ] Restore wall-clock time (target ≤ 1 h)
- [ ] Whether the encryption passphrase still works
- [ ] Whether the R2 credentials still work
- [ ] Whether the smoke query results match production (within drill freshness)
- [ ] Any step that deviated from this runbook → update the runbook

Log the drill in a permanent place (issue tracker, team doc).

## Common problems

| Symptom                                      | Likely cause                          | Fix                                                          |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `unable to load info file ... cipher`        | wrong `BACKUP_ENCRYPTION_PASSPHRASE`  | use the correct one (the one used when the backup was taken) |
| `unable to access bucket: 403`               | R2 token revoked or rotated           | create a new R2 token, update env, redeploy                  |
| `archive-get could not find WAL ...`         | retention pruned the WAL you need     | restore to an earlier time within retention                  |
| Postgres will not start: timeline conflict   | restored over a half-recovered PGDATA | delete PGDATA, restore again with `--delta`                  |
| `pg_isready` healthcheck fails after restore | recovery is still in progress         | `docker compose logs timescaledb` and wait                   |
