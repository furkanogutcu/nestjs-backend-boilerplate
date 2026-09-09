import { createMock } from '@golevelup/ts-vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { SnakeNamingStrategy } from '@database/strategies/snake-naming.strategy';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { SCHEMA_MIGRATIONS } from '@test/helpers';

import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { SessionsRepository } from '../repositories/sessions.repository';
import { RevocationService } from './revocation.service';
import { SessionService } from './session.service';

describe('SessionService (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let service: SessionService;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [User, Session],
      migrations: SCHEMA_MIGRATIONS,
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    service = new SessionService(
      new SessionsRepository(dataSource),
      dataSource,
      createMock<RevocationService>(),
      new ClockService(),
      createMock<AuditService>(),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE "sessions", "users" CASCADE');
    const user = await dataSource.getRepository(User).save({ id: randomUUID(), isAnonymous: true });
    userId = user.id;
  });

  it('rotates a refresh token and revokes the previous session', async () => {
    const first = await service.issue({ userId, linked: false });
    const second = await service.rotate({ refreshToken: first.refreshToken });

    expect(second.session.id).not.toBe(first.session.id);
    expect(second.session.familyId).toBe(first.session.familyId);

    const previous = await dataSource.getRepository(Session).findOneByOrFail({ id: first.session.id });
    expect(previous.revokedAt).not.toBeNull();
    expect(previous.rotatedToId).toBe(second.session.id);

    await expect(service.rotate({ refreshToken: second.refreshToken })).resolves.toBeDefined();
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const first = await service.issue({ userId, linked: false });
    const second = await service.rotate({ refreshToken: first.refreshToken });

    await expect(service.rotate({ refreshToken: first.refreshToken })).rejects.toMatchObject({
      code: ExceptionCode.RefreshTokenReuseDetected,
    });

    const successor = await dataSource.getRepository(Session).findOneByOrFail({ id: second.session.id });
    expect(successor.revokedAt).not.toBeNull();

    await expect(service.rotate({ refreshToken: second.refreshToken })).rejects.toMatchObject({
      code: ExceptionCode.RefreshTokenReuseDetected,
    });
  });

  it('serializes two concurrent rotations of the same token: one wins, the other is flagged as reuse', async () => {
    const issued = await service.issue({ userId, linked: false });

    const results = await Promise.allSettled([
      service.rotate({ refreshToken: issued.refreshToken }),
      service.rotate({ refreshToken: issued.refreshToken }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: ExceptionCode.RefreshTokenReuseDetected });

    const original = await dataSource.getRepository(Session).findOneByOrFail({ id: issued.session.id });
    expect(original.revokedAt).not.toBeNull();
  });

  it('rejects unknown and malformed refresh tokens', async () => {
    await expect(service.rotate({ refreshToken: 'not-a-refresh-token' })).rejects.toMatchObject({
      code: ExceptionCode.InvalidRefreshToken,
    });
    await expect(service.rotate({ refreshToken: `${randomUUID()}.deadbeef` })).rejects.toMatchObject({
      code: ExceptionCode.InvalidRefreshToken,
    });
  });

  it('revokes a session on logout so it can no longer be rotated', async () => {
    const issued = await service.issue({ userId, linked: false });

    await service.revoke({ sessionId: issued.session.id });

    const revoked = await dataSource.getRepository(Session).findOneByOrFail({ id: issued.session.id });
    expect(revoked.revokedAt).not.toBeNull();

    await expect(service.rotate({ refreshToken: issued.refreshToken })).rejects.toMatchObject({
      code: ExceptionCode.RefreshTokenReuseDetected,
    });
  });

  it('anchors an absolute chain deadline for linked accounts but leaves guests capless', async () => {
    const linked = await service.issue({ userId, linked: true });
    const storedLinked = await dataSource.getRepository(Session).findOneByOrFail({ id: linked.session.id });
    expect(storedLinked.chainExpiresAt).not.toBeNull();

    const guest = await service.issue({ userId, linked: false });
    const storedGuest = await dataSource.getRepository(Session).findOneByOrFail({ id: guest.session.id });
    expect(storedGuest.chainExpiresAt).toBeNull();
  });

  it('carries the chain deadline across rotation and lets it kill the chain once reached', async () => {
    const issued = await service.issue({ userId, linked: true });

    // * Simulate the chain nearing its absolute deadline; the successor's idle window clamps to it.
    const nearDeadline = new Date(Date.now() + 1000);
    await dataSource.getRepository(Session).update({ id: issued.session.id }, { chainExpiresAt: nearDeadline });

    const rotated = await service.rotate({ refreshToken: issued.refreshToken });
    const successor = await dataSource.getRepository(Session).findOneByOrFail({ id: rotated.session.id });
    expect(successor.chainExpiresAt?.getTime()).toBe(nearDeadline.getTime());
    expect(successor.expiresAt.getTime()).toBe(nearDeadline.getTime());

    const past = new Date(Date.now() - 1000);
    await dataSource.getRepository(Session).update({ id: successor.id }, { chainExpiresAt: past, expiresAt: past });
    await expect(service.rotate({ refreshToken: rotated.refreshToken })).rejects.toMatchObject({
      code: ExceptionCode.InvalidRefreshToken,
    });
  });
});
