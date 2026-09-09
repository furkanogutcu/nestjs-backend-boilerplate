import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { User } from '../entities/user.entity';
import { ICredentialsResult } from './interfaces/credentials-result.interface';
import { PasswordController } from './password.controller';
import { PasswordService } from './password.service';

describe('PasswordController', () => {
  let passwordService: DeepMocked<PasswordService>;
  let controller: PasswordController;

  const credentials = (overrides: Partial<User> = {}): ICredentialsResult => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresInSeconds: 900,
    user: {
      id: 'u1',
      email: 'a@example.com',
      emailVerifiedAt: null,
      isAnonymous: false,
      ...overrides,
    } as User,
  });

  beforeEach(() => {
    passwordService = createMock<PasswordService>();
    controller = new PasswordController(passwordService);
  });

  describe('register', () => {
    it('delegates with the client user agent and maps the result to a snake_case token+user body', async () => {
      passwordService.register.mockResolvedValue(credentials());

      const body = await controller.register(
        { email: 'a@example.com', password: 'super-secret' },
        { userAgent: 'jest' },
      );

      expect(passwordService.register).toHaveBeenCalledWith({
        email: 'a@example.com',
        password: 'super-secret',
        userAgent: 'jest',
      });
      expect(body).toEqual({
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expires_in: 900,
        user: { id: 'u1', email: 'a@example.com', is_email_verified: false, is_anonymous: false },
      });
    });
  });

  describe('login', () => {
    it('reports is_email_verified true once emailVerifiedAt is set', async () => {
      passwordService.login.mockResolvedValue(credentials({ emailVerifiedAt: new Date() }));

      const body = await controller.login({ email: 'a@example.com', password: 'super-secret' }, {});

      expect(passwordService.login).toHaveBeenCalledWith({
        email: 'a@example.com',
        password: 'super-secret',
        userAgent: undefined,
      });
      expect(body.user.is_email_verified).toBe(true);
    });
  });

  it('verifyEmail delegates the token', async () => {
    await controller.verifyEmail({ token: 'tok' });

    expect(passwordService.verifyEmail).toHaveBeenCalledWith({ token: 'tok' });
  });

  it('resendVerification delegates the email', async () => {
    await controller.resendVerification({ email: 'a@example.com' });

    expect(passwordService.resendVerification).toHaveBeenCalledWith({ email: 'a@example.com' });
  });

  it('forgotPassword delegates the email', async () => {
    await controller.forgotPassword({ email: 'a@example.com' });

    expect(passwordService.forgotPassword).toHaveBeenCalledWith({ email: 'a@example.com' });
  });

  it('resetPassword delegates the token and password', async () => {
    await controller.resetPassword({ token: 'tok', password: 'new-super-secret' });

    expect(passwordService.resetPassword).toHaveBeenCalledWith({ token: 'tok', password: 'new-super-secret' });
  });
});
