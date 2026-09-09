# Audit log

`audit_events` records identity events, administrative mutations and role changes. Its value depends on one
property: **the application cannot rewrite it**.

## The append-only guarantee

The migration that creates the table runs:

```sql
REVOKE UPDATE, DELETE ON "audit_events" FROM "<application role>";
```

Migrations run as the owning role (`MIGRATION_DATABASE_URL`), the application connects as a different one
(`DATABASE_URL`). The application can `INSERT` and `SELECT` but not rewrite or erase — so a compromise of the
application, or an SQL injection through it, cannot cover its tracks.

> **If both URLs name the same role, the migration warns and skips the revoke.** There is nothing to enforce
> between a role and itself. Check the deploy log for
> `[audit] DATABASE_URL and MIGRATION_DATABASE_URL share a role`.

### Verifying it is in place

```sql
SELECT has_table_privilege('<application role>', 'audit_events', 'INSERT') AS can_insert,
       has_table_privilege('<application role>', 'audit_events', 'UPDATE') AS can_update,
       has_table_privilege('<application role>', 'audit_events', 'DELETE') AS can_delete;
```

Expected: `t`, `f`, `f`.

### Setting up the two roles

If your deployment currently uses one role, create a restricted one for the application:

```sql
CREATE ROLE app_runtime LOGIN PASSWORD '<secret>';
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
```

Point `DATABASE_URL` at it, keep `MIGRATION_DATABASE_URL` on the owner, then re-run migrations so the revoke
is applied.

## Retention

Pruning is a standalone task, not an in-process job. It connects with `MIGRATION_DATABASE_URL`, because the
application role cannot delete audit rows — that is the whole point of the grant above. A scheduled job living
inside the application would need a second, delete-capable connection open in the running process, which hands
back the reach the revoke was there to remove.

```bash
pnpm audit:prune                      # from a checkout, over ts-node
pnpm audit:prune --older-than-days=90 # explicit window
```

In a deployed container use the compiled entry point — the production image has no `ts-node`:

```bash
pnpm audit:prune:prod --older-than-days=90
```

Both default to `AUDIT_RETENTION_DAYS` (365) when no window is given.

### Scheduling it

**Nothing runs this automatically.** There is no portable answer here: the scheduler belongs to the platform,
so wire the command into whichever one you already run.

| Platform                       | Where it goes                                                        |
| ------------------------------ | -------------------------------------------------------------------- |
| A platform with scheduled jobs | A scheduled task on the app service, command `pnpm audit:prune:prod` |
| Kubernetes                     | A `CronJob` on the application image, same command                   |
| Plain Docker on a host         | The host crontab, calling `docker compose exec` (below)              |

```cron
# monthly, 03:00 on the first — audit volume does not justify a nightly pass
0 3 1 * * cd /path/to/deployment && docker compose exec -T <app service> pnpm audit:prune:prod >> /var/log/audit-prune.log 2>&1
```

Monthly is deliberate. A retention window measured in years does not need a daily job, and a rarely-running
task that deletes rows is easier to reason about than a frequent one.

Retention is a legal decision, not a technical one: an audit trail that expires before an incident is
investigated is worse than useless, and one kept forever is its own liability.

## Reading the log

```sql
-- everything about one account
SELECT created_at, action, actor_user_id, ip_address, metadata
  FROM audit_events WHERE subject_id = '<user id>' ORDER BY created_at DESC;

-- everything one operator did
SELECT created_at, action, subject_type, subject_id, metadata
  FROM audit_events WHERE actor_user_id = '<admin id>' ORDER BY created_at DESC;

-- administrative activity in the last day
SELECT * FROM audit_events
 WHERE action LIKE 'admin.%' AND created_at > now() - interval '1 day'
 ORDER BY created_at DESC;
```

A `null` actor means the system acted: a scheduled job, a CLI, or an unauthenticated attempt.
