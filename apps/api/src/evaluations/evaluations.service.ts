import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionClaims } from '../auth/session.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { Database } from '../database/typed-query';

interface EvaluationRow extends Record<string, unknown> {
  readonly id: string;
  readonly request_id: string;
  readonly cycle_number: number | string;
  readonly author_user_id: string;
  readonly rating: number | string;
  readonly comment: string | null;
  readonly created_at: string | Date;
}

export interface EvaluationDto {
  readonly id: string;
  readonly requestId: string;
  readonly cycleNumber: number;
  readonly rating: number;
  readonly comment: string | null;
  readonly createdAt: string | Date;
}

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
  ) {}

  async current(input: {
    requestId: string;
    session: SessionClaims | undefined;
    correlationId: string;
  }): Promise<EvaluationDto | null> {
    const session = await this.authorizeOwner(
      input.requestId,
      input.session,
      'read',
      input.correlationId,
    );
    const rows = await this.db.run<EvaluationRow>(
      `SELECT "id","request_id","cycle_number","author_user_id","rating","comment","created_at"
         FROM "evaluations"
        WHERE "request_id" = $1 AND "author_user_id" = $2
        ORDER BY "cycle_number" DESC LIMIT 1`,
      [input.requestId, session.userId],
    );
    await this.authorization.audit({
      actorUserId: session.userId,
      action: 'REQUEST_READ_OWN',
      resourceType: 'evaluation',
      resourceId: input.requestId,
      result: 'ALLOWED',
      reason: 'LEITURA',
      correlationId: input.correlationId,
    });
    const row = rows[0];
    if (row === undefined) return null;
    return toDto(row);
  }

  async create(input: {
    requestId: string;
    rating: unknown;
    comment: unknown;
    session: SessionClaims | undefined;
    correlationId: string;
  }): Promise<EvaluationDto> {
    const session = await this.authorizeOwner(
      input.requestId,
      input.session,
      'write',
      input.correlationId,
    );
    const rating = validateRating(input.rating);
    const comment = validateComment(input.comment);
    const request = await this.db.run<{ state: string; cycle_number: number | string }>(
      `SELECT "state","cycle_number" FROM "requests" WHERE "id" = $1`,
      [input.requestId],
    );
    const current = request[0];
    if (current === undefined) throw new NotFoundException('Solicitacao nao encontrada.');
    if (current.state !== 'COMPLETED') {
      throw new BadRequestException('A avaliacao fica disponivel apos a conclusao do pedido.');
    }

    const cycleNumber = Number(current.cycle_number);
    let rows: EvaluationRow[];
    try {
      rows = await this.db.run<EvaluationRow>(
        `INSERT INTO "evaluations"
           ("request_id","cycle_number","author_user_id","rating","comment")
         VALUES ($1,$2,$3,$4,$5)
         RETURNING "id","request_id","cycle_number","author_user_id","rating","comment","created_at"`,
        [input.requestId, cycleNumber, session.userId, rating, comment],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Este ciclo ja foi avaliado.');
      throw error;
    }
    const row = rows[0];
    if (row === undefined) throw new Error('Avaliacao nao foi registrada.');

    await this.authorization.audit({
      actorUserId: session.userId,
      action: 'REQUEST_EVALUATE_OWN',
      resourceType: 'evaluation',
      resourceId: row.id,
      result: 'ALLOWED',
      reason: `CICLO_${cycleNumber}`,
      correlationId: input.correlationId,
    });
    return toDto(row);
  }

  private async authorizeOwner(
    requestId: string,
    session: SessionClaims | undefined,
    operation: 'read' | 'write',
    correlationId: string,
  ): Promise<SessionClaims> {
    if (session === undefined) throw new ForbiddenException();
    const target = await this.authorization.requestTarget(requestId);
    if (target === null) throw new NotFoundException('Solicitacao nao encontrada.');
    const action = operation === 'read' ? 'REQUEST_READ_OWN' : 'REQUEST_EVALUATE_OWN';
    const decision = await this.authorization.check(session, action, target, new Date());
    if (!decision.allowed) {
      await this.authorization.audit({
        actorUserId: session.userId,
        action,
        resourceType: 'request',
        resourceId: requestId,
        result: 'DENIED',
        reason: decision.reason,
        correlationId,
      });
      throw new ForbiddenException();
    }
    return session;
  }
}

function validateRating(value: unknown): number {
  const rating = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new BadRequestException('A nota deve ser um numero inteiro entre 1 e 5.');
  }
  return rating;
}

function validateComment(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string')
    throw new BadRequestException('O comentario precisa ser um texto.');
  const comment = value.trim();
  if (comment.length > 2_000)
    throw new BadRequestException('O comentario pode ter no maximo 2000 caracteres.');
  return comment === '' ? null : comment;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

function toDto(row: EvaluationRow): EvaluationDto {
  return {
    id: row.id,
    requestId: row.request_id,
    cycleNumber: Number(row.cycle_number),
    rating: Number(row.rating),
    comment: row.comment,
    createdAt: row.created_at,
  };
}
