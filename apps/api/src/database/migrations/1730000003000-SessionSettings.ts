import { MigrationInterface, QueryRunner } from 'typeorm';

/** Configuracoes administrativas que afetam novas sessoes. */
export class SessionSettings1730000003000 implements MigrationInterface {
  name = 'SessionSettings1730000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "system_settings" (
        "key" varchar(120) PRIMARY KEY,
        "value" varchar(200) NOT NULL,
        "updated_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `INSERT INTO "system_settings" ("key","value") VALUES ('server_session_absolute_ttl_seconds','28800')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "system_settings"`);
  }
}
