/**
 * Relogio de prazo exposto para a operacao.
 *
 * O navegador nunca calcula o percentual: a politica congelada, as pausas e o
 * calendario municipal ficam no servidor. Assim, duas pessoas consultando o
 * mesmo pedido recebem a mesma fotografia do SLA e a transferencia de setor
 * nao reinicia o relogio.
 */
import { Injectable } from '@nestjs/common';
import {
  DEMO_BUSINESS_HOURS,
  addBusinessMinutes,
  buildCalendar,
  businessMinutesPerDay,
  computeSlaClock,
  policyAllowanceMinutes,
  type RequestState,
  type SlaPause,
  type SlaPolicySnapshot,
  type SlaUnit,
} from '@sertania/contracts';
import { Database, type Row } from '../database/typed-query';

const MINUTES_PER_DAY = 24 * 60;
const MILLIS_PER_DAY = 86_400_000;
const CALENDAR_BUFFER_DAYS = 30;

export interface SlaClockInput {
  readonly requestId: string;
  readonly state: RequestState;
  readonly policyId: string | null;
  readonly startedAt: Date | string | number | null;
  readonly finishedAt: Date | string | number | null;
}

export interface SlaProgress {
  /** Percentual do prazo de conclusao ja consumido, limitado a 100. */
  readonly progressPercent: number;
  /** Minutos contabilizados na unidade do SLA. */
  readonly elapsedMinutes: number;
  /** Cota total convertida para minutos da mesma unidade. */
  readonly targetMinutes: number;
  readonly remainingMinutes: number;
  readonly businessUnit: boolean;
  readonly dueAt: Date | null;
  readonly overdue: boolean;
  readonly paused: boolean;
  readonly publishedCommitment: boolean;
  readonly asOf: Date;
}

interface PolicyRow extends Row {
  readonly id: string;
  readonly version: number;
  readonly first_response_minutes: number;
  readonly resolution_value: number;
  readonly resolution_unit: SlaUnit;
  readonly running_states: string[];
  readonly paused_states: string[];
  readonly is_published_commitment: boolean;
  readonly frozen_at: Date;
}

interface PauseRow extends Row {
  readonly id: string;
  readonly request_id: string;
  readonly state: RequestState;
  readonly started_at: Date;
  readonly ended_at: Date | null;
  readonly reason: string;
  readonly approved_by: string;
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asPositiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function asStates(value: unknown): RequestState[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RequestState => typeof item === 'string');
}

function isBusinessUnit(unit: SlaUnit): boolean {
  return unit === 'BUSINESS_HOURS' || unit === 'BUSINESS_DAYS';
}

/**
 * Cria dias suficientes para medir o passado e projetar o restante do prazo.
 * O limite de cadastro do catalogo e 10.000 dias; portanto a janela continua
 * finita mesmo quando um gestor informa um prazo excepcionalmente grande.
 */
function calendarDaysFor(input: SlaClockInput, policy: SlaPolicySnapshot, now: Date): number {
  const startedAt = asDate(input.startedAt);
  const elapsedDays =
    startedAt === null
      ? 0
      : Math.ceil(Math.max(now.getTime() - startedAt.getTime(), 0) / MILLIS_PER_DAY);
  const futureDays =
    policy.resolutionUnit === 'BUSINESS_DAYS'
      ? policy.resolutionMinutes * 2
      : policy.resolutionUnit === 'CALENDAR_DAYS'
        ? policy.resolutionMinutes
        : Math.ceil(policy.resolutionMinutes / 12);
  return Math.max(CALENDAR_BUFFER_DAYS, elapsedDays + futureDays + CALENDAR_BUFFER_DAYS);
}

function policyFrom(row: PolicyRow): SlaPolicySnapshot {
  return {
    policyId: row.id,
    version: Number(row.version),
    firstResponseMinutes: asPositiveNumber(row.first_response_minutes),
    resolutionMinutes: asPositiveNumber(row.resolution_value),
    resolutionUnit: row.resolution_unit,
    runningStates: asStates(row.running_states),
    pausedStates: asStates(row.paused_states),
    isPublishedCommitment: row.is_published_commitment === true,
    frozenAt: asDate(row.frozen_at) ?? new Date(0),
  };
}

function pauseFrom(row: PauseRow): SlaPause {
  return {
    pauseId: row.id,
    state: row.state,
    startedAt: asDate(row.started_at) ?? new Date(0),
    endedAt: asDate(row.ended_at),
    reason: row.reason,
    approvedBy: row.approved_by,
  };
}

/**
 * Encontra o instante em que a cota foi consumida, inclusive quando o caso ja
 * esta atrasado. Somar a cota ao inicio em tempo corrido seria incorreto para
 * horas/dias uteis e ignoraria pausas; por isso a mesma funcao de relogio usada
 * no percentual e consultada numa busca binaria sobre o calendario persistido.
 */
function deadlineFromClock(
  policy: SlaPolicySnapshot,
  startedAt: Date,
  pauses: readonly SlaPause[],
  calendar: ReturnType<typeof buildCalendar>,
  targetMinutes: number,
  now: Date,
): Date | null {
  const runningState = policy.runningStates[0];
  if (runningState === undefined || targetMinutes <= 0) return null;

  const elapsedAt = (instant: Date): number => {
    const clock = computeSlaClock({
      policy,
      state: runningState,
      startedAt,
      pauses,
      calendar,
      now: instant,
    });
    return policy.resolutionUnit === 'BUSINESS_HOURS' || policy.resolutionUnit === 'BUSINESS_DAYS'
      ? clock.elapsedBusinessMinutes
      : clock.elapsedPolicyMinutes;
  };

  const lastDay = calendar[calendar.length - 1];
  const calendarEnd =
    lastDay === undefined ? null : new Date(`${lastDay.date}T23:59:59.999Z`).getTime();
  let low = startedAt.getTime();
  let high = Math.max(now.getTime(), calendarEnd ?? now.getTime());
  if (high <= low) high = low + targetMinutes * 60_000 + 60_000;

  // O calendario e dimensionado para cobrir a janela, mas o fallback mantém a
  // resposta útil caso uma configuração excepcional exceda essa janela.
  if (elapsedAt(new Date(high)) < targetMinutes) return null;

  while (high - low > 60_000) {
    const middle = Math.floor((low + high) / 2);
    if (elapsedAt(new Date(middle)) >= targetMinutes) high = middle;
    else low = middle;
  }
  // O relogio contratual tem precisao de minuto; normalizar evita devolver um
  // instante intermediario criado pela busca sobre os arredondamentos do
  // calendario, como 08:59:43 para um vencimento as 09:00.
  return new Date(Math.ceil(high / 60_000) * 60_000);
}

@Injectable()
export class SlaProgressService {
  constructor(private readonly db: Database) {}

  async calculate(input: SlaClockInput, now: Date): Promise<SlaProgress | null> {
    const result = await this.calculateMany([input], now);
    return result.get(input.requestId) ?? null;
  }

  async calculateMany(
    inputs: readonly SlaClockInput[],
    now: Date,
  ): Promise<ReadonlyMap<string, SlaProgress | null>> {
    const output = new Map<string, SlaProgress | null>();
    for (const input of inputs) output.set(input.requestId, null);
    if (inputs.length === 0) return output;

    const policyIds = [
      ...new Set(inputs.map((input) => input.policyId).filter((id): id is string => id !== null)),
    ];
    if (policyIds.length === 0) return output;

    const policies = await this.db.run<PolicyRow>(
      `SELECT "id","version","first_response_minutes","resolution_value","resolution_unit",
              "running_states","paused_states","is_published_commitment","frozen_at"
         FROM "sla_policies"
        WHERE "id" = ANY($1::uuid[])`,
      [policyIds],
    );
    const policiesById = new Map(policies.map((row) => [row.id, policyFrom(row)]));

    const requestIds = inputs.map((input) => input.requestId);
    const pauseRows = await this.db.run<PauseRow>(
      `SELECT "id","request_id","state","started_at","ended_at","reason","approved_by"
         FROM "sla_pauses"
        WHERE "request_id" = ANY($1::uuid[])
        ORDER BY "started_at" ASC`,
      [requestIds],
    );
    const pausesByRequest = new Map<string, SlaPause[]>();
    for (const row of pauseRows) {
      const pauses = pausesByRequest.get(row.request_id) ?? [];
      pauses.push(pauseFrom(row));
      pausesByRequest.set(row.request_id, pauses);
    }

    for (const input of inputs) {
      const policy = input.policyId === null ? undefined : policiesById.get(input.policyId);
      const startedAt = asDate(input.startedAt);
      const finishedAt = asDate(input.finishedAt);
      if (policy === undefined || startedAt === null) continue;

      const calendar = buildCalendar(
        startedAt,
        calendarDaysFor(input, policy, now),
        DEMO_BUSINESS_HOURS,
        [],
      );
      const pauses = pausesByRequest.get(input.requestId) ?? [];
      const closed = input.state === 'COMPLETED' || input.state === 'CANCELED';
      // O calculo recebe um estado ativo para preservar o tempo ja consumido
      // antes de uma pausa. A pausa aberta na tabela remove esse intervalo.
      const clockState = policy.runningStates[0] ?? input.state;
      const clock = computeSlaClock({
        policy,
        state: clockState,
        startedAt,
        finishedAt: closed ? finishedAt : null,
        pauses,
        calendar,
        now,
      });
      const targetMinutes = policyAllowanceMinutes(
        policy.resolutionMinutes,
        policy.resolutionUnit,
        calendar,
      );
      const elapsedMinutes = isBusinessUnit(policy.resolutionUnit)
        ? clock.elapsedBusinessMinutes
        : clock.elapsedPolicyMinutes;
      const remainingMinutes = Math.max(0, targetMinutes - elapsedMinutes);
      const hasOpenPause = pauses.some((pause) => pause.endedAt === null);
      const paused =
        !closed &&
        (hasOpenPause ||
          !policy.runningStates.includes(input.state) ||
          policy.pausedStates.includes(input.state));
      const overdue = !closed && !paused && elapsedMinutes > targetMinutes;

      // Quando ainda ha saldo, projetar a partir de agora respeita feriados,
      // fim de semana e a pausa atual. Em atraso, o mesmo relogio recupera o
      // instante historico do vencimento, em vez de inventar uma data futura.
      const dueAt = closed
        ? null
        : paused
          ? isBusinessUnit(policy.resolutionUnit)
            ? addBusinessMinutes(now, remainingMinutes, calendar)
            : new Date(now.getTime() + remainingMinutes * 60_000)
          : (deadlineFromClock(policy, startedAt, pauses, calendar, targetMinutes, now) ??
            (isBusinessUnit(policy.resolutionUnit)
              ? addBusinessMinutes(now, remainingMinutes, calendar)
              : new Date(now.getTime() + remainingMinutes * 60_000)));

      // `businessMinutesPerDay` e calculado aqui apenas para garantir que uma
      // politica de dias uteis nunca resulte em alvo zero se o calendario local
      // estiver vazio por configuracao invalida.
      const safeTarget =
        targetMinutes > 0
          ? targetMinutes
          : policy.resolutionUnit === 'BUSINESS_DAYS'
            ? policy.resolutionMinutes * businessMinutesPerDay(calendar)
            : policy.resolutionMinutes * MINUTES_PER_DAY;

      output.set(input.requestId, {
        progressPercent: Math.min(
          100,
          Math.max(0, Number(((elapsedMinutes / safeTarget) * 100).toFixed(1))),
        ),
        elapsedMinutes: Math.max(0, Math.round(elapsedMinutes)),
        targetMinutes: Math.max(0, Math.round(safeTarget)),
        remainingMinutes: Math.max(0, Math.round(remainingMinutes)),
        businessUnit: isBusinessUnit(policy.resolutionUnit),
        dueAt,
        overdue,
        paused,
        publishedCommitment: policy.isPublishedCommitment,
        asOf: now,
      });
    }

    return output;
  }
}
