import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Repository } from 'typeorm';

import { AuditAction } from '@infrastructure/audit/audit-action.enum';
import { AuditEvent } from '@infrastructure/audit/entities/audit-event.entity';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';

import { OAuthAccount } from '../../entities/oauth-account.entity';
import { Session } from '../../entities/session.entity';
import { User } from '../../entities/user.entity';
import { MfaCredential } from '../../mfa/entities/mfa-credential.entity';
import { Role } from '../../rbac/entities/role.entity';
import { UserRole } from '../../rbac/entities/user-role.entity';
import { DataExportService } from './data-export.service';

const AT = new Date('2026-01-01T00:00:00.000Z');

describe('DataExportService', () => {
  let users: DeepMocked<Repository<User>>;
  let sessions: DeepMocked<Repository<Session>>;
  let oauthAccounts: DeepMocked<Repository<OAuthAccount>>;
  let userRoles: DeepMocked<Repository<UserRole>>;
  let roles: DeepMocked<Repository<Role>>;
  let mfaCredentials: DeepMocked<Repository<MfaCredential>>;
  let auditEvents: DeepMocked<Repository<AuditEvent>>;
  let auditService: DeepMocked<AuditService>;
  let service: DataExportService;

  beforeEach(() => {
    users = createMock<Repository<User>>();
    sessions = createMock<Repository<Session>>();
    oauthAccounts = createMock<Repository<OAuthAccount>>();
    userRoles = createMock<Repository<UserRole>>();
    roles = createMock<Repository<Role>>();
    mfaCredentials = createMock<Repository<MfaCredential>>();
    auditEvents = createMock<Repository<AuditEvent>>();
    auditService = createMock<AuditService>();

    users.findOne.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      displayName: 'Nova',
      isAnonymous: false,
      emailVerifiedAt: AT,
      suspendedAt: null,
      deletionRequestedAt: null,
      lastSeenAt: null,
      createdAt: AT,
    } as User);
    sessions.find.mockResolvedValue([]);
    oauthAccounts.find.mockResolvedValue([]);
    userRoles.find.mockResolvedValue([]);
    mfaCredentials.findOne.mockResolvedValue(null);
    auditEvents.find.mockResolvedValue([]);

    service = new DataExportService(
      users,
      sessions,
      oauthAccounts,
      userRoles,
      roles,
      mfaCredentials,
      auditEvents,
      auditService,
    );
  });

  it('fails for an unknown account', async () => {
    users.findOne.mockResolvedValue(null);

    await expect(service.export({ userId: 'ghost' })).rejects.toBeInstanceOf(AppNotFoundException);
  });

  it('includes the account record in wire format', async () => {
    await expect(service.export({ userId: 'u1' })).resolves.toMatchObject({
      account: { id: 'u1', email: 'user@example.com', created_at: AT.toISOString() },
    });
  });

  it('never exports refresh-token material with the sessions', async () => {
    sessions.find.mockResolvedValue([
      {
        id: 's1',
        tokenHash: 'a-secret-hash',
        createdAt: AT,
        expiresAt: AT,
        revokedAt: null,
        userAgent: 'browser',
      } as unknown as Session,
    ]);

    const result = await service.export({ userId: 'u1' });

    expect(result.sessions[0]).toEqual({
      id: 's1',
      created_at: AT.toISOString(),
      expires_at: AT.toISOString(),
      revoked_at: null,
      user_agent: 'browser',
    });
    expect(JSON.stringify(result)).not.toContain('a-secret-hash');
  });

  it('never exports the MFA secret or recovery codes', async () => {
    mfaCredentials.findOne.mockResolvedValue({
      userId: 'u1',
      secret: 'TOTPSECRET',
      confirmedAt: AT,
      recoveryCodeHashes: ['hash-1'],
    } as MfaCredential);

    const result = await service.export({ userId: 'u1' });

    expect(result.multi_factor).toEqual({ enabled: true, confirmed_at: AT.toISOString() });
    expect(JSON.stringify(result)).not.toContain('TOTPSECRET');
    expect(JSON.stringify(result)).not.toContain('hash-1');
  });

  it('reports no MFA section when the account never enrolled', async () => {
    await expect(service.export({ userId: 'u1' })).resolves.toMatchObject({ multi_factor: null });
  });

  it('lists the roles the account holds', async () => {
    userRoles.find.mockResolvedValue([{ roleId: 'r1' } as UserRole]);
    roles.find.mockResolvedValue([{ id: 'r1', name: 'support' } as Role]);

    await expect(service.export({ userId: 'u1' })).resolves.toMatchObject({ roles: ['support'] });
  });

  it('includes the security events recorded about the account', async () => {
    auditEvents.find.mockResolvedValue([
      { action: 'auth.login.succeeded', createdAt: AT, ipAddress: '203.0.113.7' } as AuditEvent,
    ]);

    await expect(service.export({ userId: 'u1' })).resolves.toMatchObject({
      security_events: [{ action: 'auth.login.succeeded', at: AT.toISOString(), ip_address: '203.0.113.7' }],
    });
  });

  it('records that an export was produced', async () => {
    await service.export({ userId: 'u1' });

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AccountDataExported }),
    );
  });
});
