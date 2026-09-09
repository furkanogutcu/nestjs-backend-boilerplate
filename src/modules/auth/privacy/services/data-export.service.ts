import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditAction, AuditSubjectType } from '@infrastructure/audit/audit-action.enum';
import { AuditEvent } from '@infrastructure/audit/entities/audit-event.entity';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';

import { OAuthAccount } from '../../entities/oauth-account.entity';
import { Session } from '../../entities/session.entity';
import { User } from '../../entities/user.entity';
import { MfaCredential } from '../../mfa/entities/mfa-credential.entity';
import { Role } from '../../rbac/entities/role.entity';
import { UserRole } from '../../rbac/entities/user-role.entity';

// * The shape handed to the person: their own record, everything linked to it, and the security events recorded
// * about them. Deliberately free of anything that would let the export itself be used to impersonate them.
export interface IDataExport {
  exported_at: string;
  account: Record<string, unknown>;
  sessions: Record<string, unknown>[];
  linked_providers: Record<string, unknown>[];
  roles: string[];
  multi_factor: Record<string, unknown> | null;
  security_events: Record<string, unknown>[];
}

const SECURITY_EVENT_LIMIT = 1000;

@Injectable()
export class DataExportService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(OAuthAccount) private readonly oauthAccounts: Repository<OAuthAccount>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(MfaCredential) private readonly mfaCredentials: Repository<MfaCredential>,
    @InjectRepository(AuditEvent) private readonly auditEvents: Repository<AuditEvent>,
    private readonly auditService: AuditService,
  ) {}

  async export({ userId }: { userId: string }): Promise<IDataExport> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new AppNotFoundException({ resourceName: 'User' });
    }

    const [sessions, providers, assignments, mfa, events] = await Promise.all([
      this.sessions.find({ where: { userId }, order: { createdAt: 'DESC' } }),
      this.oauthAccounts.find({ where: { userId } }),
      this.userRoles.find({ where: { userId } }),
      this.mfaCredentials.findOne({ where: { userId } }),
      this.auditEvents.find({
        where: { subjectId: userId },
        order: { createdAt: 'DESC' },
        take: SECURITY_EVENT_LIMIT,
      }),
    ]);

    const roles = assignments.length
      ? await this.roles.find({ where: assignments.map((assignment) => ({ id: assignment.roleId })) })
      : [];

    await this.auditService.record({
      action: AuditAction.AccountDataExported,
      actorUserId: userId,
      subjectType: AuditSubjectType.User,
      subjectId: userId,
    });

    return {
      exported_at: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        is_anonymous: user.isAnonymous,
        email_verified_at: user.emailVerifiedAt?.toISOString() ?? null,
        suspended_at: user.suspendedAt?.toISOString() ?? null,
        deletion_requested_at: user.deletionRequestedAt?.toISOString() ?? null,
        last_seen_at: user.lastSeenAt?.toISOString() ?? null,
        created_at: user.createdAt.toISOString(),
      },
      // ! Never the token hash: a refresh-token hash plus the pepper is a credential, and an export is a file
      // ! that ends up in inboxes and cloud drives.
      sessions: sessions.map((session) => ({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
        revoked_at: session.revokedAt?.toISOString() ?? null,
        user_agent: session.userAgent,
      })),
      linked_providers: providers.map((provider) => ({
        provider: provider.provider,
        email: provider.email,
        linked_at: provider.createdAt.toISOString(),
      })),
      roles: roles.map((role) => role.name),
      // ! The TOTP secret and the recovery-code hashes are second-factor credentials and never leave the server.
      multi_factor: mfa
        ? { enabled: mfa.confirmedAt !== null, confirmed_at: mfa.confirmedAt?.toISOString() ?? null }
        : null,
      security_events: events.map((event) => ({
        action: event.action,
        at: event.createdAt.toISOString(),
        ip_address: event.ipAddress,
      })),
    };
  }
}
