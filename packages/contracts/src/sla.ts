/**
 * Politicas de prazo e calculo de calendario (especificacao secao 8).
 *
 * Regras implementadas aqui:
 * - Horarios armazenados em UTC; calendario calculado em America/Recife.
 * - O recibo automatico NAO conta como primeira resposta humana.
 * - A politica aplicada ao pedido e CONGELADA. Mudanca exceptional registra
 *   motivo, responsavel e valores anteriores.
 * - Pausas so ocorrem nos estados e condicoes aprovados, e cada pausa registra
 *   inicio e fim.
 * - O prazo total nao reinicia por transferencia de secretaria.
 * - Tempo total corrido e tempo contabilizado pela politica sao mantidos
 *   separadamente e visiveis.
 */
import { MUNICIPAL_TIMEZONE } from './auth.js';
import type { RequestState as State } from './request.js';

export type SlaUnit = 'BUSINESS_HOURS' | 'CALENDAR_HOURS' | 'BUSINESS_DAYS' | 'CALENDAR_DAYS';

/** Um dia do calendario municipal, ja resolvido na zona America/Recife. */
export interface CalendarDay {
  readonly date: string; // YYYY-MM-DD na zona municipal
  readonly isBusinessDay: boolean;
  /** true para feriado municipal aprovado. */
  readonly isHoliday: boolean;
  /** Expediente em minutos a partir da meia-noite local. */
  readonly opensMinuteOfDay: number | null;
  readonly closesMinuteOfDay: number | null;
}

export interface SlaPolicySnapshot {
  readonly policyId: string;
  readonly version: number;
  /** Prazo de primeira resposta humana, em minutos de expediente. */
  readonly firstResponseMinutes: number;
  /** Prazo de conclusao, na unidade declarada. */
  readonly resolutionMinutes: number;
  readonly resolutionUnit: SlaUnit;
  /** Estados em que o prazo corre normalmente. */
  readonly runningStates: readonly State[];
  /**
   * Estados que PAUSAM o prazo. A especificacao proibe que aguardar
   * informacao encerre automaticamente o caso, especialmente em Saude e em
   * situacoes de vulnerabilidade: pausar congela o relogio, nao finaliza.
   */
  readonly pausedStates: readonly State[];
  /** true quando o prazo foi validado e publicado pelo municipio. */
  readonly isPublishedCommitment: boolean;
  readonly frozenAt: Date;
}

/** Uma pausa registrada, com inicio e fim (secao 8). */
export interface SlaPause {
  readonly pauseId: string;
  readonly state: State;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly reason: string;
  readonly approvedBy: string;
}

export interface SlaClockResult {
  /** Tempo total corrido em minutos, sem pausas. */
  readonly elapsedCalendarMinutes: number;
  /** Tempo contabilizado pela politica, com pausas removidas. */
  readonly elapsedPolicyMinutes: number;
  /** Minutos de expediente efetivamente decorridos dentro da politica. */
  readonly elapsedBusinessMinutes: number;
  /** Instant em que o prazo(target) expira, ou null se a politica nao se aplica. */
  readonly dueAt: Date | null;
  readonly overdue: boolean;
  readonly pausedNow: boolean;
}

export type SlaTarget = 'FIRST_RESPONSE' | 'RESOLUTION';

/**
 * Formatador para extrair hora e minuto na zona municipal.
 *
 * O `year` e `day` ficam de fora de proposito: esta funcao so precisa da hora,
 * e incluir mais campos tornaria a extracao mais lenta sem ganho.
 */
function zoneFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MUNICIPAL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Formatador completo, para extrair a data local na zona padrao.
 *
 * Separado de `zoneFormatter` porque os dois precisam de campos diferentes, e
 * um unico formatador com tudo seria mais lento nas duas situacoes.
 */
function dateFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MUNICIPAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Data local (YYYY-MM-DD) do instante, na zona municipal. */
export function localDateIn(zone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minuto do dia local, 0 a 1439. */
export function localMinuteOfDay(zone: string, instant: Date): number {
  const parts = zoneFormatter().formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  // `hour` pode vir como "24" a meia-noite em en-CA com hour12:false.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return hour * 60 + minute;
}

/** Data local do instante na zona municipal padrao. */
export function localDate(instant: Date): string {
  return `${dateFormatter().format(instant)}`;
}

/**
 * Constroi o calendario para uma janela de dias a partir de uma lista de
 * feriados e expediente aprovados.
 *
 * `holidays` usa YYYY-MM-DD na zona municipal. `businessHours` define o
 * expediente semanal padrao em minutos a partir da meia-noite local.
 */
export function buildCalendar(
  from: Date,
  days: number,
  businessHours: Readonly<Record<number, readonly [number, number]>>,
  holidays: readonly string[] = [],
  timezone: string = MUNICIPAL_TIMEZONE,
): CalendarDay[] {
  const holidaySet = new Set(holidays);
  const out: CalendarDay[] = [];
  const startDate = localDateIn(timezone, from);

  // Anda dia a dia a partir da data local inicial. A soma e feita em UTC para
  // evitar salto de fuso; a conversao volta a usar a zona municipal.
  let cursor = new Date(`${startDate}T12:00:00.000Z`);
  for (let i = 0; i < days; i += 1) {
    const date = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    const hours = businessHours[dow];
    const isHoliday = holidaySet.has(date);
    const isBusinessDay = hours !== undefined && !isHoliday;
    out.push({
      date,
      isBusinessDay,
      isHoliday,
      opensMinuteOfDay: isBusinessDay ? (hours?.[0] ?? null) : null,
      closesMinuteOfDay: isBusinessDay ? (hours?.[1] ?? null) : null,
    });
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return out;
}

/**
 * Minutos de expediente entre dois instantes, usando o calendario.
 *
 * O expediente de um dia pode ser combinado com o seguinte, o que importa para
 * quem trabalha a noite; a funcao soma os minutos de cada dia sobreposto ao
 * intervalo solicitado.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  calendar: readonly CalendarDay[],
  timezone: string = MUNICIPAL_TIMEZONE,
): number {
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;

  const startDate = localDateIn(timezone, from);
  const endDate = localDateIn(timezone, to);

  for (const day of calendar) {
    if (day.date < startDate || day.date > endDate) continue;
    if (!day.isBusinessDay || day.opensMinuteOfDay === null || day.closesMinuteOfDay === null) {
      continue;
    }
    const dayStart = zonedMinuteToInstant(day.date, day.opensMinuteOfDay, timezone);
    const dayEnd = zonedMinuteToInstant(day.date, day.closesMinuteOfDay, timezone);
    const overlapStart = Math.max(from.getTime(), dayStart.getTime());
    const overlapEnd = Math.min(to.getTime(), dayEnd.getTime());
    if (overlapEnd > overlapStart) {
      total += (overlapEnd - overlapStart) / 60_000;
    }
  }
  return Math.round(total);
}

/**
 * Converte "data local + minuto do dia" em instante UTC.
 *
 * Iteramos para evitar os efeitos de horario de verao. Recife nao observa
 * horario de verao atualmente, mas a funcao nao deve depender disso.
 */
function zonedMinuteToInstant(date: string, minuteOfDay: number, timezone: string): Date {
  const guess = new Date(`${date}T00:00:00.000Z`);
  const baseUtc = guess.getTime() + minuteOfDay * 60_000;
  const candidate = new Date(baseUtc);
  const localAt = localMinuteOfDay(timezone, candidate);
  let diff = localAt - minuteOfDay;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return new Date(candidate.getTime() - diff * 60_000);
}

/** Calendar de demonstracao: expediente comercial, sem feriados. */
export const DEMO_BUSINESS_HOURS: Readonly<Record<number, readonly [number, number]>> = {
  1: [8 * 60, 17 * 60], // segunda
  2: [8 * 60, 17 * 60],
  3: [8 * 60, 17 * 60],
  4: [8 * 60, 17 * 60],
  5: [8 * 60, 17 * 60],
};

/** Instantes de pausa que se sobrepoem ao intervalo [from, to). */
function pausesOverlapping(
  from: Date,
  to: Date,
  pauses: readonly SlaPause[],
): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  for (const pause of pauses) {
    const start = pause.startedAt.getTime() > from.getTime() ? pause.startedAt : from;
    // Pausa ainda aberta e tratada ate o instante corrente: o relogio nao
    // corre enquanto a solicitacao esta pausada.
    const end = pause.endedAt && pause.endedAt.getTime() < to.getTime() ? pause.endedAt : to;
    if (end.getTime() > start.getTime()) {
      windows.push({ start, end });
    }
  }
  return windows;
}

function unionWindows(
  windows: ReadonlyArray<{ start: Date; end: Date }>,
): Array<{ start: Date; end: Date }> {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date; end: Date }> = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.start.getTime() <= last.end.getTime()) {
      if (window.end.getTime() > last.end.getTime()) last.end = window.end;
    } else {
      merged.push({ start: window.start, end: window.end });
    }
  }
  return merged;
}

function subtractWindows(
  from: Date,
  to: Date,
  windows: ReadonlyArray<{ start: Date; end: Date }>,
): Array<{ start: Date; end: Date }> {
  let remaining: Array<{ start: Date; end: Date }> = [{ start: from, end: to }];
  for (const cut of windows) {
    const next: Array<{ start: Date; end: Date }> = [];
    for (const segment of remaining) {
      if (cut.end.getTime() <= segment.start.getTime() || cut.start.getTime() >= segment.end.getTime()) {
        next.push(segment);
        continue;
      }
      if (cut.start.getTime() > segment.start.getTime()) {
        next.push({ start: segment.start, end: cut.start });
      }
      if (cut.end.getTime() < segment.end.getTime()) {
        next.push({ start: cut.end, end: segment.end });
      }
    }
    remaining = next;
  }
  return remaining;
}

/**
 * Calcula o relogio de prazo.
 *
 * O criterio 13 da secao 20 exige que o calculo funcione com feriado, pausa,
 * transferencia e reabertura conforme politica congelada. Por isso a funcao
 * recebe a politica ja congelada e a lista de pausas ja persistida.
 */
export function computeSlaClock(input: {
  readonly policy: SlaPolicySnapshot;
  readonly state: State;
  /** Inicio da contagem: envio do protocolo, ou inicio do novo ciclo. */
  readonly startedAt: Date;
  /** Fim da contagem, quando a solicitacao ja foi encerrada. */
  readonly finishedAt?: Date | null;
  readonly pauses: readonly SlaPause[];
  readonly calendar: readonly CalendarDay[];
  readonly now: Date;
  readonly timezone?: string;
}): SlaClockResult {
  const timezone = input.timezone ?? MUNICIPAL_TIMEZONE;
  const from = input.startedAt;
  const to = input.finishedAt ?? input.now;
  const effectiveEnd = to.getTime() < from.getTime() ? from : to;

  const elapsedCalendarMinutes = Math.max(
    0,
    Math.round((effectiveEnd.getTime() - from.getTime()) / 60_000),
  );

  // O prazo so corre nos estados aprovados pela politica. Uma solicitacao em
  // estado pausado nao acumula tempo contabilizado.
  const runsNow = input.policy.runningStates.includes(input.state);
  const isPaused = !runsNow || input.policy.pausedStates.includes(input.state);

  const cutWindows = unionWindows(pausesOverlapping(from, effectiveEnd, input.pauses));
  const running = isPaused ? [] : subtractWindows(from, effectiveEnd, cutWindows);

  const elapsedPolicyMinutes = running.reduce(
    (acc, segment) => acc + Math.round((segment.end.getTime() - segment.start.getTime()) / 60_000),
    0,
  );
  const elapsedBusinessMinutes = running.reduce(
    (acc, segment) =>
      acc + businessMinutesBetween(segment.start, segment.end, input.calendar, timezone),
    0,
  );

  // O prazo so faz sentido enquanto a solicitacao esta aberta. Encerrada, ela
  // nao esta mais "atrasada": o que resta e o historico de cumprimento.
  const isClosed = input.state === 'COMPLETED' || input.state === 'CANCELED';

  // O prazo absoluto e o instante em que o tempo contabilizado consome a cota
  // da politica. Pausas alongam esse prazo na mesma medida em que retiram tempo
  // corrido, entao o mais simples e projetar a partir do inicio somando a cota
  // menos o ja consumido.
  const allowance = policyAllowanceMinutes(
    input.policy.resolutionMinutes,
    input.policy.resolutionUnit,
    input.calendar,
  );

  // Enquanto a solicitacao esta pausada o prazo nao pode vencer: o relogio
  // congelou, logo o vencimento e projetado a partir do instante corrente. Isso
  // evita marcar como atrasado um caso que aguarda apenas o cidadao, o que seria
  // especialmente danoso em Saude e em situacoes de vulnerabilidade.
  const dueAt = isClosed
    ? null
    : isPaused
      ? new Date(input.now.getTime() + Math.max(0, allowance - elapsedPolicyMinutes) * 60_000)
      : new Date(from.getTime() + Math.max(0, allowance - elapsedPolicyMinutes) * 60_000);

  const overdue = !isClosed && dueAt !== null && input.now.getTime() > dueAt.getTime();

  return {
    elapsedCalendarMinutes,
    elapsedPolicyMinutes,
    elapsedBusinessMinutes,
    dueAt,
    overdue,
    pausedNow: isPaused,
  };
}

/**
 * Converte prazo em minutos de expediente no instante inicial, respeitando
 * feriados e expediente.
 */
export function deadlineFrom(
  policy: SlaPolicySnapshot,
  target: SlaTarget,
  startedAt: Date,
  calendar: readonly CalendarDay[],
  timezone: string = MUNICIPAL_TIMEZONE,
): Date | null {
  const isBusinessUnit =
    policy.resolutionUnit === 'BUSINESS_HOURS' || policy.resolutionUnit === 'BUSINESS_DAYS';
  const minutes =
    target === 'FIRST_RESPONSE'
      ? policy.firstResponseMinutes
      : policyAllowanceMinutes(policy.resolutionMinutes, policy.resolutionUnit, calendar);

  // A primeira resposta humana e sempre medida em minutos de expediente: um
  // recibo automatico as 23h nao consome a cota do proximo dia util.
  if (target === 'FIRST_RESPONSE' || isBusinessUnit) {
    return addBusinessMinutes(startedAt, minutes, calendar, timezone);
  }
  return new Date(startedAt.getTime() + minutes * 60_000);
}

/**
 * Minutos uteis que o valor da politica representa.
 *
 * A distincao importa: "5 dias uteis" sao cinco expedienteis completos, o que
 * equivale a 5 x 540 minutos no calendario de demonstracao. Converter dias
 * uteis em 1440 minutos trataria cada dia util como se rodasse 24 horas.
 */
export function policyAllowanceMinutes(
  value: number,
  unit: SlaUnit,
  calendar: readonly CalendarDay[],
): number {
  switch (unit) {
    case 'BUSINESS_HOURS':
      return value * 60;
    case 'CALENDAR_HOURS':
      return value * 60;
    case 'BUSINESS_DAYS':
      return value * businessMinutesPerDay(calendar);
    case 'CALENDAR_DAYS':
      return value * 24 * 60;
  }
}

/** Minutos de expediente de um dia util, conforme o calendario. */
export function businessMinutesPerDay(calendar: readonly CalendarDay[]): number {
  const day = calendar.find(
    (d) => d.isBusinessDay && d.opensMinuteOfDay !== null && d.closesMinuteOfDay !== null,
  );
  if (day === undefined) return 8 * 60;
  return (day.closesMinuteOfDay ?? 0) - (day.opensMinuteOfDay ?? 0);
}

/** Soma minutos de expediente, pulando dias nao uteis. */
export function addBusinessMinutes(
  from: Date,
  minutes: number,
  calendar: readonly CalendarDay[],
  timezone: string = MUNICIPAL_TIMEZONE,
): Date {
  if (minutes <= 0) return from;
  if (calendar.length === 0) {
    // Sem calendario nao ha como respeitar expediente nem feriados; estende em
    // tempo corrido. O operador precisa ampliar o calendario.
    return new Date(from.getTime() + minutes * 60_000);
  }

  const startDate = localDateIn(timezone, from);
  let remaining = minutes;
  let cursor = from;

  // Percorre o calendario uma vez, em ordem. O indice avanca mesmo quando o
  // dia ja foi consumido: sem isso, um instante inicial posterior ao
  // fechamento ficaria preso no mesmo dia e o prazo nunca saltaria para o
  // dia util seguinte.
  for (const day of calendar) {
    if (day.date < startDate) continue;
    if (remaining <= 0) break;
    if (!day.isBusinessDay || day.opensMinuteOfDay === null || day.closesMinuteOfDay === null) {
      continue;
    }
    const dayStart = zonedMinuteToInstant(day.date, day.opensMinuteOfDay, timezone);
    const dayEnd = zonedMinuteToInstant(day.date, day.closesMinuteOfDay, timezone);
    if (dayEnd.getTime() <= cursor.getTime()) continue;

    const startFrom = Math.max(cursor.getTime(), dayStart.getTime());
    const available = (dayEnd.getTime() - startFrom) / 60_000;
    if (available <= 0) continue;

    if (available >= remaining) {
      return new Date(startFrom + remaining * 60_000);
    }
    remaining -= available;
    cursor = dayEnd;
  }

  // Calendario insuficiente para cobrir o prazo: estende em tempo corrido. O
  // operador precisa ampliar o calendario, senao o prazo fica incorreto.
  return new Date(cursor.getTime() + remaining * 60_000);
}

/**
 * Verifica se o prazo foi cumprido dentro da politica, sem contar pausas e sem
 * contar o recibo automatico como primeira resposta humana.
 */
export function isWithinDeadline(input: {
  readonly policy: SlaPolicySnapshot;
  readonly target: SlaTarget;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly pauses: readonly SlaPause[];
  readonly calendar: readonly CalendarDay[];
  readonly timezone?: string;
}): boolean {
  const timezone = input.timezone ?? MUNICIPAL_TIMEZONE;
  const deadline = deadlineFrom(
    input.policy,
    input.target,
    input.startedAt,
    input.calendar,
    timezone,
  );
  if (deadline === null) return true;

  // O que vale e o tempo efetivo: com pausas, o prazo e estendido. Comparar
  // apenas os relogios de parede reprovaria quem respondeu durante uma pausa.
  const cutWindows = unionWindows(pausesOverlapping(input.startedAt, input.finishedAt, input.pauses));
  const running = subtractWindows(input.startedAt, input.finishedAt, cutWindows);
  const effectiveMinutes = running.reduce(
    (acc, s) => acc + (s.end.getTime() - s.start.getTime()) / 60_000,
    0,
  );
  const isBusiness =
    input.target === 'FIRST_RESPONSE' || input.policy.resolutionUnit.startsWith('BUSINESS');
  const spent = isBusiness
    ? running.reduce(
        (acc, s) => acc + businessMinutesBetween(s.start, s.end, input.calendar, timezone),
        0,
      )
    : effectiveMinutes;

  const allowance =
    input.target === 'FIRST_RESPONSE'
      ? input.policy.firstResponseMinutes
      : policyAllowanceMinutes(
          input.policy.resolutionMinutes,
          input.policy.resolutionUnit,
          input.calendar,
        );

  // Comparar apenas os relogios de parede reprovaria quem respondeu durante uma
  // pausa, e reprovaria quem trabalhou fora do expediente.
  return spent <= allowance;
}
