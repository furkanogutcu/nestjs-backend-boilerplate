import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountDeletion1788970880351 implements MigrationInterface {
  name = 'AccountDeletion1788970880351';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "deletion_requested_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletion_requested_at"`);
  }
}
