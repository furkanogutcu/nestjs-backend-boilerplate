export enum AuditAction {
  AuthLoginSucceeded = 'auth.login.succeeded',
  AuthLoginFailed = 'auth.login.failed',
  AuthLogout = 'auth.logout',
  AuthPasswordChanged = 'auth.password.changed',
  AuthPasswordResetRequested = 'auth.password.reset_requested',
  AuthPasswordResetCompleted = 'auth.password.reset_completed',
  AuthEmailVerified = 'auth.email.verified',
  AuthOauthLinked = 'auth.oauth.linked',
  AuthSessionRevoked = 'auth.session.revoked',
  AuthMfaEnabled = 'auth.mfa.enabled',
  AuthMfaDisabled = 'auth.mfa.disabled',
  AccountDeletionRequested = 'account.deletion.requested',
  AccountDeletionCancelled = 'account.deletion.cancelled',
  AccountErased = 'account.erased',
  AccountDataExported = 'account.data.exported',

  AdminUserSuspended = 'admin.user.suspended',
  AdminUserRestored = 'admin.user.restored',
  AdminUserSessionsRevoked = 'admin.user.sessions_revoked',
  AdminRoleGranted = 'admin.role.granted',
  AdminRoleRevoked = 'admin.role.revoked',
  AdminRoleCreated = 'admin.role.created',
  AdminRoleUpdated = 'admin.role.updated',
  AdminRoleDeleted = 'admin.role.deleted',
  PostRemovedByModerator = 'admin.post.removed',
}

export enum AuditSubjectType {
  User = 'user',
  Role = 'role',
  Session = 'session',
  Post = 'post',
}
