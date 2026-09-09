import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../entities/user.entity';
import { MfaCredential } from './entities/mfa-credential.entity';
import { MfaController } from './mfa.controller';
import { MfaService } from './services/mfa.service';

@Module({
  imports: [TypeOrmModule.forFeature([MfaCredential, User])],
  controllers: [MfaController],
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
