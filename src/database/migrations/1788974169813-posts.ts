import { MigrationInterface, QueryRunner } from 'typeorm';

export class Posts1788974169813 implements MigrationInterface {
  name = 'Posts1788974169813';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "posts" ("id" uuid NOT NULL, "author_id" uuid NOT NULL, "slug" character varying(140) NOT NULL, "title" character varying(200) NOT NULL, "body" text NOT NULL, "cover_image_key" character varying(255), "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2829ac61eff60fcec60d7274b9e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_312c63be865c81b922e39c2475" ON "posts"  ("author_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_54ddf9075260407dcfdd724857" ON "posts"  ("slug") `);
    await queryRunner.query(`CREATE INDEX "IDX_d1313dd89c695e9fc8bd710ab5" ON "posts"  ("published_at") `);
    await queryRunner.query(
      `ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "posts" ADD CONSTRAINT "FK_312c63be865c81b922e39c2475e" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" DROP CONSTRAINT "FK_312c63be865c81b922e39c2475e"`);
    await queryRunner.query(`ALTER TABLE "mfa_credentials" ALTER COLUMN "recovery_code_hashes" SET DEFAULT '[]'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d1313dd89c695e9fc8bd710ab5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_54ddf9075260407dcfdd724857"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_312c63be865c81b922e39c2475"`);
    await queryRunner.query(`DROP TABLE "posts"`);
  }
}
