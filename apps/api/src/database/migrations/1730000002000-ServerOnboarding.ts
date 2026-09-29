import { MigrationInterface, QueryRunner } from 'typeorm';

/** Convites e desafios de primeiro acesso de servidores institucionais. */
export class ServerOnboarding1730000002000 implements MigrationInterface {
  name = 'ServerOnboarding1730000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "server_invitations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "email" varchar(320) NOT NULL,
        "role" varchar(32) NOT NULL,
        "secretariat_id" uuid NOT NULL REFERENCES "secretariats"("id") ON DELETE RESTRICT,
        "unit_id" uuid REFERENCES "units"("id") ON DELETE RESTRICT,
        "token_hash" varchar(64) NOT NULL UNIQUE,
        "status" varchar(16) NOT NULL DEFAULT 'PENDING',
        "expires_at" timestamptz NOT NULL,
        "verification_code_hash" varchar(64),
        "verification_attempts" integer NOT NULL DEFAULT 0,
        "verification_expires_at" timestamptz,
        "verification_verified_at" timestamptz,
        "accepted_at" timestamptz,
        "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_server_invitation_role" CHECK ("role" IN (
          'ATTENDANT','OPERATIONAL_TEAM','SECRETARY_MANAGER','CENTRAL_MANAGEMENT',
          'TECH_ADMIN','AUDITOR'
        )),
        CONSTRAINT "chk_server_invitation_status" CHECK ("status" IN (
          'PENDING','ACCEPTED','REVOKED'
        )),
        CONSTRAINT "chk_server_invitation_attempts" CHECK ("verification_attempts" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_server_invitations_email" ON "server_invitations" (lower("email"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_server_invitations_pending" ON "server_invitations" ("status", "expires_at")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_server_invitation_pending_email"
        ON "server_invitations" (lower("email"))
        WHERE "status" = 'PENDING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_server_invitation_pending_email"`);
    await queryRunner.query(`DROP INDEX "idx_server_invitations_pending"`);
    await queryRunner.query(`DROP INDEX "idx_server_invitations_email"`);
    await queryRunner.query(`DROP TABLE "server_invitations"`);
  }
}
