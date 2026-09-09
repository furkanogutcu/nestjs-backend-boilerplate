// ! The enum is the source of truth, not the database: removing a value retires it rather than dropping it from roles.
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
  PostsModerate = 'posts:moderate',
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
  [Permission.PostsModerate]: "Remove any user's post.",
};
