/**
 * Autorizacao Effective (especificacao secao 4).
 *
 * Este servico e a PONTE entre a politica pura de `@sertania/contracts` e o
 * banco de dados. A politica decide; este servico carrega os fatos atuais.
 *
 * A distincao importa, e a especificacao a exige: a permissao efetiva e
 * consultada no estado ATUAL da aplicacao. Nao se depende de um papel guardado
 * indefinidamente na sessao. Por isso vinculo revogado ou expirado perde efeito
 * na proxima operacao, mesmo com sessao valida em maos.
 */
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  authorize,
  type Action,
  type AuthorizationSubject,
  type AuthorizationTarget,
  type Membership,
  type AccessGrant,
} from '@sertania/contracts';
import type { SessionClaims } from '../auth/session.service';

export interface AuthorizationDecision {
  readonly allowed: boolean;
  /** Motivo interno, para auditoria. NUNCA vai para o cliente. */
  readonly reason: string;
}

const MEMBER_COLUMNS = `
  m."id", m."role", m."secretariat_id", m."unit_ids", m."team_ids",
  m."active", m."starts_at", m."expires_at"`;

/** Converte o texto do driver em `Date`. */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/** Converte a linha de `memberships` no tipo da politica. */
function toMembership(row: Record<string, unknown>): Membership {
  return {
    membershipId: row['id'] as string,
    role: row['role'] as Membership['role'],
    secretariatId: row['secretariat_id'] as string,
    unitIds: (row['unit_ids'] as string[] | null) ?? [],
    teamIds: (row['team_ids'] as string[] | null) ?? [],
    active: row['active'] as boolean,
    startsAt: toDate(row['starts_at']),
    expiresAt: row['expires_at'] === null ? null : toDate(row['expires_at']),
  };
}

/** Converte a linha de `access_grants` no tipo da politica. */
function toGrant(row: Record<string, unknown>): AccessGrant {
  return {
    grantId: row['id'] as string,
    action: row['action'] as AccessGrant['action'],
    resourceType: row['resource_type'] as string,
    resourceId: row['resource_id'] as string,
    purpose: row['purpose'] as string,
    approvedBy: row['approved_by'] as string,
    startsAt: toDate(row['starts_at']),
    expiresAt: toDate(row['expires_at']),
  };
}

@Injectable()
export class AuthorizationService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Monta o sujeto de autorizacao a partir da sessao e do estado atual do banco.
   *
   * A sessao diz QUEM e; o banco diz COMO. Se a sessao dissesse o que a pessoa
   * pode fazer, revogar um vinculo levaria ate a proxima expiracao.
   */
  async subjectFor(session: SessionClaims, now: Date): Promise<AuthorizationSubject> {
    const [memberships, grants] = await Promise.all([
      this.dataSource.query(
        `SELECT ${MEMBER_COLUMNS}
           FROM "memberships" m
          WHERE m."user_id" = $1
            AND m."active" = true
            AND m."starts_at" <= $2
            AND (m."expires_at" IS NULL OR m."expires_at" > $2)`,
        [session.userId, now],
      ),
      this.dataSource.query(
        `SELECT "id", "action", "resource_type", "resource_id", "purpose",
                "approved_by", "starts_at", "expires_at"
           FROM "access_grants"
          WHERE "user_id" = $1
            AND "revoked_at" IS NULL
            AND "starts_at" <= $2
            AND "expires_at" > $2`,
        [session.userId, now],
      ),
    ]);

    return {
      userId: session.userId,
      isCitizen: session.isCitizen,
      isServer: session.isServer,
      // O driver devolve `timestamptz` como texto, e a politica chama
      // `.getTime()`. Sem a conversao, a checagem de validade do vinculo
      // quebra em tempo de execucao, e um vinculo revogado passaria.
      memberships: (memberships as Array<Record<string, unknown>>).map(toMembership),
      currentContext:
        session.membershipId !== null && session.secretariatId !== null
          ? { membershipId: session.membershipId, secretariatId: session.secretariatId }
          : null,
      grants: (grants as Array<Record<string, unknown>>).map(toGrant),
      now,
    };
  }

  /** Verifica a acao contra o alvo. */
  async check(
    session: SessionClaims,
    action: Action,
    target: AuthorizationTarget,
    now: Date,
  ): Promise<AuthorizationDecision> {
    const subject = await this.subjectFor(session, now);
    const result = authorize(subject, action, target);
    return result.allowed
      ? { allowed: true, reason: 'AUTORIZADO' }
      : { allowed: false, reason: result.reason };
  }

  /**
   * Le o alvo de uma solicitacao direto do banco.
   *
   * Ler o alvo do banco, e nao do corpo da requisicao, e o que impede que um
   * servidor de Infraestrutura declare que o pedido e de Saude.
   */
  async requestTarget(requestId: string): Promise<AuthorizationTarget | null> {
    const rows = await this.dataSource.query(
      `SELECT "id","citizen_id","assignee_user_id","secretariat_id","unit_id",
              "classification","state"
         FROM "requests" WHERE "id" = $1`,
      [requestId],
    );
    if (rows.length === 0) return null;
    const row = rows[0] as Record<string, unknown>;
    return {
      requestId: row['id'] as string,
      ownerCitizenId: row['citizen_id'] as string,
      // `undefined` e nao `null`: com `exactOptionalPropertyTypes`, um campo
      // opcional nao aceita `null`, e a distincao nao importa para a politica.
      assigneeUserId: (row['assignee_user_id'] as string | null) ?? undefined,
      secretariatId: row['secretariat_id'] as string,
      unitId: row['unit_id'] as string,
      classification: row['classification'] as AuthorizationTarget['classification'],
      state: row['state'] as AuthorizationTarget['state'],
    };
  }

  /** Registra a decisao na auditoria (secao 13). */
  async audit(input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    result: 'ALLOWED' | 'DENIED';
    reason: string;
    correlationId: string;
  }): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "audit_events"
         ("actor_user_id","action","resource_type","resource_id","result","context","correlation_id")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.actorUserId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.result,
        JSON.stringify({ reason: input.reason }),
        input.correlationId,
      ],
    );
  }
}
