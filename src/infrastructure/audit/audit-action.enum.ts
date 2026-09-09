// * The catalogue of auditable events. Named `<area>.<subject>.<past-tense verb>` so a prefix filter answers
// * "everything that happened to sessions" or "everything an admin did" without a schema change.
export enum AuditAction {
  // Identity & security events, recorded for the account they concern.
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

  // Administrative mutations, recorded for the actor who performed them.
  AdminUserSuspended = 'admin.user.suspended',
  AdminUserRestored = 'admin.user.restored',
  AdminUserSessionsRevoked = 'admin.user.sessions_revoked',
  AdminRoleGranted = 'admin.role.granted',
  AdminRoleRevoked = 'admin.role.revoked',
  AdminRoleCreated = 'admin.role.created',
  AdminRoleUpdated = 'admin.role.updated',
  AdminRoleDeleted = 'admin.role.deleted',
}

export enum AuditSubjectType {
  User = 'user',
  Role = 'role',
  Session = 'session',
}
