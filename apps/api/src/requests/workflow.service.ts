/**
 * Caso de uso: comandos de workflow (especificacao secao 6 e 16).
 *
 * A API recebe COMANDOS DE NEGOCIO, e nao um PATCH generico que aceite
 * qualquer status. Cada comando passa por:
 *
 * 1. Autorizacao, com negacao por padrao.
 * 2. Tabela de transicoes, que e a unica fonte de verdade.
 * 3. Verificacao de versao, para conflito controlado em alteracao concorrente.
 * 4. Gravacao do evento, com informacao publica e interna separadas.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Transaction, type Row } from '../database/typed-query';
import {
  canTransition,
  isCompletionOutcome,
  resolveInformationReturn,
  targetStateFor,
  type RequestOutcome,
  type RequestState,
  type WorkflowCommand,
  VersionConflictError,
  OutcomeRequiredError,
  REOPEN_REQUEST_WINDOW_DAYS,
  type InformationClassification,
} from '@sertania/contracts';

export interface TransitionContext {
  readonly requestId: string;
  /** Versao que o cliente espera. Divergencia gera conflito, nao sobrescrita. */
  readonly expectedVersion: number;
  readonly actorUserId: string;
  readonly now: Date;
  /** Texto que o cidadao le. Nao contem jargao interno. */
  readonly publicText: string;
  /** Detalhe interno, gravado mas nunca serializado para o cidadao. */
  readonly internalNote?: string | null;
  readonly reason?: string | null;
}

export interface CompleteContext extends TransitionContext {
  readonly outcome: RequestOutcome;
  /** Justificativa publica obrigatoria na conclusao. */
  readonly justification: string;
  readonly internalNoteReason?: string | null;
}

export interface InformationRequestContext extends TransitionContext {
  readonly question: string;
  readonly expectedResponse: string | null;
}

export interface ScheduleContext extends TransitionContext {
  readonly scheduledFor: Date;
  /**
   * `true` quando e apenas previsao. A especificacao exige distinguir previsao
   * de agendamento efetivo, porque gerar um protocolo nao agenda consulta.
   */
  readonly isEstimate: boolean;
}

export interface ReopenContext extends TransitionContext {
  readonly reason: string;
}

export type WorkflowOutcome =
  | { readonly ok: true; readonly state: RequestState; readonly version: number }
  | { readonly ok: false; readonly error: 'ILLEGAL_TRANSITION' | 'VERSION_CONFLICT' | 'OUTCOME_REQUIRED' | 'NOT_FOUND' | 'REOPEN_WINDOW_CLOSED' };

interface RequestRow {
  readonly id: string;
  readonly state: RequestState;
  readonly version: number;
  readonly submitted_at: Date | null;
  readonly cycle_number: number;
  readonly completed_at: Date | null;
  readonly canceled_at: Date | null;
  readonly outcome: RequestOutcome | null;
  readonly state_before_waiting: RequestState | null;
  readonly classification: InformationClassification;
}

/**
 * Le um instante do banco.
 *
 * O driver devolve `timestamptz` como texto ISO, mas o tipo e `unknown` e
 * poderia ser outra coisa. Um helper explicito deixa a conversao num lugar so
 * e recusa valor inesperado, em vez de gerar `Invalid Date` em silencio.
 */
function instantOf(row: Row, key: string): Date | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') {
    throw new Error(`Coluna ${key} com tipo inesperado: ${typeof value}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Coluna ${key} com data invalida: ${value}`);
  }
  return parsed;
}

/** Converte a linha bruta do banco no tipo usado pelo caso de uso. */
function toRequestRow(row: Row): RequestRow {
  return {
    id: row['id'] as string,
    state: row['state'] as RequestState,
    version: row['version'] as number,
    submitted_at: instantOf(row, 'submitted_at'),
    cycle_number: row['cycle_number'] as number,
    completed_at: instantOf(row, 'completed_at'),
    canceled_at: instantOf(row, 'canceled_at'),
    outcome: (row['outcome'] as RequestOutcome | null) ?? null,
    state_before_waiting: (row['state_before_waiting'] as RequestState | null) ?? null,
    classification: row['classification'] as InformationClassification,
  };
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Aplica um comando de workflow numa transacao.
   *
   * O `SELECT ... FOR UPDATE` serializa alteracoes concorrentes do mesmo
   * pedido. Sem ele, duas pessoas poderiam ler a mesma versao e a segunda
   * gravacao sobrescreveria a primeira em silencio.
   */
  async apply(
    command: WorkflowCommand,
    context: TransitionContext,
    mutate?: (tx: Transaction, request: RequestRow) => Promise<void>,
  ): Promise<WorkflowOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const tx = new Transaction(manager);
      const rows = await tx.run(
        `SELECT "id","state","version","submitted_at","cycle_number","completed_at",
                "canceled_at","outcome","state_before_waiting","classification"
           FROM "requests" WHERE "id" = $1 FOR UPDATE`,
        [context.requestId],
      );

      if (rows.length === 0) {
        return { ok: false, error: 'NOT_FOUND' };
      }
      const raw = rows[0];
      if (raw === undefined) return { ok: false, error: 'NOT_FOUND' };
      const request = toRequestRow(raw);

      // Conflito de concorrencia: outra pessoa ja alterou este pedido.
      if (request.version !== context.expectedVersion) {
        this.logger.warn(
          `Conflito de versao em ${context.requestId}: esperado ${context.expectedVersion}, atual ${request.version}`,
        );
        throw new VersionConflictError(context.expectedVersion, request.version);
      }

      if (!canTransition(request.state, command)) {
        return { ok: false, error: 'ILLEGAL_TRANSITION' };
      }
      if (
        (command === 'REOPEN' || command === 'DECIDE_REOPEN_APPROVE') &&
        request.completed_at !== null &&
        !isReopenWindowOpen(request.completed_at, context.now)
      ) {
        return { ok: false, error: 'REOPEN_WINDOW_CLOSED' };
      }

      let target = targetStateFor(request.state, command);
      if (target === null) {
        return { ok: false, error: 'ILLEGAL_TRANSITION' };
      }
      if (command === 'PROVIDE_INFORMATION') {
        if (request.state_before_waiting === null) {
          return { ok: false, error: 'ILLEGAL_TRANSITION' };
        }
        try {
          target = resolveInformationReturn(request.state, request.state_before_waiting);
        } catch {
          return { ok: false, error: 'ILLEGAL_TRANSITION' };
        }
      }

      // Acao especifica do comando, com os dados que ele exige.
      if (mutate !== undefined) {
        await mutate(tx, request);
      }

      // Campos derivados do destino. Conclusao e cancelamento tem exigencia
      // propria de timestamp e motivo.
      //
      // Os placeholders do `setClause` comecam em $5, porque $1-$4 ja sao
      // usados por state, updated_at, id e version. `derivedFields` devolve
      // o rotulo numerico de cada parametro (ex.: $5, $6) para que a ordem
      // dos valores enviados corresponda exatamente a posicao do placeholder.
      const extra = this.derivedFields(command, target, context, request);
      // A virgula so entra quando existe campo derivado, para nao gerar
      // `SET "updated_at" = $2,` com nada depois.
      const derivedClause = extra.setClause === '' ? '' : `,\n                ${extra.setClause}`;
      // Escrita: usa `write`, nao `run`, porque o TypeORM devolve
      // `[linhas, afetadas]` neste caso.
      const [affectedRows, affectedCount] = await tx.write(
        `UPDATE "requests"
            SET "state" = $1,
                "version" = "version" + 1,
                "updated_at" = $2${derivedClause}
          WHERE "id" = $3 AND "version" = $4
        RETURNING "state","version"`,
        [
          target,
          context.now,
          context.requestId,
          context.expectedVersion,
          ...extra.params,
        ],
      );

      // Um UPDATE sem linha afetada devolve `[[], 0]`. Sem checar os DOIS
      // campos, o conflito passaria despercebido e a gravacao seria perdida.
      if (affectedCount === 0 || affectedRows.length === 0) {
        // Outra transacao alterou entre o SELECT e o UPDATE. A clausula de
        // versao impede a sobrescrita.
        throw new VersionConflictError(context.expectedVersion, request.version + 1);
      }

      if (command === 'REOPEN' || command === 'DECIDE_REOPEN_APPROVE') {
        const nextCycle = request.cycle_number + 1;
        await tx.run(
          `UPDATE "request_cycles"
              SET "closed_at" = COALESCE("closed_at", $1)
            WHERE "request_id" = $2 AND "cycle_number" = $3`,
          [context.now, context.requestId, request.cycle_number],
        );
        await tx.run(
          `INSERT INTO "request_cycles" ("request_id","cycle_number","started_at","from_reopen")
           VALUES ($1,$2,$3,true)`,
          [context.requestId, nextCycle, context.now],
        );
      }

      await this.recordEvent(tx, command, request, target, context);

      // Ciclo fechado ao concluir ou cancelar.
      if (target === 'COMPLETED' || target === 'CANCELED') {
        await tx.run(
          `UPDATE "request_cycles"
              SET "closed_at" = $1
            WHERE "request_id" = $2 AND "cycle_number" = $3 AND "closed_at" IS NULL`,
          [context.now, context.requestId, request.cycle_number],
        );
      }

      // Pausa de prazo: inicia ao pedir complementacao, encerra ao receber
      // resposta. Cada pausa registra inicio e fim (secao 8).
      if (command === 'REQUEST_INFORMATION') {
        const information = context as InformationRequestContext;
        const question = (information.question ?? context.publicText).trim();
        if (question.length === 0) {
          throw new BadRequestException('A pergunta de complementacao e obrigatoria.');
        }
        await tx.run(
          `INSERT INTO "information_requests"
             ("request_id","requested_by","return_state","question","expected_response")
           VALUES ($1,$2,$3,$4,$5)`,
          [
            context.requestId,
            context.actorUserId,
            request.state,
            question,
            information.expectedResponse?.trim() || null,
          ],
        );
        await tx.run(
          `INSERT INTO "sla_pauses" ("request_id","state","started_at","reason","approved_by")
           VALUES ($1, 'WAITING_CITIZEN', $2, $3, $4)`,
          [context.requestId, context.now, context.reason ?? 'Aguardando informacao do cidadao', context.actorUserId],
        );
      }
      if (command === 'PROVIDE_INFORMATION') {
        await tx.run(
          `UPDATE "information_requests"
              SET "status" = 'ANSWERED', "answered_at" = $1
            WHERE "request_id" = $2 AND "status" = 'PENDING'`,
          [context.now, context.requestId],
        );
        await tx.run(
          `UPDATE "sla_pauses" SET "ended_at" = $1
           WHERE "request_id" = $2 AND "ended_at" IS NULL`,
          [context.now, context.requestId],
        );
      }
      if (target === 'CANCELED') {
        await tx.run(
          `UPDATE "information_requests"
              SET "status" = 'CANCELLED'
            WHERE "request_id" = $1 AND "status" = 'PENDING'`,
          [context.requestId],
        );
        await tx.run(
          `UPDATE "sla_pauses" SET "ended_at" = $1
           WHERE "request_id" = $2 AND "ended_at" IS NULL`,
          [context.now, context.requestId],
        );
      }

      // Atencao ao formato: o TypeORM devolve `[rows, affectedCount]` para
      // comandos de escrita com RETURNING, e apenas `rows` para SELECT. Ler
      // `updated[0]` daria o array interno das linhas, e `state` viria
      // `undefined` sem erro visivel.
      const result = affectedRows[0];
      if (result === undefined) {
        throw new Error('Atualizacao de estado nao devolveu linha');
      }
      const newState = result['state'] as RequestState;
      const newVersion = result['version'] as number;
      this.logger.log(
        `${command}: ${context.requestId} ${request.state} -> ${newState} (v${newVersion})`,
      );
      return { ok: true, state: newState, version: newVersion };
    });
  }

  /**
   * Campos adicionais que o destino exige.
   *
   * Montar o `SET` aqui evita concatenar SQL com o comando vindo de fora, e
   * mantem cada exigencia do destino visivel num unico lugar.
   */
  private derivedFields(
    command: WorkflowCommand,
    target: RequestState,
    context: TransitionContext,
    request: RequestRow,
  ): { readonly setClause: string; readonly params: unknown[] } {
    if (command === 'PROVIDE_INFORMATION') {
      return { setClause: '"state_before_waiting" = NULL', params: [] };
    }
    switch (target) {
      case 'SUBMITTED':
        return {
          setClause:
            '"submitted_at" = COALESCE("submitted_at", $5), "cycle_started_at" = COALESCE("cycle_started_at", $5)',
          params: [context.now],
        };
      case 'COMPLETED': {
        // `DECIDE_REOPEN_DENY` conserva a conclusao original. A decisao
        // registra apenas um novo evento e incrementa a versao; nao deve
        // exigir um segundo resultado nem substituir a justificativa anterior.
        if (command !== 'COMPLETE') return { setClause: '', params: [] };
        const complete = context as CompleteContext;
        if (!isCompletionOutcome(complete.outcome) || complete.justification.trim().length === 0) {
          throw new OutcomeRequiredError();
        }
        return {
          setClause:
            '"completed_at" = $5, "outcome" = $6, "outcome_justification" = $7, "internal_outcome_note" = $8',
          params: [
            context.now,
            complete.outcome,
            JSON.stringify({ texto: complete.justification }),
            complete.internalNoteReason ?? null,
          ],
        };
      }
      case 'CANCELED':
        return {
          setClause: '"canceled_at" = $5, "cancel_reason" = $6, "state_before_waiting" = NULL',
          params: [context.now, context.reason ?? 'Cancelado a pedido'],
        };
      case 'WAITING_CITIZEN': {
        // Guarda o estado anterior valido para devolver o pedido ao estagio
        // certo quando o cidadao responder. O valor vem do SELECT anterior.
        return { setClause: '"state_before_waiting" = $5', params: [request.state] };
      }
      case 'SCHEDULED': {
        const schedule = context as ScheduleContext;
        return {
          setClause: '"scheduled_for" = $5, "schedule_is_estimate" = $6',
          params: [schedule.scheduledFor, schedule.isEstimate],
        };
      }
      case 'IN_REVIEW':
        // Reabertura incrementa o ciclo: o tempo do ciclo anterior fica
        // preservado para o indicador de reabertura.
        if (command === 'REOPEN' || command === 'DECIDE_REOPEN_APPROVE') {
          return {
            setClause:
              '"cycle_number" = "cycle_number" + 1, "cycle_started_at" = $5, "completed_at" = NULL, "canceled_at" = NULL, "cancel_reason" = NULL, "outcome" = NULL, "outcome_justification" = NULL, "internal_outcome_note" = NULL, "state_before_waiting" = NULL',
            params: [context.now],
          };
        }
        return { setClause: '', params: [] };
      default:
        // Sem campo derivado, a clausula fica vazia. Um `1 = 1` seria
        // invalido dentro de uma lista SET precedida de virgula.
        return { setClause: '', params: [] };
    }
  }

  private async recordEvent(
    tx: Transaction,
    command: WorkflowCommand,
    request: RequestRow,
    target: RequestState,
    context: TransitionContext,
  ): Promise<void> {
    await tx.run(
      `INSERT INTO "request_events"
         ("request_id","actor_user_id","type","visibility","state_before","state_after",
          "public_text","internal_note","reason","cycle_number","created_at")
       VALUES ($1,$2,$3,'CITIZEN_VISIBLE',$4,$5,$6,$7,$8,$9,$10)`,
      [
        context.requestId,
        context.actorUserId,
        eventTypeFor(command),
        request.state,
        target,
        context.publicText,
        context.internalNote ?? null,
        context.reason ?? null,
        command === 'REOPEN' || command === 'DECIDE_REOPEN_APPROVE'
          ? request.cycle_number + 1
          : request.cycle_number,
        context.now,
      ],
    );
  }
}

/** Traduz o comando no tipo de evento persistido. */
export function eventTypeFor(command: WorkflowCommand): string {
  switch (command) {
    case 'SUBMIT':
      return 'SUBMITTED';
    case 'START_REVIEW':
    case 'RESCHEDULE_TO_REVIEW':
      return 'STATE_CHANGED';
    case 'REQUEST_INFORMATION':
      return 'INFORMATION_REQUESTED';
    case 'PROVIDE_INFORMATION':
      return 'INFORMATION_PROVIDED';
    case 'SCHEDULE':
      return 'SCHEDULED';
    case 'START_EXECUTION':
      return 'EXECUTION_STARTED';
    case 'COMPLETE':
      return 'COMPLETED';
    case 'CANCEL':
      return 'CANCELED';
    case 'REOPEN':
    case 'DECIDE_REOPEN_APPROVE':
    case 'DECIDE_REOPEN_DENY':
      return 'REOPEN_DECIDED';
  }
}

/**
 * Verifica se a janela de reabertura ainda esta aberta.
 *
 * A janela e uma PROPOSTA demonstrativa de sete dias corridos; o valor precisa
 * de validacao municipal (secao 22).
 */
export function isReopenWindowOpen(completedAt: Date, now: Date): boolean {
  const deadline = new Date(completedAt.getTime() + REOPEN_REQUEST_WINDOW_DAYS * 86_400_000);
  return now.getTime() <= deadline.getTime();
}
