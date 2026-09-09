import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEvent } from './entities/audit-event.entity';
import { AuditService } from './services/audit.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
