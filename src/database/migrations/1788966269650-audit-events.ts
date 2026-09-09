import { parse } from 'pg-connection-string';
import { MigrationInterface, QueryRunner } from 'typeorm';

import { env } from '@config/env.config';

// ! Revoking UPDATE/DELETE from the app role is what makes the trail unrewritable by a compromised application.
function applicationRoleToRestrict(): string | null {
  const applicationRole = parse(env.DATABASE_URL).user;
  const migrationRole = parse(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL).user;

  if (!applicationRole || applicationRole === migrationRole) {
    return null;
  }

  return applicationRole;
}

export class AuditEvents1788966269650 implements MigrationInterface {
  name = 'AuditEvents1788966269650';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_events" ("id" uuid NOT NULL, "action" character varying(100) NOT NULL, "actor_user_id" uuid, "subject_type" character varying(50), "subject_id" character varying(100), "metadata" jsonb, "ip_address" character varying(45), "request_id" character varying(100), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_910f64d901a5c3e9878f0d4a407" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_68d908019304f757740bc47a0a" ON "audit_events"  ("action") `);
    await queryRunner.query(`CREATE INDEX "IDX_da4e1f7755a2ab9a8b7ddefaa4" ON "audit_events"  ("actor_user_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_497bb4f7c4c55db9749616cd2a" ON "audit_events"  ("created_at") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_9eeb643969c6d7ef210de88355" ON "audit_events"  ("subject_type", "subject_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'::jsonb`,
    );

    const restrictedRole = applicationRoleToRestrict();

    if (restrictedRole) {
      await queryRunner.query(`REVOKE UPDATE, DELETE ON "audit_events" FROM "${restrictedRole}"`);
    } else {
      console.warn(
        '[audit] DATABASE_URL and MIGRATION_DATABASE_URL share a role; append-only protection was not applied.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const restrictedRole = applicationRoleToRestrict();

    if (restrictedRole) {
      await queryRunner.query(`GRANT UPDATE, DELETE ON "audit_events" TO "${restrictedRole}"`);
    }

    await queryRunner.query(`ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9eeb643969c6d7ef210de88355"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_497bb4f7c4c55db9749616cd2a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_da4e1f7755a2ab9a8b7ddefaa4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_68d908019304f757740bc47a0a"`);
    await queryRunner.query(`DROP TABLE "audit_events"`);
  }
}
