# Adding a streaming replica (future)

The production setup today is deliberately single-node — a second Postgres on the same VPS adds
nothing to disaster tolerance. This document is the starting point for when that changes.

## When to add a replica

| Trigger                               | Required replica type                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Read load is saturating the primary   | Hot standby (read-only queries)                                                                                   |
| Cross-region disaster recovery needed | Streaming replica on a second VPS                                                                                 |
| Zero-downtime PG/Timescale upgrade    | Replica + failover                                                                                                |
| Real-time analytics / CDC to Kafka    | **Not a replica** — use Debezium against the primary's logical replication slot (`wal_level=logical` already set) |

If the use case is real-time analytics, **do not add a streaming replica first** — use a
Debezium connector that reads the primary's logical replication slot and emits events to Kafka.
Replicas are for read scaling and HA.

## What is already in place to make this easier

- `wal_level = logical` (sufficient for both streaming and logical replication)
- `max_wal_senders = 10`, `max_replication_slots = 10`
- `wal_keep_size = 1GB` (a replica can stay offline for roughly 1 GB of WAL; it does not break)
- WAL archiving to R2 (a replica can backfill from there even if WAL has rotated locally)
- pgBackRest stanza ready — a replica is bootstrapped from the same backup chain

## Two-node setup outline

The cleanest path is **bootstrap from a pgBackRest restore + streaming on top**:

1. Provision a second VPS in a _different_ datacenter / availability zone. Connect it to the
   same WireGuard mesh.
2. Deploy a copy of `docker-compose.production.yml` there. Set a new `${APP_NAME}`
   (e.g. `app-replica-1`). Disable the `pgbouncer` service for now — the replica is for the
   app's read pool, not for write traffic.
3. On the replica node, restore _as a standby_ from pgBackRest:
   ```bash
   docker compose exec pgbackrest \
     pgbackrest --stanza=main --delta --type=standby restore
   ```
   This drops a `standby.signal` file into PGDATA, and Postgres comes up in recovery mode.
4. Add to the replica's `postgresql.conf` (via the compose `command:`):
   ```
   primary_conninfo = 'host=<primary-vpn-ip> port=5432 user=replicator password=...'
   primary_slot_name = 'replica_1'
   ```
   Create the replication role and slot on the primary:
   ```sql
   CREATE ROLE replicator WITH LOGIN REPLICATION PASSWORD '...';
   SELECT pg_create_physical_replication_slot('replica_1');
   ```
5. Start the replica. Verify with:
   ```sql
   -- on the primary
   SELECT * FROM pg_stat_replication;
   -- on the replica
   SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn();
   ```
6. Add the replica's host to the app's read-only DATABASE_URL pool (a separate connection
   string, with a separate `readOnly: true` TypeORM data source — to be designed by then).

## Failover

Not automatic today. Options when the time comes:

- **Manual:** monitoring alarm → operator runs `pg_promote()` on the replica + updates the app
  config to point at it. An acceptable RTO for a side project, but painful at scale.
- **patroni** + etcd / Consul: the industry standard for automatic failover. Requires
  rethinking the deployment model (Dokploy's compose model resists it).
- **Managed Postgres** (Timescale Cloud, Aiven): get built-in HA in exchange for money/control.

Avoid building failover automation before experiencing at least one real failure mode — the
design will be wrong.

## Backup implications

A replica must not run its own pgBackRest backups. Backups stay on the primary; otherwise there
is a risk of timeline divergence in R2. If the primary dies and you promote the replica:

1. Promote (`pg_promote()` or `pg_ctl promote`).
2. Run `pgbackrest --stanza=main stanza-upgrade` on the newly promoted node.
3. Trigger a full backup immediately.
4. Either rebuild the old primary as a new replica, or decommission it.
