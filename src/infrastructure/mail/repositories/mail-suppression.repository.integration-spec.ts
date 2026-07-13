import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { SnakeNamingStrategy } from '@database/strategies/snake-naming.strategy';
import { SCHEMA_MIGRATIONS } from '@test/helpers';

import { MailSuppression } from '../entities/mail-suppression.entity';
import { MailSuppressionReason } from '../enums/mail-suppression-reason.enum';
import { MailSuppressionRepository } from './mail-suppression.repository';

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

describe('MailSuppressionRepository (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let repository: MailSuppressionRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [MailSuppression],
      migrations: SCHEMA_MIGRATIONS,
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    repository = new MailSuppressionRepository(dataSource);
  }, 120_000);

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE "mail_suppressions"');
  });

  it('suppresses an address and reports it as suppressed, case-insensitively', async () => {
    await repository.suppress({ email: 'User@App.test', reason: MailSuppressionReason.Bounce, expiresAt: FUTURE });

    expect(await repository.isSuppressed('user@app.test')).toBe(true);
    expect(await repository.isSuppressed('USER@App.TEST')).toBe(true);
  });

  it('reports an unknown address as not suppressed', async () => {
    expect(await repository.isSuppressed('nobody@app.test')).toBe(false);
  });

  it('does not block once the suppression window has lapsed (recovery)', async () => {
    await repository.suppress({ email: 'lapsed@app.test', reason: MailSuppressionReason.Bounce, expiresAt: PAST });

    expect(await repository.isSuppressed('lapsed@app.test')).toBe(false);
  });

  it('refreshes the existing row on a repeat suppression (single row, latest reason and window)', async () => {
    await repository.suppress({ email: 'dupe@app.test', reason: MailSuppressionReason.Bounce, expiresAt: PAST });
    await repository.suppress({ email: 'dupe@app.test', reason: MailSuppressionReason.Complaint, expiresAt: FUTURE });

    expect(await repository.count()).toBe(1);

    const row = await repository.findOneByOrFail({ email: 'dupe@app.test' });
    expect(row.reason).toBe(MailSuppressionReason.Complaint);
    // * A lapsed suppression that re-bounces is re-blocked with a fresh window.
    expect(await repository.isSuppressed('dupe@app.test')).toBe(true);
  });

  it('persists the metadata payload', async () => {
    await repository.suppress({
      email: 'meta@app.test',
      reason: MailSuppressionReason.Complaint,
      expiresAt: FUTURE,
      metadata: { messageId: 'email-1' },
    });

    const row = await repository.findOneByOrFail({ email: 'meta@app.test' });

    expect(row.metadata).toEqual({ messageId: 'email-1' });
  });
});
