import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEvent } from './entities/audit-event.entity';
import { AuditService } from './services/audit.service';

// * Global: auditing is cross-cutting, and threading an import through every module that records an event
// * would couple unrelated modules to the audit layer.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
