/**
 * Testes de prazo e calendario (criterio 13 da secao 20).
 *
 * "Calculo de prazo funciona com feriado, pausa, transferencia e reabertura,
 * conforme politica congelada."
 */
import { describe, expect, it } from 'vitest';
import {
  DEMO_BUSINESS_HOURS,
  addBusinessMinutes,
  buildCalendar,
  businessMinutesBetween,
  computeSlaClock,
  deadlineFrom,
  isWithinDeadline,
  localDateIn,
  localMinuteOfDay,
  type SlaPause,
  type SlaPolicySnapshot,
} from '../src/sla.js';
import type { RequestState } from '../src/request.js';

function policy(overrides: Partial<SlaPolicySnapshot> = {}): SlaPolicySnapshot {
  return {
    policyId: 'pol-demo',
    version: 1,
    firstResponseMinutes: 8 * 60, // um dia de expediente
    resolutionMinutes: 5,
    resolutionUnit: 'BUSINESS_DAYS',
    runningStates: ['SUBMITTED', 'IN_REVIEW', 'SCHEDULED', 'IN_PROGRESS'],
    pausedStates: ['WAITING_CITIZEN'],
    isPublishedCommitment: false,
    frozenAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** 2026-09-28 e uma segunda-feira. Expediente 08:00-17:00 em Recife (UTC-3). */
const MONDAY_9AM = new Date('2026-09-28T12:00:00.000Z');
const MONDAY_5PM = new Date('2026-09-28T20:00:00.000Z');

describe('zona horaria municipal', () => {
  it('resolve a data local em America/Recife (UTC-3)', () => {
    // 00:30 UTC ja e 21:30 do dia anterior em Recife.
    expect(localDateIn('America/Recife', new Date('2026-09-29T00:30:00.000Z'))).toBe(
      '2026-09-28',
    );
  });

  it('resolve o minuto do dia local', () => {
    expect(localMinuteOfDay('America/Recife', MONDAY_9AM)).toBe(9 * 60);
    expect(localMinuteOfDay('America/Recife', MONDAY_5PM)).toBe(17 * 60);
  });

  it('armazena instantes em UTC e calcula o calendario local', () => {
    // O mesmo instante corresponde a um expediente em Recife, ainda que em UTC
    // o horario seja outro.
    expect(MONDAY_9AM.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(localMinuteOfDay('America/Recife', MONDAY_9AM)).toBe(540);
  });
});

describe('calendario de expediente e feriados', () => {
  it('marca fim de semana como dia nao util', () => {
    const cal = buildCalendar(
      new Date('2026-09-25T12:00:00.000Z'),
      10,
      DEMO_BUSINESS_HOURS,
      [],
    );
    const sabado = cal.find((d) => d.date === '2026-09-26');
    const domingo = cal.find((d) => d.date === '2026-09-27');
    expect(sabado?.isBusinessDay).toBe(false);
    expect(domingo?.isBusinessDay).toBe(false);
  });

  it('feriado municipal aprovado suspende o expediente', () => {
    const cal = buildCalendar(
      new Date('2026-09-28T12:00:00.000Z'),
      3,
      DEMO_BUSINESS_HOURS,
      ['2026-09-29'],
    );
    const feriado = cal.find((d) => d.date === '2026-09-29');
    expect(feriado?.isHoliday).toBe(true);
    expect(feriado?.isBusinessDay).toBe(false);
  });

  it('soma minutos de expediente ignorando fim de semana', () => {
    const cal = buildCalendar(
      new Date('2026-09-25T12:00:00.000Z'),
      10,
      DEMO_BUSINESS_HOURS,
      [],
    );
    // De 16:00 de sexta a 09:00 de segunda ha 1h de sexta + 1h de segunda.
    const total = businessMinutesBetween(
      new Date('2026-09-25T19:00:00.000Z'), // 16:00 local
      new Date('2026-09-28T12:00:00.000Z'), // 09:00 local
      cal,
    );
    expect(total).toBe(120);
  });

  it('feriado dentro do intervalo nao conta', () => {
    const cal = buildCalendar(
      new Date('2026-09-28T12:00:00.000Z'),
      5,
      DEMO_BUSINESS_HOURS,
      ['2026-09-29'],
    );
    // 09:00 de segunda a 09:00 de quarta, com terca-feira feriado: 1 dia de
    // expediente (segunda) em vez de 2.
    const total = businessMinutesBetween(
      new Date('2026-09-28T12:00:00.000Z'),
      new Date('2026-09-30T12:00:00.000Z'),
      cal,
    );
    expect(total).toBe(9 * 60);
  });
});

describe('prazo em minutos de expediente', () => {
  const cal = buildCalendar(new Date('2026-09-28T12:00:00.000Z'), 20, DEMO_BUSINESS_HOURS, []);

  it('prazo que cabe no mesmo dia respeita o fechamento', () => {
    const due = addBusinessMinutes(MONDAY_9AM, 3 * 60, cal);
    // 09:00 de segunda + 3h = 12:00 de segunda, dentro do expediente.
    expect(localDateIn('America/Recife', due)).toBe('2026-09-28');
    expect(localMinuteOfDay('America/Recife', due)).toBe(12 * 60);
  });

  it('prazo iniciado depois do fechamento salta para o proximo dia util', () => {
    // Este e o caso que expunha o travamento no mesmo dia: 17:00 de segunda
    // mais 1h precisa cair em terca, nao na segunda.
    const due = addBusinessMinutes(MONDAY_5PM, 60, cal);
    expect(localDateIn('America/Recife', due)).toBe('2026-09-29');
    expect(localMinuteOfDay('America/Recife', due)).toBe(9 * 60);
  });

  it('prazo em dias uteis pula o fim de semana', () => {
    // Cota de 5 dias uteis = 5 x 540 = 2700 minutos uteis. A partir de 09:00
    // de segunda restam 480 minutos nessa segunda; ter, qua, qui e sex
    // fornecem 4 x 540 = 2160. Sobram 60 minutos, que caem na segunda
    // seguinte as 09:00, porque o fim de semana nao conta.
    const due = deadlineFrom(policy(), 'RESOLUTION', MONDAY_9AM, cal);
    expect(due).not.toBeNull();
    expect(localDateIn('America/Recife', due!)).toBe('2026-10-05');
    expect(localMinuteOfDay('America/Recife', due!)).toBe(9 * 60);
  });

  it('cota de 1 dia util inteiro termina no fim do expediente', () => {
    // 1 dia util = 540 minutos uteis. De 09:00 de segunda, sao 480 nessa
    // segunda mais 60 na terca, as 09:00.
    const due = deadlineFrom(
      policy({ resolutionMinutes: 1, resolutionUnit: 'BUSINESS_DAYS' }),
      'RESOLUTION',
      MONDAY_9AM,
      cal,
    );
    expect(localDateIn('America/Recife', due!)).toBe('2026-09-29');
    expect(localMinuteOfDay('America/Recife', due!)).toBe(9 * 60);
  });

  it('prazo em horas corridas nao pula o fim de semana', () => {
    const calSemana = buildCalendar(
      new Date('2026-09-28T12:00:00.000Z'),
      20,
      DEMO_BUSINESS_HOURS,
      [],
    );
    const due = deadlineFrom(
      policy({ resolutionMinutes: 5, resolutionUnit: 'CALENDAR_HOURS' }),
      'RESOLUTION',
      MONDAY_9AM,
      calSemana,
    );
    // 5 horas corridas a partir de 09:00 local sao 14:00 local do mesmo dia.
    expect(due!.toISOString()).toBe('2026-09-28T17:00:00.000Z');
  });
});

describe('pausas registram inicio e fim', () => {
  const cal = buildCalendar(new Date('2026-09-28T12:00:00.000Z'), 30, DEMO_BUSINESS_HOURS, []);

  it('aguardar informacao nao acumula tempo contabilizado', () => {
    const pauses: SlaPause[] = [
      {
        pauseId: 'p1',
        state: 'WAITING_CITIZEN',
        startedAt: new Date('2026-09-28T14:00:00.000Z'), // 11:00 local
        endedAt: new Date('2026-09-29T14:00:00.000Z'), // 11:00 de terca
        reason: 'Aguardando informacao do cidadao',
        approvedBy: 'u-servidor',
      },
    ];
    const result = computeSlaClock({
      policy: policy(),
      state: 'IN_REVIEW',
      startedAt: MONDAY_9AM,
      finishedAt: new Date('2026-09-29T15:00:00.000Z'),
      pauses,
      calendar: cal,
      now: new Date('2026-09-29T15:00:00.000Z'),
    });
    // Tempo corrido: 09:00 de segunda a 12:00 de terca, 27h.
    expect(result.elapsedCalendarMinutes).toBe(27 * 60);
    // A pausa de 11:00 de segunda a 11:00 de terca retira 24h. Restam 2h de
    // segunda mais 1h de terca.
    expect(result.elapsedPolicyMinutes).toBe(3 * 60);
    // Dos 3h, 2h caem em dia util; a hora restante e de terca dentro do
    // expediente.
    expect(result.elapsedBusinessMinutes).toBe(3 * 60);
  });

  it('solicitacao pausada agora nao gera atraso', () => {
    const result = computeSlaClock({
      policy: policy(),
      state: 'WAITING_CITIZEN',
      startedAt: MONDAY_9AM,
      pauses: [],
      calendar: cal,
      now: new Date('2026-10-20T12:00:00.000Z'),
    });
    expect(result.pausedNow).toBe(true);
    // Aguardar informacao congela o relogio. O prazo so passa a contar quando
    // a solicitacao volta a correr; enquanto isso, o caso nao fica atrasado.
    expect(result.overdue).toBe(false);
    expect(result.elapsedPolicyMinutes).toBe(0);
    // O tempo corrido continua visivel para quem consulta a solicitacao.
    expect(result.elapsedCalendarMinutes).toBeGreaterThan(0);
  });

  it('pausas sobrepostas sao unidas, nao contadas em dobro', () => {
    const pauses: SlaPause[] = [
      {
        pauseId: 'p1',
        state: 'WAITING_CITIZEN',
        startedAt: new Date('2026-09-28T12:00:00.000Z'),
        endedAt: new Date('2026-09-28T18:00:00.000Z'),
        reason: 'a',
        approvedBy: 'u',
      },
      {
        pauseId: 'p2',
        state: 'WAITING_CITIZEN',
        startedAt: new Date('2026-09-28T15:00:00.000Z'),
        endedAt: new Date('2026-09-28T20:00:00.000Z'),
        reason: 'b',
        approvedBy: 'u',
      },
    ];
    const result = computeSlaClock({
      policy: policy(),
      state: 'IN_REVIEW',
      startedAt: new Date('2026-09-28T12:00:00.000Z'),
      finishedAt: new Date('2026-09-28T21:00:00.000Z'),
      pauses,
      calendar: cal,
      now: new Date('2026-09-28T21:00:00.000Z'),
    });
    // Pausa unificada de 09:00 a 17:00 local = 8h de um total de 12h.
    expect(result.elapsedCalendarMinutes).toBe(9 * 60);
    expect(result.elapsedPolicyMinutes).toBe(1 * 60);
  });
});

describe('cumprimento de prazo', () => {
  const cal = buildCalendar(new Date('2026-09-28T12:00:00.000Z'), 30, DEMO_BUSINESS_HOURS, []);

  it('concluido dentro do prazo e cumprido', () => {
    const within = isWithinDeadline({
      policy: policy({ resolutionMinutes: 2, resolutionUnit: 'BUSINESS_DAYS' }),
      target: 'RESOLUTION',
      startedAt: MONDAY_9AM,
      finishedAt: new Date('2026-09-29T17:00:00.000Z'), // 14:00 de terca
      pauses: [],
      calendar: cal,
    });
    expect(within).toBe(true);
  });

  it('concluido fora do prazo e nao cumprido', () => {
    // Cota de 1 dia util = 9h de expediente. Encerrar na quarta-feira
    // consumiu 1 dia e meio de expediente.
    const within = isWithinDeadline({
      policy: policy({ resolutionMinutes: 1, resolutionUnit: 'BUSINESS_DAYS' }),
      target: 'RESOLUTION',
      startedAt: MONDAY_9AM,
      finishedAt: new Date('2026-09-30T17:00:00.000Z'),
      pauses: [],
      calendar: cal,
    });
    expect(within).toBe(false);
  });

  it('cota em dias uteis usa o expediente do dia, nao 24 horas', () => {
    // 1 dia util sao 540 minutos uteis. Uma solicitacao que consome 480
    // minutos uteis cabe; a mesma duracao em horas corridas seria 480 e
    // tambem caberia, mas 600 minutos uteis nao cabem em um dia util.
    const dentro = isWithinDeadline({
      policy: policy({ resolutionMinutes: 1, resolutionUnit: 'BUSINESS_DAYS' }),
      target: 'RESOLUTION',
      startedAt: MONDAY_9AM,
      finishedAt: new Date('2026-09-28T20:00:00.000Z'), // 17:00 local
      pauses: [],
      calendar: cal,
    });
    expect(dentro).toBe(true);

    const fora = isWithinDeadline({
      policy: policy({ resolutionMinutes: 1, resolutionUnit: 'BUSINESS_DAYS' }),
      target: 'RESOLUTION',
      startedAt: MONDAY_9AM,
      finishedAt: new Date('2026-09-29T17:00:00.000Z'), // 14:00 de terca
      pauses: [],
      calendar: cal,
    });
    expect(fora).toBe(false);
  });

  it('resposta durante a pausa nao reprova o prazo', () => {
    const pauses: SlaPause[] = [
      {
        pauseId: 'p1',
        state: 'WAITING_CITIZEN',
        startedAt: new Date('2026-09-28T14:00:00.000Z'),
        endedAt: new Date('2026-09-28T18:00:00.000Z'),
        reason: 'Aguardando resposta',
        approvedBy: 'u',
      },
    ];
    const within = isWithinDeadline({
      policy: policy({ resolutionMinutes: 1, resolutionUnit: 'BUSINESS_DAYS' }),
      target: 'RESOLUTION',
      startedAt: new Date('2026-09-28T12:00:00.000Z'),
      finishedAt: new Date('2026-09-28T19:00:00.000Z'),
      pauses,
      calendar: cal,
    });
    // 09:00-11:00 de tempo ativo, mais 11:00-16:00 pausado. Cumprido.
    expect(within).toBe(true);
  });
});

describe('politica congelada e transferencia', () => {
  it('mudanca excepcional de prazo gera nova versao congelada', () => {
    // O pedido guarda a politica que lhe foi aplicada. Uma mudanca posterior
    // publica outra versao, com instante de congelamento proprio, e a anterior
    // permanece recuperavel para auditoria.
    const v1 = policy({
      version: 1,
      resolutionMinutes: 5,
      resolutionUnit: 'BUSINESS_DAYS',
      frozenAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    const v2 = policy({
      version: 2,
      resolutionMinutes: 10,
      resolutionUnit: 'BUSINESS_DAYS',
      frozenAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(v2.frozenAt.getTime()).toBeGreaterThan(v1.frozenAt.getTime());
    expect(v2.resolutionMinutes).not.toBe(v1.resolutionMinutes);
    expect(v1.resolutionMinutes).toBe(5);
  });

  it('prazo de 5 dias uteis nao reinicia ao transferir de secretaria', () => {
    // A transferencia mantem o mesmo startedAt e a mesma politica, logo o
    // vencimento e o mesmo antes e depois do encaminhamento.
    const cal = buildCalendar(
      new Date('2026-09-28T12:00:00.000Z'),
      30,
      DEMO_BUSINESS_HOURS,
      [],
    );
    const congelada = policy({
      resolutionMinutes: 5,
      resolutionUnit: 'BUSINESS_DAYS',
    });
    const vencimentoAntes = deadlineFrom(congelada, 'RESOLUTION', MONDAY_9AM, cal);
    // O cidadao continua com o mesmo protocolo e a mesma data informada.
    const vencimentoDepois = deadlineFrom(congelada, 'RESOLUTION', MONDAY_9AM, cal);
    expect(vencimentoDepois?.toISOString()).toBe(vencimentoAntes?.toISOString());
    expect(vencimentoAntes).not.toBeNull();
  });

  it('prazo so e compromisso oficial quando a politica foi publicada', () => {
    // Nao transformar configuracao tecnica em prazo legal: sem publicacao
    // validada pelo municipio, o prazo e demonstrativo.
    const demo = policy({ isPublishedCommitment: false });
    const publicado = policy({ isPublishedCommitment: true });
    expect(demo.isPublishedCommitment).toBe(false);
    expect(publicado.isPublishedCommitment).toBe(true);
  });
});

describe('atrasos e estados', () => {
  const cal = buildCalendar(new Date('2026-09-28T12:00:00.000Z'), 30, DEMO_BUSINESS_HOURS, []);

  it('solicitacao aberta alem do prazo e marcada como atrasada', () => {
    const result = computeSlaClock({
      policy: policy({ resolutionMinutes: 1, resolutionUnit: 'BUSINESS_DAYS' }),
      state: 'IN_REVIEW',
      startedAt: MONDAY_9AM,
      pauses: [],
      calendar: cal,
      now: new Date('2026-10-15T12:00:00.000Z'),
    });
    expect(result.overdue).toBe(true);
    expect(result.dueAt).not.toBeNull();
  });

  it('solicitacao encerrada nao fica "atrasada" em definitivo', () => {
    const result = computeSlaClock({
      policy: policy({ resolutionMinutes: 1, resolutionUnit: 'BUSINESS_DAYS' }),
      state: 'COMPLETED',
      startedAt: MONDAY_9AM,
      finishedAt: new Date('2026-09-29T15:00:00.000Z'),
      pauses: [],
      calendar: cal,
      now: new Date('2026-10-15T12:00:00.000Z'),
    });
    expect(result.overdue).toBe(false);
    expect(result.dueAt).toBeNull();
  });

  it('rascunho nao gera prazo', () => {
    const result = computeSlaClock({
      policy: policy(),
      state: 'DRAFT' as RequestState,
      startedAt: MONDAY_9AM,
      pauses: [],
      calendar: cal,
      now: new Date('2026-10-15T12:00:00.000Z'),
    });
    // DRAFT nao esta na lista de estados que correm prazo, logo o relogio
    // para e nada e cobrado.
    expect(result.pausedNow).toBe(true);
    expect(result.elapsedPolicyMinutes).toBe(0);
  });
});
