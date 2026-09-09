# Dokploy deployment runbook

How this backend is deployed to a Netcup VPS via Dokploy.
Use together with `database-backup.md` for post-deploy backup bootstrap.

## Two-project pattern

Dokploy deploys **two separate projects** that share the `dokploy-network`:

| Project       | Type        | Source                          | Env file             |
| ------------- | ----------- | ------------------------------- | -------------------- |
| `<app>-infra` | Compose     | `docker-compose.production.yml` | `.env.deploy.sample` |
| `<app>`       | Application | `Dockerfile`                    | `.env.sample`        |

### Why two projects

- **Different release cadences.** The Node app is redeployed on every push; the infra (DB, Redis,
  PgBouncer, pgBackRest, exporters) almost never is. Separating them ensures app deploys do
  not recreate the stateful containers.
- **Blast radius.** A bad app build can be rolled back without touching the database stack. A risky
  infra change (e.g. a Postgres bump) is its own planned, reviewed deploy.
- **Separation of concerns.** App config (`.env.sample` — validated by `src/config/env.schema.ts`)
  and infra config (`.env.deploy.sample` — consumed by Docker Compose) each stay in their own
  scope.

> **Alternative (single-stack):** Add an `app:` service to `docker-compose.production.yml` and run a
> single Dokploy Compose project. Simpler env management, atomic deploys — at the cost of
> redeploying the infra on every code push as well. Choose this only when release cadence does not
> matter (early prototype, internal tool).

## Order matters

Infra first, then app. The app's entrypoint runs `migration:run` at boot — if Postgres is not up,
the container enters a crash loop.

## Step 1 — Infra (Compose project)

1. **Create the project:** Dokploy → "Create Project" → **Compose**.
2. **Source:** point to this repo, branch `main`, compose path
   `docker-compose.production.yml`.
3. **Environment:** copy every variable from `.env.deploy.sample` into the Environment panel with
   its real values.
   - Memory/CPU limits: tune to the VPS specs (the `Example:` values in the file are starting points
     for a 4 vCPU / 8 GiB Netcup VPS).
   - Passwords: generate them with the `openssl` commands shown in the comments.
   - **`BACKUP_ENCRYPTION_PASSPHRASE`:** store a copy in your password manager as well. If it is
     lost, every backup in R2 becomes unrecoverable.

4. **Deploy.** Wait until every service is `healthy` (Dokploy → Containers).
5. **pgBackRest bootstrap** (one-time, only after the first infra deploy):

   ```bash
   docker compose -f docker-compose.production.yml exec pgbackrest \
     pgbackrest --stanza=main stanza-create
   docker compose -f docker-compose.production.yml exec pgbackrest \
     pgbackrest --stanza=main check
   docker compose -f docker-compose.production.yml exec pgbackrest \
     pgbackrest --stanza=main backup --type=full
   ```

   See `database-backup.md` for details.

## Step 2 — App (Application project)

1. **Create the project:** Dokploy → "Create Project" → **Application**.
2. **Source:** same repo / branch. Build type: **Dockerfile**, path: `Dockerfile`.
3. **Environment:** copy every variable from `.env.sample` into the Environment panel. The
   connection-string variables must point to the containers in the infra project via their
   `container_name`:

   ```bash
   # Assuming APP_NAME=app-prod in the infra env
   DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@app-prod-pgbouncer:6432/<POSTGRES_DB>
   MIGRATION_DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@app-prod-db:5432/<POSTGRES_DB>
   REDIS_URL=redis://default:<REDIS_PASSWORD>@app-prod-redis:6379/0
   ```

   The credentials in these URLs must match the values set in the infra project's env (the same
   Postgres user, the same Redis password — here only cast into URI form).

4. **Network:** Dokploy automatically attaches Application projects to `dokploy-network`. No manual
   config is required.
5. **Domain & TLS:** Dokploy → Domains tab → add your public hostname. Traefik terminates TLS; the
   app stays behind it on plain HTTP. The HTTP timeout envs (`HTTP_KEEP_ALIVE_TIMEOUT_MS` > Traefik
   backend idle) are already set for this.

   > **Close the readiness probe at the edge.** `/health/ready` (and `/api/v1/health/ready`) reflects
   > dependency (DB/Redis) health; if left publicly exposed it signals the timing of a
   > dependency outage to the outside (the body is only `ok`/`error`, but that is still information).
   > Block this path from external hosts in Traefik (e.g. a middleware returning 403/404 for the
   > path-prefixes `/health/ready` and `/api/v1/health/ready`), so it is reachable only from the
   > orchestrator/internal network. **Liveness** (`/health`, `/api/v1/health`) only says "the process
   > is up" and may stay open.

6. **Deploy.** The container runs `docker-entrypoint.sh` →
   `migration:run` (against `MIGRATION_DATABASE_URL`, directly to PG) → `node dist/main`.

## Verifying the deploy

```bash
# Are all containers healthy?
docker ps --format '{{.Names}}\t{{.Status}}' | grep <APP_NAME>

# App readiness endpoint — if closed at the edge (Step 2.5), run it from the internal network
# (no curl/wget in the slim image; same node fetch pattern as the Dockerfile healthcheck)
docker exec <APP_NAME> node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/ready').then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
# Only liveness stays open from outside:
curl -fsS https://<your-domain>/api/v1/health

# Is traffic going through PgBouncer (the app's sessions should show up as 'pgbouncer')
docker exec <APP_NAME>-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
  -c "SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1;"

# Metrics scrape targets
curl -fsS http://10.0.0.1:9187/metrics | head        # postgres_exporter
curl -fsS http://10.0.0.1:9127/metrics | head        # pgbouncer_exporter
```

## Updates

| What changed                         | What to redeploy                   |
| ------------------------------------ | ---------------------------------- |
| App code only                        | App project only                   |
| `docker-compose.production.yml`      | Infra project only                 |
| `Dockerfile` (postgres custom)       | Infra project (rebuild)            |
| `docker/pgbouncer/pgbouncer.ini`     | Infra project (pgbouncer recreate) |
| App `.env.sample` variables          | App project env panel              |
| Infra `.env.deploy.sample` variables | Infra project env panel            |

## Rollback

- **App:** Dokploy keeps the previous build — one-click rollback from the Deployments tab.
- **Infra:** stateful. For stateless changes, container rollback is seamless (PgBouncer, exporters).
  For Postgres (image bump, postgresql.conf change), always test the rollback path on a restored
  backup before deploying. See `database-restore.md`.

## Common issues

| Symptom                                             | Likely cause                                                   |
| --------------------------------------------------- | -------------------------------------------------------------- |
| App crash-looping on first deploy                   | Infra has not come up yet, or DB credentials do not match      |
| `dial tcp: lookup <APP_NAME>-db: no such host`      | App is on a different network, or `container_name` mismatch    |
| pgBackRest sidecar `no stanza` error                | Step 1.5 skipped (`stanza-create`)                             |
| App connections go directly to PG, not to PgBouncer | `DATABASE_URL` points to port 5432 instead of `pgbouncer:6432` |
| `Encryption passphrase mismatch` on restore         | Wrong `BACKUP_ENCRYPTION_PASSPHRASE` for the restored backup   |
