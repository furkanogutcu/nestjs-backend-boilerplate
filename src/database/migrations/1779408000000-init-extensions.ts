import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitExtensions1779408000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS timescaledb;`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_stat_statements;`);
    // ! timescaledb deliberately not dropped: it fails on any existing hypertable and dropping it accidentally is catastrophic.
  }
}
