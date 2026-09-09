import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseModule } from '@infrastructure/database/database.module';

import { AuthController } from './auth.controller';
import { OAuthAccount } from './entities/oauth-account.entity';
import { Session } from './entities/session.entity';
import { User } from './entities/user.entity';
import { AuthGuard } from './guards/auth.guard';
import { RefreshCookieInterceptor } from './interceptors/refresh-cookie.interceptor';
import { MfaModule } from './mfa/mfa.module';
import { OAuthController } from './oauth/oauth.controller';
import { AppleTokenVerifier } from './oauth/services/apple-token-verifier.service';
import { GameCenterVerifier } from './oauth/services/game-center-verifier.service';
import { GoogleTokenVerifier } from './oauth/services/google-token-verifier.service';
import { OAuthService } from './oauth/services/oauth.service';
import { PlayGamesVerifier } from './oauth/services/play-games-verifier.service';
import { PasswordController } from './password/password.controller';
import { PasswordService } from './password/password.service';
import { PasswordStrengthService } from './password/password-strength.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { RbacModule } from './rbac/rbac.module';
import { OAuthAccountsRepository } from './repositories/oauth-accounts.repository';
import { SessionsRepository } from './repositories/sessions.repository';
import { UsersRepository } from './repositories/users.repository';
import { AuthService } from './services/auth.service';
import { RevocationService } from './services/revocation.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Session, OAuthAccount]), DatabaseModule, RbacModule, MfaModule],
  controllers: [AuthController, OAuthController, PasswordController, ProfileController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    RevocationService,
    OAuthService,
    PasswordService,
    PasswordStrengthService,
    ProfileService,
    GoogleTokenVerifier,
    AppleTokenVerifier,
    GameCenterVerifier,
    PlayGamesVerifier,
    UsersRepository,
    SessionsRepository,
    OAuthAccountsRepository,
    AuthGuard,
    RefreshCookieInterceptor,
  ],
  exports: [TokenService, RevocationService, AuthGuard, SessionService],
})
export class AuthModule {}
