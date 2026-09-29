/**
 * Controllers REST (especificacao secao 16).
 *
 * API versionada em `/api/v1`. Controllers recebem DTOs e chamam casos de uso.
 * Nenhuma entidade do banco vira resposta publica: os DTOs de cidadao,
 * operacao e gestao sao distintos.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { API_ERROR_CODES, IDEMPOTENCY_HEADER, type RequestState } from '@sertania/contracts';
import { OpenRequestService, type OpenRequestInput } from '../requests/open-request.service';
import { WorkflowService } from '../requests/workflow.service';
import { CurrentSession, Public, type AuthenticatedRequest } from '../auth/session.guard';
import type { SessionClaims } from '../auth/session.service';

interface DtoRequest {
  readonly serviceVersionId: string;
  readonly secretariatId: string;
  readonly unitId: string;
  readonly slaPolicyId: string;
  readonly description: string;
  readonly formAnswers?: Record<string, unknown>;
  readonly location?: {
    readonly addressText: string;
    readonly reference?: string;
    readonly locality?: string;
    readonly latitude?: number;
    readonly longitude?: number;
    readonly precisionSource: 'MAP_PICK' | 'TYPED' | 'GEOCODED' | 'UNKNOWN';
    readonly precisionMeters?: number;
  };
}

@Controller('api/v1')
export class RequestsController {
  constructor(
    private readonly openRequest: OpenRequestService,
    private readonly workflow: WorkflowService,
    private readonly dataSource: DataSource,
  ) {}

  @Public()
  @Get('health')
  async health(): Promise<{ status: string; database: string; now: string }> {
    // Verifica o banco de verdade: um health que responde ok com o banco
    // fora do ar seria enganoso.
    let database = 'up';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = 'down';
    }
    return { status: database === 'up' ? 'ok' : 'degraded', database, now: new Date().toISOString() };
  }

  /**
   * Abre uma solicitacao.
   *
   * O cabeçalho `Idempotency-Key` torna a retentativa segura: repetir a
   * chamada devolve o mesmo protocolo em vez de abrir um segundo pedido
   * (criterio 2).
   */
  @Post('requests')
  @HttpCode(201)
  async create(
    @Body() body: DtoRequest,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey: string | undefined,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ protocol: string; requestId: string; state: RequestState; submittedAt: string; replayed: boolean }> {
    // Sem sessao, so um atendente autorizado registra. O cidadao precisa estar
    // autenticado.
    if (!session) {
      response.status(401);
      return { protocol: '', requestId: '', state: 'DRAFT' as RequestState, submittedAt: '', replayed: false };
    }

    const input: OpenRequestInput = {
      citizenId: session.userId,
      createdBy: session.userId,
      channel: 'WEB',
      serviceVersionId: body.serviceVersionId,
      secretariatId: body.secretariatId,
      unitId: body.unitId,
      slaPolicyId: body.slaPolicyId,
      classification: 'INTERNAL',
      description: body.description,
      formAnswers: body.formAnswers ?? {},
      location: body.location ?? null,
      identityVerificationMethod: null,
      assistedNote: null,
    };

    const result = await this.openRequest.open(input, idempotencyKey, new Date());
    void request;

    if (result.outcome === 'IDEMPOTENCY_MISMATCH') {
      response.status(409);
      return { protocol: '', requestId: '', state: 'DRAFT' as RequestState, submittedAt: '', replayed: false };
    }
    if (result.outcome === 'IN_FLIGHT') {
      response.status(409);
      return { protocol: '', requestId: '', state: 'DRAFT' as RequestState, submittedAt: '', replayed: false };
    }

    response.status(result.outcome === 'REPLAYED' ? 200 : 201);
    return {
      protocol: result.protocol,
      requestId: result.requestId,
      state: result.state,
      submittedAt: result.submittedAt.toISOString(),
      replayed: result.outcome === 'REPLAYED',
    };
  }

  /** Lista as solicitacoes do cidadao autenticado. */
  @Get('requests/mine')
  async mine(
    @CurrentSession() session: SessionClaims | undefined,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ): Promise<{ items: ReadonlyArray<Record<string, unknown>>; total: number; limit: number; offset: number }> {
    if (!session) return { items: [], total: 0, limit: 20, offset: 0 };

    // Paginacao no servidor, com limites. Sem isso, um cliente poderia pedir a
    // tabela inteira.
    const limit = Math.min(Math.max(Number(limitRaw ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);

    const rows = await this.dataSource.query(
      `SELECT "id","protocol","state","submitted_at","completed_at","priority","cycle_number"
         FROM "requests"
        WHERE "citizen_id" = $1
        ORDER BY "created_at" DESC
        LIMIT $2 OFFSET $3`,
      [session.userId, limit, offset],
    );
    const count = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM "requests" WHERE "citizen_id" = $1`,
      [session.userId],
    );

    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row['id'],
        protocol: row['protocol'],
        state: row['state'],
        submittedAt: row['submitted_at'],
        completedAt: row['completed_at'],
        priority: row['priority'],
        cycleNumber: row['cycle_number'],
      })),
      total: (count[0] as { total: number }).total,
      limit,
      offset,
    };
  }

  /**
   * Detalhe de uma solicitacao.
   *
   * A politica de acesso e aplicada mesmo com UUID conhecido: `/requests/{id}`
   * aplica a mesma regra da listagem.
   */
  @Get('requests/:id')
  async detail(
    @Param('id') id: string,
    @CurrentSession() session: SessionClaims | undefined,
  ): Promise<Record<string, unknown>> {
    if (!session) return {};

    const rows = await this.dataSource.query(
      `SELECT r."id", r."protocol", r."state", r."submitted_at", r."completed_at",
              r."priority", r."cycle_number", r."version", r."secretariat_id", r."unit_id",
              c."description"
         FROM "requests" r
         LEFT JOIN "request_content" c ON c."request_id" = r."id"
        WHERE r."id" = $1 AND r."citizen_id" = $2`,
      [id, session.userId],
    );
    if (rows.length === 0) {
      // Nao_found_or_forbidden: a mesma resposta para recurso inexistente e
      // para recurso de terceiro, para nao permitir enumeracao.
      return {};
    }

    // Linha do tempo: SOMENTE eventos visiveis ao cidadao. Uma nota interna
    // nunca aparece aqui.
    const events = await this.dataSource.query(
      `SELECT "type","state_before","state_after","public_text","created_at"
         FROM "request_events"
        WHERE "request_id" = $1 AND "visibility" = 'CITIZEN_VISIBLE'
        ORDER BY "created_at" ASC`,
      [id],
    );

    const row = rows[0] as Record<string, unknown>;
    return {
      id: row['id'],
      protocol: row['protocol'],
      state: row['state'],
      submittedAt: row['submitted_at'],
      completedAt: row['completed_at'],
      priority: row['priority'],
      cycleNumber: row['cycle_number'],
      version: row['version'],
      description: row['description'],
      timeline: events.map((e: Record<string, unknown>) => ({
        type: e['type'],
        from: e['state_before'],
        to: e['state_after'],
        text: e['public_text'],
        at: e['created_at'],
      })),
    };
  }

  /**
   * Aplica um comando de workflow.
   *
   * A API recebe comandos de negocio, nao um PATCH generico que aceite
   * qualquer status. O cliente envia o comando e a versao que espera.
   */
  @Post('requests/:id/commands/:command')
  @HttpCode(200)
  async command(
    @Param('id') id: string,
    @Param('command') command: string,
    @Body() body: { expectedVersion: number; publicText: string; reason?: string; outcome?: string; justification?: string },
    @CurrentSession() session: SessionClaims | undefined,
  ): Promise<{ ok: boolean; state?: RequestState; version?: number; error?: string }> {
    if (!session) return { ok: false, error: API_ERROR_CODES.UNAUTHENTICATED };

    const allowed = [
      'SUBMIT', 'START_REVIEW', 'REQUEST_INFORMATION', 'PROVIDE_INFORMATION',
      'SCHEDULE', 'START_EXECUTION', 'COMPLETE', 'CANCEL', 'REOPEN',
    ];
    if (!allowed.includes(command)) {
      return { ok: false, error: 'COMANDO_DESCONHECIDO' };
    }

    const result = await this.workflow.apply(
      command as Parameters<WorkflowService['apply']>[0],
      {
        requestId: id,
        expectedVersion: body.expectedVersion,
        actorUserId: session.userId,
        now: new Date(),
        publicText: body.publicText,
        reason: body.reason ?? null,
      },
    );

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, state: result.state, version: result.version };
  }
}
