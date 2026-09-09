import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEvent } from '@infrastructure/audit/entities/audit-event.entity';
import { AppQueue } from '@shared/enums/queue.enum';

import { AuthModule } from '../auth.module';
import { OAuthAccount } from '../entities/oauth-account.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { MfaCredential } from '../mfa/entities/mfa-credential.entity';
import { Role } from '../rbac/entities/role.entity';
import { UserRole } from '../rbac/entities/user-role.entity';
import { AccountErasureProcessor } from './jobs/account-erasure.processor';
import { PrivacyController } from './privacy.controller';
import { AccountDeletionService } from './services/account-deletion.service';
import { DataExportService } from './services/data-export.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session, OAuthAccount, UserRole, Role, MfaCredential, AuditEvent]),
    BullModule.registerQueue({ name: AppQueue.AccountErasure }),
    AuthModule,
  ],
  controllers: [PrivacyController],
  providers: [AccountDeletionService, DataExportService, AccountErasureProcessor],
  exports: [AccountDeletionService],
})
export class PrivacyModule {}
