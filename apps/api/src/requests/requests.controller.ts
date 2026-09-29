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
import type { Response } from 'express';
import {
  API_ERROR_CODES,
  CITIZEN_STATE_TEXT,
  IDEMPOTENCY_HEADER,
  allowedCommandsFrom,
  type RequestOutcome,
  type RequestState,
} from '@sertania/contracts';
import { OpenRequestService, type OpenRequestInput } from '../requests/open-request.service';
import { WorkflowService } from '../requests/workflow.service';
import { CurrentSession, Public, type AuthenticatedRequest } from '../auth/session.guard';
import type { SessionClaims } from '../auth/session.service';
import { Database } from '../database/typed-query';
import { AuthorizationService } from '../authorization/authorization.service';
import { actionForCommand, requiresOwnership } from '../authorization/command-permissions';

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
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
  ) {}

  @Public()
  @Get('health')
  async health(): Promise<{ status: string; database: string; now: string }> {
    // Verifica o banco de verdade: um health que responde ok com o banco
    // fora do ar seria enganoso.
    let database = 'up';
    try {
      await this.db.run('SELECT 1');
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

    const rows = await this.db.run(
      `SELECT r."id",r."protocol",r."state",r."submitted_at",r."completed_at",r."priority",r."cycle_number",
              r."created_at",sec."name" AS "secretariat_name",sv."name" AS "service_name"
         FROM "requests" r
         JOIN "secretariats" sec ON sec."id" = r."secretariat_id"
         JOIN "service_versions" sv ON sv."id" = r."service_version_id"
        WHERE r."citizen_id" = $1
        ORDER BY r."created_at" DESC
        LIMIT $2 OFFSET $3`,
      [session.userId, limit, offset],
    );
    const total = await this.db.count(
      `SELECT count(*)::int FROM "requests" WHERE "citizen_id" = $1`,
      [session.userId],
    );

    return {
      items: rows.map((row) => ({
        id: row['id'],
        protocol: row['protocol'],
        state: row['state'],
        stateText: CITIZEN_STATE_TEXT[row['state'] as RequestState],
        serviceName: row['service_name'],
        secretariatName: row['secretariat_name'],
        createdAt: row['created_at'],
        dueAt: null,
        submittedAt: row['submitted_at'],
        completedAt: row['completed_at'],
        priority: row['priority'],
        cycleNumber: row['cycle_number'],
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Fila institucional, com escopo aplicado no BANCO.
   *
   * O filtro nao pode ser aplicado so no controller: a contagem e a paginacao
   * Consultariam a tabela inteira, e um `LIMIT` sobre dados nao autorizados
   * vaza informacao pela propria existencia de linhas.
   */
  @Get('requests')
  async queue(
    @CurrentSession() session: SessionClaims | undefined,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Query('state') state?: string,
  ): Promise<{ items: ReadonlyArray<Record<string, unknown>>; total: number; limit: number; offset: number }> {
    if (!session) return { items: [], total: 0, limit: 20, offset: 0 };

    const limit = Math.min(Math.max(Number(limitRaw ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);
    const now = new Date();

    // O escopo vem dos vinculos RECONSULTADOS agora. Um vinculo revogado
    // remove a secretaria da lista na proxima chamada.
    const subject = await this.authorization.subjectFor(session, now);
    const secretariatIds = [
      ...new Set(subject.memberships.map((m) => m.secretariatId)),
    ];
    if (secretariatIds.length === 0) {
      return { items: [], total: 0, limit, offset };
    }

    const params: unknown[] = [secretariatIds];
    let filtroEstado = '';
    if (state !== undefined && state !== '') {
      params.push(state);
      filtroEstado = ` AND r."state" = $${params.length}`;
    }
    params.push(limit, offset);
    const limiteParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    const rows = await this.db.run(
      `SELECT r."id", r."protocol", r."state", r."submitted_at", r."completed_at",
              r."priority", r."secretariat_id", r."unit_id", r."classification",
              r."created_at", r."version", sv."name" AS "service_name",
              sec."name" AS "secretariat_name"
         FROM "requests" r
         JOIN "service_versions" sv ON sv."id" = r."service_version_id"
         JOIN "secretariats" sec ON sec."id" = r."secretariat_id"
        WHERE r."secretariat_id" = ANY($1::uuid[])
          AND r."state" <> 'DRAFT'${filtroEstado}
        ORDER BY r."created_at" DESC
        LIMIT ${limiteParam} OFFSET ${offsetParam}`,
      params,
    );
    const total = await this.db.count(
      `SELECT count(*)::int
         FROM "requests" r
        WHERE r."secretariat_id" = ANY($1::uuid[])
          AND r."state" <> 'DRAFT'${filtroEstado}`,
      params.slice(0, params.length - 2),
    );

    return {
      items: rows.map((row) => ({
        id: row['id'],
        protocol: row['protocol'],
        state: row['state'],
        stateText: CITIZEN_STATE_TEXT[row['state'] as RequestState],
        serviceName: row['service_name'],
        citizenName: null,
        createdAt: row['created_at'],
        dueAt: null,
        version: row['version'],
        submittedAt: row['submitted_at'],
        completedAt: row['completed_at'],
        priority: row['priority'],
        secretariatId: row['secretariat_id'],
        unitId: row['unit_id'],
        // A classificacao vai no DTO porque a fila precisa sinalizar um caso
        // restrito. O TEXTO do caso, nao.
        classification: row['classification'],
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Detalhe de uma solicitacao.
   *
   * Serve a dois publicos, e a distincao e feita pela POLITICA e nao pela
   * consulta: o cidadao ve apenas o proprio, o servidor ve o que o vinculo
   * permite. A versao anterior filtrava por `citizen_id`, o que impedia um
   * servidor autorizado de consultar qualquer caso.
   *
   * Resposta de recurso inexistente e de recurso sem permissao e IDENTICA, para
   * nao permitir enumeracao de protocolos.
   */
  @Get('requests/:id')
  async detail(
    @Param('id') id: string,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    if (!session) return {};

    const now = new Date();
    const target = await this.authorization.requestTarget(id);
    if (target === null) return {};

    // Titular le como cidadao; servidor le pela fila, com escopo conferido.
    const isOwner = target.ownerCitizenId === session.userId;
    const action = isOwner ? 'REQUEST_READ_OWN' : 'REQUEST_READ_QUEUE';
    const decision = await this.authorization.check(session, action, target, now);

    await this.authorization.audit({
      actorUserId: session.userId,
      action,
      resourceType: 'request',
      resourceId: id,
      result: decision.allowed ? 'ALLOWED' : 'DENIED',
      reason: decision.reason,
      correlationId: request.correlationId ?? 'desconhecido',
    });
    if (!decision.allowed) return {};

    const rows = await this.db.run(
      `SELECT r."id", r."protocol", r."state", r."submitted_at", r."completed_at",
              r."priority", r."cycle_number", r."version", r."secretariat_id", r."unit_id",
               r."classification", r."outcome", r."assignee_user_id", r."created_at",
               c."description", sv."name" AS "service_name", sv."guidance",
               sv."requires_representation", sec."name" AS "secretariat_name"
          FROM "requests" r
          LEFT JOIN "request_content" c ON c."request_id" = r."id"
          JOIN "service_versions" sv ON sv."id" = r."service_version_id"
          JOIN "secretariats" sec ON sec."id" = r."secretariat_id"
        WHERE r."id" = $1`,
      [id],
    );
    if (rows.length === 0) return {};

    // Linha do tempo: o cidadao ve SO o que e visivel a ele. O servidor ve
    // tambem as notas internas, e a separacao continua no DTO, e nao em CSS.
    const isServerView = !isOwner;
    const events = await this.db.run(
      `SELECT "type","state_before","state_after","public_text","internal_note","visibility","created_at"
         FROM "request_events"
        WHERE "request_id" = $1
          AND ($2::boolean = true OR "visibility" = 'CITIZEN_VISIBLE')
        ORDER BY "created_at" ASC`,
      [id, isServerView],
    );

    const row = rows[0];
    if (row === undefined) return {};
    return {
      id: row['id'],
      protocol: row['protocol'],
      state: row['state'],
      stateText: CITIZEN_STATE_TEXT[row['state'] as RequestState],
      serviceName: row['service_name'],
      guidance: row['guidance'],
      secretariatName: row['secretariat_name'],
      submittedAt: row['submitted_at'],
      createdAt: row['created_at'],
      dueAt: null,
      dueAtText: 'Prazo em acompanhamento',
      completedAt: row['completed_at'],
      priority: row['priority'],
      cycleNumber: row['cycle_number'],
      version: row['version'],
      classification: row['classification'],
      outcome: row['outcome'],
      secretariatId: row['secretariat_id'],
      unitId: row['unit_id'],
      assigneeUserId: isServerView ? row['assignee_user_id'] : null,
      description: row['description'],
      requiresRepresentation: row['requires_representation'],
      allowedCommands: isServerView ? allowedCommandsFrom(row['state'] as RequestState) : [],
      timeline: events.map((e) => ({
        type: e['type'],
        from: e['state_before'],
        to: e['state_after'],
        text: e['public_text'],
        // A nota interna so existe no DTO de servidor. O campo e omitido
        // inteiro para o cidadao, e nao enviado vazio.
        ...(isServerView ? { internalNote: e['internal_note'] } : {}),
        at: e['created_at'],
      })),
    };
  }

  /**
   * Aplica um comando de workflow.
   *
   * A API recebe comandos de negocio, nao um PATCH generico que aceite
   * qualquer status. O cliente envia o comando e a versao que espera.
   *
   * A AUTORIZACAO acontece aqui, antes de tocar no caso de uso. A versao
   * anterior aceitava qualquer comando de qualquer cidadao autenticado: bastava
   * uma sessao valida para iniciar analise, concluir ou cancelar qualquer
   * pedido. Agora o comando e traduzido em acao e conferido contra o vinculo
   * atual do ator, com o alvo lido do BANCO e nao do corpo da requisicao.
   */
  @Post('requests/:id/commands/:command')
  @HttpCode(200)
  async command(
    @Param('id') id: string,
    @Param('command') command: string,
    @Body() body: {
      expectedVersion: number;
      publicText: string;
      reason?: string;
      outcome?: string;
      justification?: string;
    },
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ ok: boolean; state?: RequestState; version?: number; error?: string }> {
    if (!session) return { ok: false, error: API_ERROR_CODES.UNAUTHENTICATED };

    const now = new Date();
    const correlationId = request.correlationId ?? 'desconhecido';

    // 1. Comando conhecido? Um mapa ausente nega.
    const action = actionForCommand(command);
    if (action === null) {
      return { ok: false, error: 'COMANDO_DESCONHECIDO' };
    }

    // 2. Alvo lido do banco. Confiar no corpo da requisicao permitiria a um
    //    servidor declarar que um pedido de Saude e de Infraestrutura.
    const target = await this.authorization.requestTarget(id);
    if (target === null) {
      // Mesmo formato de resposta para "nao existe" e "sem permissao": a
      // distincao permitiria enumerar pedidos.
      await this.authorization.audit({
        actorUserId: session.userId,
        action: command,
        resourceType: 'request',
        resourceId: id,
        result: 'DENIED',
        reason: 'NAO_ENCONTRADO',
        correlationId,
      });
      return { ok: false, error: 'NAO_ENCONTRADO' };
    }

    // 3. Resposta a complementacao exige que o pedido seja do proprio cidadao.
    if (requiresOwnership(command) && target.ownerCitizenId !== session.userId) {
      await this.authorization.audit({
        actorUserId: session.userId,
        action: command,
        resourceType: 'request',
        resourceId: id,
        result: 'DENIED',
        reason: 'NAO_E_DONO',
        correlationId,
      });
      return { ok: false, error: API_ERROR_CODES.FORBIDDEN };
    }

    // 4. Decisao da politica, com vinculos reconsultados do banco.
    const decision = await this.authorization.check(session, action, target, now);
    await this.authorization.audit({
      actorUserId: session.userId,
      action: command,
      resourceType: 'request',
      resourceId: id,
      result: decision.allowed ? 'ALLOWED' : 'DENIED',
      reason: decision.reason,
      correlationId,
    });
    if (!decision.allowed) {
      return { ok: false, error: API_ERROR_CODES.FORBIDDEN };
    }

    const transitionContext = {
      requestId: id,
      expectedVersion: body.expectedVersion,
      actorUserId: session.userId,
      now,
      publicText: body.publicText,
      reason: body.reason ?? null,
      ...(body.outcome !== undefined
        ? {
            outcome: body.outcome as RequestOutcome,
            justification: body.justification ?? '',
          }
        : {}),
    };

    const result = await this.workflow.apply(
      command as Parameters<WorkflowService['apply']>[0],
      transitionContext,
    );

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, state: result.state, version: result.version };
  }
}
