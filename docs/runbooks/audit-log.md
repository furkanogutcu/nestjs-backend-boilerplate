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

Pruning is a standalone task, not an in-process job — the application must not hold delete rights here.

```bash
pnpm audit:prune                      # uses AUDIT_RETENTION_DAYS (default 365)
pnpm audit:prune --older-than-days=90 # explicit window
```

It connects with `MIGRATION_DATABASE_URL`. Schedule it from your deployment platform (a cron container, a
scheduled job, or the host's crontab). Nothing runs it automatically.

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
