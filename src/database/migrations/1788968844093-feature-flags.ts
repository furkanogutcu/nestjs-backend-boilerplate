import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeatureFlags1788968844093 implements MigrationInterface {
  name = 'FeatureFlags1788968844093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "feature_flags" ("key" character varying(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "description" character varying(255), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_36d0344370584b4d6a953c53a69" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'`);
    await queryRunner.query(`DROP TABLE "feature_flags"`);
  }
}
