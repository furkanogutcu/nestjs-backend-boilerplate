import { Logger } from '@nestjs/common';

import type { IMailMessage } from '@shared/interfaces/mail-transport.interface';

import { LogMailTransport } from './log-mail.transport';

const message: IMailMessage = {
  from: 'App <no-reply@app.test>',
  to: 'user@app.test',
  subject: 'Welcome',
  html: '<p>Hi</p>',
};

describe('LogMailTransport', () => {
  it('logs the outgoing mail and returns a null id without sending', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const transport = new LogMailTransport();

    const result = await transport.send({ message });

    expect(result).toEqual({ id: null });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user@app.test'));
  });
});
