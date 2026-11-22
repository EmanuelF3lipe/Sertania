/**
 * Calculo de prazo (SLA) em dias uteis no fuso municipal (America/Recife).
 *
 * Herdado em espirito do repositorio original (packages/contracts/src/sla.ts),
 * mas simplificado: prazo em dias uteis, pausa apenas quando a demanda aguarda o
 * cidadao, e o prazo NAO reinicia quando a demanda e transferida de setor.
 */
export const FUSO = 'America/Recife';

const fmtData = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

export function dataLocal(instante: Date): { data: string; diaSemana: string } {
  const partes = fmtData.formatToParts(instante);
  const get = (t: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === t)?.value ?? '';
  return { data: `${get('year')}-${get('month')}-${get('day')}`, diaSemana: get('weekday') };
}

export function ehDiaUtil(instante: Date, feriados: ReadonlySet<string>): boolean {
  const { data, diaSemana } = dataLocal(instante);
  return diaSemana !== 'Sat' && diaSemana !== 'Sun' && !feriados.has(data);
}

/** Soma N dias uteis a partir de um instante, mantendo a hora. */
export function somarDiasUteis(inicio: Date, dias: number, feriados: ReadonlySet<string>): Date {
  const d = new Date(inicio.getTime());
  let restantes = dias;
  while (restantes > 0) {
    d.setTime(d.getTime() + 24 * 3600 * 1000);
    if (ehDiaUtil(d, feriados)) restantes--;
  }
  return d;
}

export interface EntradaSla {
  criadaEm: Date;
  prazoEm: Date | null;
  pausadaDesde: Date | null;
  encerradaEm: Date | null;
}

export function calcularSla(e: EntradaSla, agora: Date = new Date()) {
  if (!e.prazoEm) return { prazoEm: null, vencida: false, pausada: false, percentual: 0 };
  const referencia = e.encerradaEm ?? e.pausadaDesde ?? agora;
  const total = e.prazoEm.getTime() - e.criadaEm.getTime();
  const usado = referencia.getTime() - e.criadaEm.getTime();
  const percentual = total > 0 ? Math.max(0, Math.round((usado / total) * 100)) : 100;
  return {
    prazoEm: e.prazoEm.toISOString(),
    vencida: referencia.getTime() > e.prazoEm.getTime(),
    pausada: e.pausadaDesde !== null && e.encerradaEm === null,
    percentual,
  };
}
