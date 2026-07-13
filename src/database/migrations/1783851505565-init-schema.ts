import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1783851505565 implements MigrationInterface {
  name = 'InitSchema1783851505565';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL, "email" character varying, "password_hash" character varying, "email_verified_at" TIMESTAMP WITH TIME ZONE, "display_name" character varying, "is_anonymous" boolean NOT NULL DEFAULT true, "last_seen_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3be5894c040bc2b1930b041262" ON "users"  ("email") WHERE email IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "oauth_accounts" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "provider" character varying NOT NULL, "provider_user_id" character varying NOT NULL, "email" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_43effea36b32036537a94ab76f3" UNIQUE ("user_id", "provider"), CONSTRAINT "UQ_ea7720e04e3ae1278575c3159cf" UNIQUE ("provider", "provider_user_id"), CONSTRAINT "PK_710a81523f515b78f894e33bb10" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_22a05e92f51a983475f9281d3b" ON "oauth_accounts"  ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "family_id" uuid NOT NULL, "token_hash" character varying NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "rotated_to_id" uuid, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "chain_expires_at" TIMESTAMP WITH TIME ZONE, "user_agent" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_abaa9e068cdd390bc5210f79884" UNIQUE ("token_hash"), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_085d540d9f418cfbdc7bd55bb1" ON "sessions"  ("user_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_f61929073858aa9cb9cb893b66" ON "sessions"  ("family_id") `);
    await queryRunner.query(
      `CREATE TABLE "mail_suppressions" ("id" uuid NOT NULL, "email" character varying NOT NULL, "reason" character varying NOT NULL, "metadata" jsonb, "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_49dcd6bacf3bacd12956355046c" UNIQUE ("email"), CONSTRAINT "PK_274473c195e7bd4e738b90d0580" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "inbox_messages" ("consumer" character varying NOT NULL, "dedup_id" character varying NOT NULL, "topic" character varying NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fc3372b60e1313a21eb64b06153" PRIMARY KEY ("consumer", "dedup_id"))`,
    );
    await queryRunner.query(`CREATE INDEX "idx_inbox_messages_processed_at" ON "inbox_messages"  ("processed_at") `);
    await queryRunner.query(
      `CREATE TABLE "outbox_messages" ("id" uuid NOT NULL, "topic" character varying NOT NULL, "partition_key" character varying, "payload" jsonb NOT NULL, "headers" jsonb, "status" character varying NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0171348f527c64b137e4d4f5b66" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_messages_published_at" ON "outbox_messages"  ("published_at") WHERE status = 'published'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_messages_pending" ON "outbox_messages"  ("available_at", "created_at") WHERE status = 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_accounts" ADD CONSTRAINT "FK_22a05e92f51a983475f9281d3b0" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`);
    await queryRunner.query(`ALTER TABLE "oauth_accounts" DROP CONSTRAINT "FK_22a05e92f51a983475f9281d3b0"`);
    await queryRunner.query(`DROP INDEX "public"."idx_outbox_messages_pending"`);
    await queryRunner.query(`DROP INDEX "public"."idx_outbox_messages_published_at"`);
    await queryRunner.query(`DROP TABLE "outbox_messages"`);
    await queryRunner.query(`DROP INDEX "public"."idx_inbox_messages_processed_at"`);
    await queryRunner.query(`DROP TABLE "inbox_messages"`);
    await queryRunner.query(`DROP TABLE "mail_suppressions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f61929073858aa9cb9cb893b66"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_085d540d9f418cfbdc7bd55bb1"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_22a05e92f51a983475f9281d3b"`);
    await queryRunner.query(`DROP TABLE "oauth_accounts"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3be5894c040bc2b1930b041262"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
