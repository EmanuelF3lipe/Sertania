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
  BadRequestException,
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
  isCompletionOutcome,
  TRANSITION_RULES,
  type RequestOutcome,
  type RequestState,
  type WorkflowCommand,
} from '@sertania/contracts';
import { OpenRequestService, type OpenRequestInput } from '../requests/open-request.service';
import { WorkflowService } from '../requests/workflow.service';
import { CurrentSession, Public, type AuthenticatedRequest } from '../auth/session.guard';
import type { SessionClaims } from '../auth/session.service';
import { Database } from '../database/typed-query';
import { AuthorizationService } from '../authorization/authorization.service';
import { actionForCommand, requiresOwnership } from '../authorization/command-permissions';
import { SlaProgressService, type SlaClockInput, type SlaProgress } from './sla-progress.service';

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function operationalSlaFields(sla: SlaProgress | null): {
  readonly dueAt: string | null;
  readonly dueAtText: string;
  readonly sla: Record<string, unknown> | null;
} {
  if (sla === null) {
    return { dueAt: null, dueAtText: 'Prazo em acompanhamento', sla: null };
  }
  const dueAt = sla.dueAt?.toISOString() ?? null;
  const dueAtText = sla.overdue
    ? `Prazo vencido em ${sla.dueAt?.toLocaleString('pt-BR') ?? 'data indisponivel'}`
    : sla.paused
      ? 'Prazo pausado enquanto aguarda informacao'
      : dueAt === null
        ? 'Prazo encerrado'
        : `Vence em ${sla.dueAt?.toLocaleString('pt-BR') ?? 'acompanhamento'}`;
  return {
    dueAt,
    dueAtText,
    sla: {
      progressPercent: sla.progressPercent,
      elapsedMinutes: sla.elapsedMinutes,
      targetMinutes: sla.targetMinutes,
      remainingMinutes: sla.remainingMinutes,
      businessUnit: sla.businessUnit,
      dueAt,
      overdue: sla.overdue,
      paused: sla.paused,
      publishedCommitment: sla.publishedCommitment,
      asOf: sla.asOf.toISOString(),
    },
  };
}

const OUTCOME_TEXT: Readonly<Record<RequestOutcome, string>> = {
  RESOLVED: 'Pedido atendido',
  DENIED: 'Pedido nao atendido',
  DUPLICATE: 'Pedido identificado como duplicado',
  OUT_OF_SCOPE: 'Pedido fora da competencia da prefeitura',
};

function outcomeTextFor(value: unknown): string | null {
  return typeof value === 'string' && isCompletionOutcome(value)
    ? OUTCOME_TEXT[value]
    : null;
}

function requiredCommandText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new BadRequestException(`${field} e obrigatorio.`);
  const text = value.trim();
  if (text.length === 0) throw new BadRequestException(`${field} e obrigatorio.`);
  if (text.length > 10_000) throw new BadRequestException(`${field} e muito longo.`);
  return text;
}

function optionalCommandText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} invalido.`);
  const text = value.trim();
  if (text.length > 10_000) throw new BadRequestException(`${field} e muito longo.`);
  return text === '' ? null : text;
}

function commandRequiresPublicText(command: string): boolean {
  if (command === 'REQUEST_INFORMATION') return true;
  return TRANSITION_RULES[command as WorkflowCommand]?.requiresPublicReason === true;
}

@Controller('api/v1')
export class RequestsController {
  constructor(
    private readonly openRequest: OpenRequestService,
    private readonly workflow: WorkflowService,
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
    private readonly slaProgress: SlaProgressService,
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
      `SELECT r."id",r."protocol",r."state",r."submitted_at",r."completed_at",r."canceled_at",
              r."priority",r."cycle_number",r."outcome",r."sla_policy_id",r."cycle_started_at",
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
    const now = new Date();
    const slaByRequest = await this.slaProgress.calculateMany(
      rows.map((row): SlaClockInput => ({
        requestId: String(row['id']),
        state: row['state'] as RequestState,
        policyId: (row['sla_policy_id'] as string | null) ?? null,
        startedAt: (row['cycle_started_at'] as Date | string | null) ?? null,
        finishedAt:
          (row['completed_at'] as Date | string | null) ??
          (row['canceled_at'] as Date | string | null) ??
          null,
      })),
      now,
    );

    return {
      items: rows.map((row) => ({
        ...operationalSlaFields(slaByRequest.get(String(row['id'])) ?? null),
        id: row['id'],
        protocol: row['protocol'],
        state: row['state'],
        stateText: CITIZEN_STATE_TEXT[row['state'] as RequestState],
        serviceName: row['service_name'],
        secretariatName: row['secretariat_name'],
        createdAt: row['created_at'],
        submittedAt: row['submitted_at'],
        completedAt: row['completed_at'],
        priority: row['priority'],
        cycleNumber: row['cycle_number'],
        outcome: row['outcome'] ?? null,
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
    @Query('priority') priority?: string,
    @Query('classification') classification?: string,
    @Query('search') search?: string,
    @Query('assignee') assignee?: string,
  ): Promise<{ items: ReadonlyArray<Record<string, unknown>>; total: number; limit: number; offset: number }> {
    if (!session) return { items: [], total: 0, limit: 20, offset: 0 };

    const limit = Math.min(Math.max(Number(limitRaw ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);
    const now = new Date();

    // O escopo vem dos vinculos RECONSULTADOS agora. Um vinculo revogado
    // remove a secretaria da lista na proxima chamada.
    const subject = await this.authorization.subjectFor(session, now);
    const memberships = subject.memberships.filter(
      (membership) =>
        (membership.role === 'ATTENDANT' ||
          membership.role === 'OPERATIONAL_TEAM' ||
          membership.role === 'SECRETARY_MANAGER') &&
        (subject.currentContext === null ||
          subject.currentContext.membershipId === membership.membershipId),
    );
    if (memberships.length === 0) {
      return { items: [], total: 0, limit, offset };
    }

    // A fila precisa respeitar secretaria, unidades e classificação. Uma lista
    // simples de secretarias seria suficiente para o primeiro seed, mas vazaria
    // pedidos de outras unidades assim que um gestor ganhasse um escopo parcial.
    const scopeParams: unknown[] = [];
    const scope = memberships
      .map((membership) => {
        const secretariatParameter = scopeParams.push(membership.secretariatId);
        const unitPredicate =
          membership.unitIds.length === 0
            ? 'TRUE'
            : `r."unit_id" = ANY($${scopeParams.push(membership.unitIds)}::uuid[])`;
        const restrictedPredicate =
          membership.role === 'ATTENDANT' || membership.role === 'SECRETARY_MANAGER'
            ? 'TRUE'
            : `r."classification" NOT IN ('RESTRICTED_PERSONAL','RESTRICTED_SENSITIVE')`;
        return `(r."secretariat_id" = $${secretariatParameter} AND ${unitPredicate} AND ${restrictedPredicate})`;
      })
      .join(' OR ');

    const params: unknown[] = [...scopeParams];
    let filtroEstado = '';
    if (state !== undefined && state !== '') {
      params.push(state);
      filtroEstado = ` AND r."state" = $${params.length}`;
    }
    if (priority !== undefined && priority !== '') {
      params.push(priority);
      filtroEstado += ` AND r."priority" = $${params.length}`;
    }
    if (classification !== undefined && classification !== '') {
      params.push(classification);
      filtroEstado += ` AND r."classification" = $${params.length}`;
    }
    const textoBusca = search?.trim().slice(0, 100) ?? '';
    if (textoBusca !== '') {
      params.push(`%${textoBusca}%`);
      filtroEstado += ` AND (r."protocol" ILIKE $${params.length} OR sv."name" ILIKE $${params.length})`;
    }
    if (assignee === 'mine') {
      params.push(session.userId);
      filtroEstado += ` AND r."assignee_user_id" = $${params.length}`;
    } else if (assignee === 'unassigned') {
      filtroEstado += ' AND r."assignee_user_id" IS NULL';
    }
    params.push(limit, offset);
    const limiteParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    const rows = await this.db.run(
      `SELECT r."id", r."protocol", r."state", r."submitted_at", r."completed_at", r."canceled_at",
              r."priority", r."secretariat_id", r."unit_id", r."classification",
              r."assignee_user_id",
               r."created_at", r."version", r."sla_policy_id", r."cycle_started_at",
               sv."name" AS "service_name",
              sec."name" AS "secretariat_name"
         FROM "requests" r
         JOIN "service_versions" sv ON sv."id" = r."service_version_id"
         JOIN "secretariats" sec ON sec."id" = r."secretariat_id"
         WHERE (${scope})
           AND r."state" <> 'DRAFT'${filtroEstado}
        ORDER BY r."created_at" DESC
        LIMIT ${limiteParam} OFFSET ${offsetParam}`,
      params,
    );
    const slaByRequest = await this.slaProgress.calculateMany(
      rows.map((row): SlaClockInput => ({
        requestId: String(row['id']),
        state: row['state'] as RequestState,
        policyId: (row['sla_policy_id'] as string | null) ?? null,
        startedAt: (row['cycle_started_at'] as Date | string | null) ?? null,
        finishedAt:
          (row['completed_at'] as Date | string | null) ??
          (row['canceled_at'] as Date | string | null) ??
          null,
      })),
      now,
    );
    const total = await this.db.count(
      `SELECT count(*)::int
          FROM "requests" r
          JOIN "service_versions" sv ON sv."id" = r."service_version_id"
         WHERE (${scope})
           AND r."state" <> 'DRAFT'${filtroEstado}`,
      params.slice(0, params.length - 2),
    );

    return {
      items: rows.map((row) => ({
        ...operationalSlaFields(slaByRequest.get(String(row['id'])) ?? null),
        id: row['id'],
        protocol: row['protocol'],
        state: row['state'],
        stateText: CITIZEN_STATE_TEXT[row['state'] as RequestState],
        serviceName: row['service_name'],
        citizenName: null,
        createdAt: row['created_at'],
        version: row['version'],
        submittedAt: row['submitted_at'],
        completedAt: row['completed_at'],
        priority: row['priority'],
        assigneeUserId: row['assignee_user_id'],
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
      `SELECT r."id", r."protocol", r."state", r."submitted_at", r."completed_at", r."canceled_at",
              r."priority", r."cycle_number", r."version", r."secretariat_id", r."unit_id",
               r."classification", r."outcome", r."assignee_user_id", r."created_at",
               r."scheduled_for", r."schedule_is_estimate",
               r."sla_policy_id", r."cycle_started_at",
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
    const sla = await this.slaProgress.calculate(
      {
        requestId: String(row['id']),
        state: row['state'] as RequestState,
        policyId: (row['sla_policy_id'] as string | null) ?? null,
        startedAt: (row['cycle_started_at'] as Date | string | null) ?? null,
        finishedAt:
          (row['completed_at'] as Date | string | null) ??
          (row['canceled_at'] as Date | string | null) ??
          null,
      },
      now,
    );
    return {
      ...operationalSlaFields(sla),
      id: row['id'],
      protocol: row['protocol'],
      state: row['state'],
      stateText: CITIZEN_STATE_TEXT[row['state'] as RequestState],
      serviceName: row['service_name'],
      guidance: row['guidance'],
      secretariatName: row['secretariat_name'],
      submittedAt: row['submitted_at'],
      createdAt: row['created_at'],
      completedAt: row['completed_at'],
      priority: row['priority'],
      cycleNumber: row['cycle_number'],
      version: row['version'],
      classification: row['classification'],
      outcome: row['outcome'],
      outcomeText: outcomeTextFor(row['outcome']),
      scheduledFor: row['scheduled_for'],
      scheduleIsEstimate: row['schedule_is_estimate'],
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
   * Atribui ou retira o responsavel de um pedido.
   *
   * A atribuicao nao e uma transicao de estado: ela muda a responsabilidade
   * operacional e precisa de concorrencia otimista propria. O servidor valida
   * novamente que o responsavel pertence a mesma secretaria/unidade antes de
   * tocar no pedido; um id vindo do navegador nunca e suficiente para conceder
   * acesso a outra area.
   */
  @Post('requests/:id/assignment')
  @HttpCode(200)
  async assignment(
    @Param('id') id: string,
    @Body() body: {
      expectedVersion?: number;
      assigneeUserId?: string | null;
    },
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ ok: boolean; version?: number; assigneeUserId?: string | null; error?: string }> {
    if (!session) return { ok: false, error: API_ERROR_CODES.UNAUTHENTICATED };
    if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) {
      throw new BadRequestException('A versao esperada do pedido e obrigatoria.');
    }

    const target = await this.authorization.requestTarget(id);
    const correlationId = request.correlationId ?? 'desconhecido';
    if (target === null) {
      await this.authorization.audit({
        actorUserId: session.userId,
        action: 'REQUEST_ASSIGN',
        resourceType: 'request',
        resourceId: id,
        result: 'DENIED',
        reason: 'NAO_ENCONTRADO',
        correlationId,
      });
      return { ok: false, error: API_ERROR_CODES.NOT_FOUND };
    }

    const decision = await this.authorization.check(session, 'REQUEST_ASSIGN', target, new Date());
    await this.authorization.audit({
      actorUserId: session.userId,
      action: 'REQUEST_ASSIGN',
      resourceType: 'request',
      resourceId: id,
      result: decision.allowed ? 'ALLOWED' : 'DENIED',
      reason: decision.reason,
      correlationId,
    });
    if (!decision.allowed) return { ok: false, error: API_ERROR_CODES.FORBIDDEN };

    const assigneeUserId = body.assigneeUserId === undefined ? session.userId : body.assigneeUserId;
    if (assigneeUserId !== null) {
      if (!isUuid(assigneeUserId)) throw new BadRequestException('Responsavel invalido.');
      const eligible = await this.db.run(
        `SELECT m."id"
           FROM "memberships" m
           JOIN "users" u ON u."id" = m."user_id"
          WHERE m."user_id" = $1
            AND u."is_server" = true
            AND u."status" = 'ACTIVE'
            AND m."secretariat_id" = $2
            AND m."active" = true
            AND m."starts_at" <= now()
            AND (m."expires_at" IS NULL OR m."expires_at" > now())
            AND m."role" IN ('ATTENDANT','OPERATIONAL_TEAM','SECRETARY_MANAGER')
            AND (cardinality(m."unit_ids") = 0 OR $3::uuid = ANY(m."unit_ids"))`,
        [assigneeUserId, target.secretariatId, target.unitId],
      );
      if (eligible.length === 0) {
        throw new BadRequestException('O responsavel precisa estar ativo na secretaria e unidade do pedido.');
      }
    }

    const rows = await this.db.run<{ version: number; assignee_user_id: string | null }>(
      `UPDATE "requests"
          SET "assignee_user_id" = $2, "version" = "version" + 1, "updated_at" = now()
        WHERE "id" = $1 AND "version" = $3
      RETURNING "version", "assignee_user_id"`,
      [id, assigneeUserId, body.expectedVersion],
    );
    const updated = rows[0];
    if (updated === undefined) return { ok: false, error: API_ERROR_CODES.VERSION_CONFLICT };
    return {
      ok: true,
      version: Number(updated.version),
      assigneeUserId: updated.assignee_user_id,
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
      expectedVersion?: unknown;
      publicText?: unknown;
      reason?: unknown;
      outcome?: unknown;
      justification?: unknown;
      question?: unknown;
      expectedResponse?: unknown;
      scheduledFor?: unknown;
      isEstimate?: unknown;
    } | undefined,
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

    if (!Number.isInteger(body?.expectedVersion) || (body?.expectedVersion as number) < 1) {
      throw new BadRequestException('A versao esperada do pedido e obrigatoria.');
    }
    const expectedVersion = body?.expectedVersion as number;
    const publicText = commandRequiresPublicText(command)
      ? requiredCommandText(body?.publicText, 'A mensagem publica')
      : optionalCommandText(body?.publicText, 'A mensagem publica') ??
        'Atualizacao registrada pela equipe responsavel.';
    const reason = optionalCommandText(body?.reason, 'O motivo');
    let completion: { readonly outcome: RequestOutcome; readonly justification: string } | null = null;
    if (command === 'COMPLETE') {
      if (typeof body?.outcome !== 'string' || !isCompletionOutcome(body.outcome)) {
        throw new BadRequestException('O resultado da conclusao e obrigatorio.');
      }
      completion = {
        outcome: body.outcome,
        justification: requiredCommandText(body.justification, 'A justificativa de conclusao'),
      };
    }
    const information =
      command === 'REQUEST_INFORMATION'
        ? {
            question: optionalCommandText(body?.question, 'A pergunta') ?? publicText,
            expectedResponse: optionalCommandText(body?.expectedResponse, 'A resposta esperada'),
          }
        : null;
    let schedule: { readonly scheduledFor: Date; readonly isEstimate: boolean } | null = null;
    if (command === 'SCHEDULE') {
      if (typeof body?.scheduledFor !== 'string') {
        throw new BadRequestException('A data do agendamento e obrigatoria.');
      }
      const scheduledFor = new Date(body.scheduledFor);
      if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= now.getTime()) {
        throw new BadRequestException('A data do agendamento precisa ser valida e futura.');
      }
      if (typeof body.isEstimate !== 'boolean') {
        throw new BadRequestException('Informe se o agendamento e uma previsao.');
      }
      schedule = { scheduledFor, isEstimate: body.isEstimate };
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
      expectedVersion,
      actorUserId: session.userId,
      now,
      publicText,
      reason: command === 'CANCEL' ? reason ?? publicText : reason,
      ...(completion === null ? {} : completion),
      ...(information === null ? {} : information),
      ...(schedule === null ? {} : schedule),
    };

    const result = await this.workflow.apply(
      command as Parameters<WorkflowService['apply']>[0],
      transitionContext,
    );

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, state: result.state, version: result.version };
  }
}
