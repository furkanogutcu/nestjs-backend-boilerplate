# Roles, permissions and the first administrator

## The model

**Permissions are code, roles are data.** A permission only means something because a route declares it with
`@RequirePermission`, so the `Permission` enum is the source of truth. Roles and their grants are rows,
managed from the admin API.

On every boot `PermissionSyncService`:

1. upserts every enum value into `permissions`,
2. **retires** (sets `retired_at`) anything no longer in the code — retired permissions are never granted,
   but existing grants are left alone rather than silently dropped,
3. re-grants every current permission to the `superuser` role.

## Creating the first administrator

```bash
pnpm admin:create --email=you@example.com
```

The account is created with the `superuser` role and **MFA already active**. The command prints, once:

- a temporary password (unless you pass `--password-stdin`),
- an `otpauth://` URI and the raw secret — scan or paste it into an authenticator app,
- ten recovery codes.

The account is flagged `must_change_password`; the API reports it on sign-in and the client should route the
user to a change-password flow.

To supply your own password without it landing in shell history:

```bash
printf '%s' 'the-password' | pnpm admin:create --email=you@example.com --password-stdin
```

## Adding a permission

1. Add the value to `Permission` in `src/modules/auth/rbac/permission.enum.ts` and describe it in
   `PERMISSION_DESCRIPTIONS`.
2. Declare it on the route: `@RequirePermission(Permission.YourThing)`.
3. Deploy. The boot sync inserts it and grants it to `superuser`.
4. Grant it to any other role from `PATCH /admin/roles/:roleId`.

Removing a permission is the reverse: delete the enum value and deploy. The row is retired, roles that held it
keep the (now inert) grant, and re-adding the permission later restores it.

## Day-to-day operations

| Task                         | Call                                            |
| ---------------------------- | ----------------------------------------------- |
| See what a role grants       | `GET /admin/roles/:roleId`                      |
| See the pick list            | `GET /admin/permissions`                        |
| Create a role                | `POST /admin/roles`                             |
| Replace a role's permissions | `PATCH /admin/roles/:roleId` with `permissions` |
| Grant a role to a user       | `POST /admin/users/:userId/roles`               |
| Revoke it                    | `DELETE /admin/users/:userId/roles/:roleId`     |

Every one of those is recorded in the audit log, and role changes invalidate the affected users' cached
permission sets immediately.

## Things the API will refuse

- **Editing or deleting the `superuser` role.** It is the way back in when role data is misconfigured.
- **Granting a retired permission.** It is not in the pick list and is rejected if sent anyway.

## If you are locked out

The `superuser` role always exists and always holds every permission. If no account holds it any more, create
a fresh administrator with `pnpm admin:create` — it needs only database access, not an existing session.
