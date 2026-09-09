// * The catalogue of permissions this codebase actually enforces. A permission is meaningful only because
// * some route declares it via @RequirePermission, so the enum — not the database — is the source of truth.
// * Roles and role→permission grants are data (managed from the admin API); the permissions themselves are code.
// * Adding a value here makes it available to grant after the next boot; removing one retires it (see
// * PermissionSyncService), it is never silently dropped from existing roles.
export enum Permission {
  UsersRead = 'users:read',
  UsersWrite = 'users:write',
  UsersSuspend = 'users:suspend',
  UserSessionsRevoke = 'user-sessions:revoke',
  RolesRead = 'roles:read',
  RolesWrite = 'roles:write',
  RolesAssign = 'roles:assign',
  AuditRead = 'audit:read',
  FeatureFlagsRead = 'feature-flags:read',
  FeatureFlagsWrite = 'feature-flags:write',
}

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  [Permission.UsersRead]: 'List and view user accounts.',
  [Permission.UsersWrite]: 'Change a user account profile.',
  [Permission.UsersSuspend]: 'Suspend and restore user accounts.',
  [Permission.UserSessionsRevoke]: "Terminate another user's sessions.",
  [Permission.RolesRead]: 'List roles and their permissions.',
  [Permission.RolesWrite]: 'Create, edit and delete roles.',
  [Permission.RolesAssign]: 'Grant and revoke roles on a user.',
  [Permission.AuditRead]: 'Read the audit log.',
  [Permission.FeatureFlagsRead]: 'List feature flags and their state.',
  [Permission.FeatureFlagsWrite]: 'Create, toggle and delete feature flags.',
};
