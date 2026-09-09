import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import type { MockedFunction } from 'vitest';

import { AppInternalException } from '@shared/exceptions/internal.exception';
import type { IMailTransport } from '@shared/interfaces/mail-transport.interface';

import { MailService } from './mail.service';
import type { MailSuppressionRepository } from './repositories/mail-suppression.repository';
import { ISendMailParams } from './schemas/send-mail.schema';

vi.mock('fs/promises');
// * env.config validates process.env on import and calls process.exit on failure, killing the Jest worker; mock it
// * with the only fields MailService reads (the from header).
vi.mock('@config/env.config', () => ({
  env: { MAIL_FROM_NAME: 'App', MAIL_FROM: 'no-reply@app.test' },
}));

const readdirMock = readdir as MockedFunction<typeof readdir>;
const readFileMock = readFile as MockedFunction<typeof readFile>;

const payload: ISendMailParams = {
  to: 'user@app.test',
  subject: 'Welcome',
  template: 'welcome',
  context: { name: 'Furkan' },
};

describe('MailService', () => {
  let transport: DeepMocked<IMailTransport>;
  let suppressionRepository: DeepMocked<MailSuppressionRepository>;
  let service: MailService;

  beforeEach(() => {
    transport = createMock<IMailTransport>();
    transport.send.mockResolvedValue({ id: 'resend-message-id' });
    suppressionRepository = createMock<MailSuppressionRepository>();
    suppressionRepository.isSuppressed.mockResolvedValue(false);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new MailService(transport, suppressionRepository);
  });

  describe('send', () => {
    it('throws when the requested template is not loaded', async () => {
      await expect(service.send({ payload })).rejects.toBeInstanceOf(AppInternalException);
    });

    it('renders the template and sends it through the transport with the configured sender', async () => {
      readdirMock.mockResolvedValue(['welcome.hbs', 'notes.txt'] as never);
      readFileMock.mockResolvedValue('Hello {{name}}');

      await service.onModuleInit();
      await service.send({ payload, idempotencyKey: 'job-1' });

      expect(transport.send).toHaveBeenCalledWith({
        message: {
          from: 'App <no-reply@app.test>',
          to: 'user@app.test',
          subject: 'Welcome',
          html: 'Hello Furkan',
        },
        idempotencyKey: 'job-1',
      });
    });

    it('skips the transport entirely when the recipient is on the suppression list', async () => {
      readdirMock.mockResolvedValue(['welcome.hbs'] as never);
      readFileMock.mockResolvedValue('Hello {{name}}');
      await service.onModuleInit();
      suppressionRepository.isSuppressed.mockResolvedValue(true);

      await service.send({ payload });

      expect(transport.send).not.toHaveBeenCalled();
    });

    it('sends security-critical mail even to a suppressed address (recovery mail is never blocked)', async () => {
      readdirMock.mockResolvedValue(['welcome.hbs'] as never);
      readFileMock.mockResolvedValue('Hello {{name}}');
      await service.onModuleInit();
      suppressionRepository.isSuppressed.mockResolvedValue(true);

      await service.send({ payload, securityCritical: true });

      expect(transport.send).toHaveBeenCalled();
    });

    it('rethrows when the transport fails to send the mail', async () => {
      readdirMock.mockResolvedValue(['welcome.hbs'] as never);
      readFileMock.mockResolvedValue('Hello {{name}}');
      await service.onModuleInit();
      transport.send.mockRejectedValue(new Error('resend 500'));

      await expect(service.send({ payload })).rejects.toThrow('resend 500');
    });

    it('still sends when the recipient address has no domain part', async () => {
      readdirMock.mockResolvedValue(['welcome.hbs'] as never);
      readFileMock.mockResolvedValue('Hello {{name}}');
      await service.onModuleInit();

      // * Defensive: the recipient-domain telemetry attribute falls back to '' for an address without '@'.
      await service.send({ payload: { ...payload, to: 'no-domain' } });

      expect(transport.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.objectContaining({ to: 'no-domain' }) }),
      );
    });
  });

  describe('onModuleInit', () => {
    it('warns and loads no templates when the directory is missing', async () => {
      readdirMock.mockRejectedValue(new Error('ENOENT'));

      await service.onModuleInit();

      expect(Logger.prototype.warn).toHaveBeenCalled();
      await expect(service.send({ payload })).rejects.toBeInstanceOf(AppInternalException);
    });
  });
});
