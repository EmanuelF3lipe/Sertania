import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { SessionClaims } from './session.service';
import { Database } from '../database/typed-query';
import { AuthorizationService } from '../authorization/authorization.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { MailService } from './mail.service';
import { ConfigService } from '@nestjs/config';

const ROLES = new Set([
  'ATTENDANT',
  'OPERATIONAL_TEAM',
  'SECRETARY_MANAGER',
]);

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

@Injectable()
export class ServerOnboardingService {
  constructor(
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
    private readonly keycloak: KeycloakAdminService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private hash(value: string): string {
    const secret = this.config.get<string>('SESSION_SECRET', 'local-onboarding-secret');
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  private tokenHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private equalHash(left: string, right: string): boolean {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private invitationTtlMs(): number {
    return Number(this.config.get<string>('SERVER_INVITATION_TTL_SECONDS', '86400')) * 1000;
  }

  private codeTtlMs(): number {
    return Number(this.config.get<string>('SERVER_VERIFICATION_CODE_TTL_SECONDS', '600')) * 1000;
  }

  private frontEndOrigin(): string {
    return this.config.get<string>('PUBLIC_ORIGIN', 'http://localhost:5173').replace(/\/+$/, '');
  }

  async createInvitation(input: {
    email: string;
    role: string;
    secretariatId: string;
    unitId: string;
    session: SessionClaims | undefined;
  }): Promise<{ invitationId: string; email: string; expiresAt: string }> {
    if (input.session === undefined || !input.session.isServer) throw new ForbiddenException();
    const email = normalizeEmail(input.email);
    if (!validEmail(email)) throw new BadRequestException('E-mail invalido.');
    if (!ROLES.has(input.role)) throw new BadRequestException('Perfil institucional invalido.');

    const decision = await this.authorization.check(
      input.session,
      'UNIT_MANAGE',
      { secretariatId: input.secretariatId, unitId: input.unitId },
      new Date(),
    );
    if (!decision.allowed) throw new ForbiddenException();

    const unit = await this.db.run(
      `SELECT "id" FROM "units" WHERE "id" = $1 AND "secretariat_id" = $2 AND "active" = true`,
      [input.unitId, input.secretariatId],
    );
    if (unit.length === 0) throw new BadRequestException('Unidade invalida para a secretaria.');

    const pending = await this.db.run<{ id: string }>(
      `SELECT "id" FROM "server_invitations" WHERE lower("email") = $1 AND "status" = 'PENDING' LIMIT 1`,
      [email],
    );
    if (pending[0] !== undefined) return this.reissueInvitation(pending[0].id);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.tokenHash(token);
    const expiresAt = new Date(Date.now() + this.invitationTtlMs());
    const keycloakUserId = await this.keycloak.createDisabledUser(email);
    const issuer = `${this.config.get<string>('KEYCLOAK_URL', 'http://localhost:8080').replace(/\/+$/, '')}/realms/${this.config.get<string>('KEYCLOAK_REALM_SERVERS', 'sertania-servidores')}`;

    let invitationId: string;
    try {
      invitationId = await this.db.transaction(async (tx) => {
        const users = await tx.run<{ id: string }>(
          `INSERT INTO "users" ("is_citizen", "is_server") VALUES (false, true) RETURNING "id"`,
        );
        const user = users[0];
        if (user === undefined) throw new Error('Usuario institucional nao criado');
        await tx.run(
          `INSERT INTO "external_identities" ("user_id","issuer","subject","realm","email") VALUES ($1,$2,$3,$4,$5)`,
          [user.id, issuer, keycloakUserId, this.config.get<string>('KEYCLOAK_REALM_SERVERS', 'sertania-servidores'), email],
        );
        await tx.run(
          `INSERT INTO "memberships" ("user_id","role","secretariat_id","unit_ids","team_ids") VALUES ($1,$2,$3,$4,'{}')`,
          [user.id, input.role, input.secretariatId, [input.unitId]],
        );
        const rows = await tx.run<{ id: string }>(
          `INSERT INTO "server_invitations" ("user_id","email","role","secretariat_id","unit_id","token_hash","expires_at","created_by")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "id"`,
          [user.id, email, input.role, input.secretariatId, input.unitId, tokenHash, expiresAt, input.session?.userId],
        );
        const row = rows[0];
        if (row === undefined) throw new Error('Convite institucional nao criado');
        return row.id;
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw error;
    }

    const link = `${this.frontEndOrigin()}/#/cadastro-servidor/${encodeURIComponent(token)}`;
    await this.mail.sendServerInvitation({ to: email, link, expiresAt });
    return { invitationId, email, expiresAt: expiresAt.toISOString() };
  }

  private async reissueInvitation(invitationId: string): Promise<{ invitationId: string; email: string; expiresAt: string }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.invitationTtlMs());
    const rows = await this.db.run<{ email: string }>(
      `UPDATE "server_invitations" SET "token_hash" = $2, "expires_at" = $3,
              "verification_code_hash" = NULL, "verification_attempts" = 0,
              "verification_expires_at" = NULL, "verification_verified_at" = NULL, "updated_at" = now()
        WHERE "id" = $1 AND "status" = 'PENDING' RETURNING "email"`,
      [invitationId, this.tokenHash(token), expiresAt],
    );
    const row = rows[0];
    if (row === undefined) throw new ConflictException('Convite nao esta mais pendente.');
    const link = `${this.frontEndOrigin()}/#/cadastro-servidor/${encodeURIComponent(token)}`;
    await this.mail.sendServerInvitation({ to: row.email, link, expiresAt });
    return { invitationId, email: row.email, expiresAt: expiresAt.toISOString() };
  }

  async invitationOptions(session: SessionClaims | undefined): Promise<{
    secretariats: ReadonlyArray<{
      id: string;
      name: string;
      units: ReadonlyArray<{ id: string; name: string }>;
    }>;
    roles: ReadonlyArray<{ id: string; name: string }>;
  }> {
    if (session === undefined || !session.isServer) throw new ForbiddenException();
    const subject = await this.authorization.subjectFor(session, new Date());
    const managed = subject.memberships.filter((membership) =>
      membership.role === 'SECRETARY_MANAGER' || membership.role === 'TECH_ADMIN',
    );
    if (managed.length === 0) throw new ForbiddenException();
    const secretariatIds = [...new Set(managed.map((membership) => membership.secretariatId))];
    const units = await this.db.run<{ id: string; name: string; secretariat_id: string }>(
      `SELECT "id","name","secretariat_id" FROM "units"
        WHERE "active" = true AND "secretariat_id" = ANY($1::uuid[]) ORDER BY "name"`,
      [secretariatIds],
    );
    const secretariats = await this.db.run<{ id: string; name: string }>(
      `SELECT "id","name" FROM "secretariats" WHERE "active" = true AND "id" = ANY($1::uuid[]) ORDER BY "name"`,
      [secretariatIds],
    );
    return {
      secretariats: secretariats.map((secretariat) => ({
        id: secretariat.id,
        name: secretariat.name,
        units: units
          .filter((unit) => unit.secretariat_id === secretariat.id)
          .filter((unit) => {
            const membership = managed.find((item) => item.secretariatId === secretariat.id);
            return membership?.unitIds.length === 0 || membership?.unitIds.includes(unit.id);
          })
          .map((unit) => ({ id: unit.id, name: unit.name })),
      })),
      roles: [
        { id: 'ATTENDANT', name: 'Atendente' },
        { id: 'OPERATIONAL_TEAM', name: 'Equipe operacional' },
        { id: 'SECRETARY_MANAGER', name: 'Gestor da secretaria' },
      ],
    };
  }

  async sessionSetting(session: SessionClaims | undefined): Promise<{ absoluteTtlSeconds: number }> {
    await this.requireManager(session);
    const rows = await this.db.run<{ value: string }>(
      `SELECT "value" FROM "system_settings" WHERE "key" = 'server_session_absolute_ttl_seconds'`,
    );
    const value = Number(rows[0]?.value);
    return {
      absoluteTtlSeconds: Number.isInteger(value) && value > 0
        ? value
        : Number(this.config.get<string>('SESSION_ABSOLUTE_TTL_SECONDS', '28800')),
    };
  }

  async updateSessionSetting(session: SessionClaims | undefined, seconds: number): Promise<{ absoluteTtlSeconds: number }> {
    await this.requireManager(session);
    if (!Number.isInteger(seconds) || seconds < 900 || seconds > 604800) {
      throw new BadRequestException('O prazo deve ficar entre 15 minutos e 7 dias.');
    }
    await this.db.run(
      `INSERT INTO "system_settings" ("key","value","updated_by","updated_at") VALUES ('server_session_absolute_ttl_seconds',$1,$2,now())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_by" = EXCLUDED."updated_by", "updated_at" = now()`,
      [String(seconds), session?.userId],
    );
    return { absoluteTtlSeconds: seconds };
  }

  private async requireManager(session: SessionClaims | undefined): Promise<void> {
    if (session === undefined || !session.isServer) throw new ForbiddenException();
    const subject = await this.authorization.subjectFor(session, new Date());
    const membership = subject.memberships.find(
      (item) => item.role === 'SECRETARY_MANAGER' || item.role === 'TECH_ADMIN',
    );
    if (membership === undefined) throw new ForbiddenException();
  }

  async invitationState(token: string): Promise<{
    email: string;
    expiresAt: string;
    verificationUrl: string;
    turnstileSiteKey: string;
  }> {
    const row = await this.pendingInvitation(token);
    return {
      email: row['email'] as string,
      expiresAt: new Date(String(row['expires_at'])).toISOString(),
      verificationUrl: `${this.frontEndOrigin()}/#/verificacao-servidor/${encodeURIComponent(token)}`,
      turnstileSiteKey: this.config.get<string>('TURNSTILE_SITE_KEY', ''),
    };
  }

  async verifyHuman(token: string, turnstileToken: string): Promise<{ code: string; expiresAt: string }> {
    await this.verifyTurnstile(turnstileToken);
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const rows = await tx.run<Record<string, unknown>>(
        `SELECT i.*, e."subject" AS "external_subject"
           FROM "server_invitations" i
           JOIN "external_identities" e ON e."user_id" = i."user_id"
          WHERE i."token_hash" = $1 FOR UPDATE`,
        [this.tokenHash(token)],
      );
      const row = rows[0];
      if (row === undefined || row['status'] !== 'PENDING' || new Date(String(row['expires_at'])) <= now) {
        throw new NotFoundException('Convite expirado ou inexistente.');
      }
      const code = String(randomInt(10_000_000, 100_000_000));
      const expiresAt = new Date(now.getTime() + this.codeTtlMs());
      await tx.run(
        `UPDATE "server_invitations" SET "verification_code_hash" = $2, "verification_attempts" = 0,
                "verification_expires_at" = $3, "verification_verified_at" = $4, "updated_at" = now()
          WHERE "id" = $1`,
        [row['id'], this.hash(code), expiresAt, now],
      );
      return { code, expiresAt: expiresAt.toISOString() };
    });
  }

  async complete(token: string, code: string, password: string): Promise<{ loginUrl: string }> {
    if (password.length < 12 || password.length > 200) {
      throw new BadRequestException('A senha deve ter entre 12 e 200 caracteres.');
    }
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const rows = await tx.run<Record<string, unknown>>(
        `SELECT i.*, e."subject" AS "external_subject"
           FROM "server_invitations" i
           JOIN "external_identities" e ON e."user_id" = i."user_id"
          WHERE i."token_hash" = $1 FOR UPDATE`,
        [this.tokenHash(token)],
      );
      const row = rows[0];
      if (row === undefined || row['status'] !== 'PENDING' || new Date(String(row['expires_at'])) <= now) {
        throw new NotFoundException('Convite expirado ou inexistente.');
      }
      const storedHash = row['verification_code_hash'];
      const verificationExpiresAt = row['verification_expires_at'];
      const verificationExpiry = verificationExpiresAt instanceof Date
        ? verificationExpiresAt
        : new Date(typeof verificationExpiresAt === 'string' ? verificationExpiresAt : '');
      if (typeof storedHash !== 'string' || verificationExpiresAt === null || verificationExpiresAt === undefined ||
          verificationExpiry <= now || row['verification_verified_at'] === null) {
        throw new BadRequestException('Conclua a verificacao antes de criar a senha.');
      }
      const attempts = Number(row['verification_attempts'] ?? 0);
      if (attempts >= 5) throw new BadRequestException('Codigo bloqueado. Gere outro codigo pela verificacao.');
      if (!this.equalHash(storedHash, this.hash(code.trim()))) {
        await tx.run(
          `UPDATE "server_invitations" SET "verification_attempts" = "verification_attempts" + 1, "updated_at" = now() WHERE "id" = $1`,
          [row['id']],
        );
        throw new BadRequestException('Codigo de verificacao invalido.');
      }

      await this.keycloak.activateWithPassword(String(row['external_subject'] ?? row['user_id']), password);
      await tx.run(
        `UPDATE "server_invitations" SET "status" = 'ACCEPTED', "accepted_at" = now(),
                "verification_code_hash" = NULL, "verification_verified_at" = NULL, "updated_at" = now()
          WHERE "id" = $1`,
        [row['id']],
      );
      return { loginUrl: '/api/v1/auth/login/servidor' };
    });
  }

  private async pendingInvitation(token: string): Promise<Record<string, unknown>> {
    const rows = await this.db.run<Record<string, unknown>>(
      `SELECT "id","email","expires_at","status" FROM "server_invitations" WHERE "token_hash" = $1`,
      [this.tokenHash(token)],
    );
    const row = rows[0];
    if (row === undefined || row['status'] !== 'PENDING' || new Date(String(row['expires_at'])) <= new Date()) {
      throw new NotFoundException('Convite expirado ou inexistente.');
    }
    return row;
  }

  private async verifyTurnstile(token: string): Promise<void> {
    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY', '');
    if (this.config.get<string>('NODE_ENV', 'development') !== 'production' && secret === '' && token === 'dev-turnstile-bypass') return;
    if (secret === '' || token.trim() === '') throw new BadRequestException('Verificacao humana ausente.');
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!response.ok) throw new BadRequestException('Nao foi possivel validar a verificacao humana.');
    const result = (await response.json()) as { success?: unknown };
    if (result.success !== true) throw new BadRequestException('Verificacao humana recusada.');
  }
}
