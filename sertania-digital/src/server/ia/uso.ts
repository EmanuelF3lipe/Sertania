/**
 * Consumo da IA externa (Claude): cada chamada grava os tokens gastos, e um
 * limite mensal opcional faz o sistema voltar para a IA local quando atingido.
 * O mes e contado no fuso de Recife (UTC-3).
 */
import type { Banco } from '../db.js';
import { agoraIso } from '../db.js';

export type OperacaoIa = 'TRIAGEM' | 'NARRATIVA';
export const OPERACAO_TEXTO: Record<OperacaoIa, string> = { TRIAGEM: 'Triagem de solicitações', NARRATIVA: 'Narrativa de relatórios' };

/** Campos de "usage" devolvidos pela Claude API. */
export interface UsoTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export const CHAVE_LIMITE = 'iaLimiteTokensMes';

export function mesAtual(d = new Date()): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 7);
}

export function registrarUso(
  banco: Banco,
  r: { operacao: OperacaoIa; modelo: string; uso: UsoTokens | null; ok: boolean; erro?: string; demandaId?: number | null },
): void {
  const u = r.uso;
  banco.run(
    `INSERT INTO ia_uso (mes, criado_em, operacao, modelo, entrada, saida, cache_leitura, cache_escrita, ok, erro, demanda_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    mesAtual(), agoraIso(), r.operacao, r.modelo,
    u?.input_tokens ?? 0, u?.output_tokens ?? 0, u?.cache_read_input_tokens ?? 0, u?.cache_creation_input_tokens ?? 0,
    r.ok ? 1 : 0, r.erro?.slice(0, 300) ?? null, r.demandaId ?? null,
  );
}

/** Limite mensal em tokens (0 = sem limite). */
export function lerLimite(banco: Banco): number {
  const v = banco.get<{ valor: string }>('SELECT valor FROM parametros WHERE chave = ?', CHAVE_LIMITE)?.valor;
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function definirLimite(banco: Banco, limite: number): void {
  banco.run('INSERT INTO parametros (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', CHAVE_LIMITE, String(Math.max(0, Math.floor(limite))));
}

export function tokensDoMes(banco: Banco, mes = mesAtual()): number {
  return banco.get<{ t: number }>('SELECT COALESCE(SUM(entrada + saida + cache_leitura + cache_escrita), 0) AS t FROM ia_uso WHERE mes = ?', mes)?.t ?? 0;
}

/** true quando o limite mensal existe e ja foi alcancado: a IA local assume. */
export function limiteAtingido(banco: Banco): boolean {
  const limite = lerLimite(banco);
  return limite > 0 && tokensDoMes(banco) >= limite;
}

interface Soma { chamadas: number; falhas: number; entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number }
const SOMA = `COUNT(*) AS chamadas, COALESCE(SUM(1 - ok), 0) AS falhas, COALESCE(SUM(entrada), 0) AS entrada, COALESCE(SUM(saida), 0) AS saida,
  COALESCE(SUM(cache_leitura), 0) AS cacheLeitura, COALESCE(SUM(cache_escrita), 0) AS cacheEscrita`;
const total = (s: Soma) => s.entrada + s.saida + s.cacheLeitura + s.cacheEscrita;

export function resumoUso(banco: Banco) {
  const mes = mesAtual();
  const doMes = banco.get<Soma>(`SELECT ${SOMA} FROM ia_uso WHERE mes = ?`, mes)!;
  const porOperacao = banco.all<Soma & { operacao: OperacaoIa }>(`SELECT operacao, ${SOMA} FROM ia_uso WHERE mes = ? GROUP BY operacao ORDER BY operacao`, mes)
    .map((o) => ({ ...o, rotulo: OPERACAO_TEXTO[o.operacao] ?? o.operacao, total: total(o) }));
  const meses = banco.all<Soma & { mes: string }>(`SELECT mes, ${SOMA} FROM ia_uso GROUP BY mes ORDER BY mes DESC LIMIT 6`)
    .map((m) => ({ ...m, total: total(m) }))
    .reverse();
  const ultimas = banco.all<{ criadoEm: string; operacao: OperacaoIa; modelo: string; entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; ok: number; erro: string | null; demandaId: number | null }>(
    `SELECT criado_em AS criadoEm, operacao, modelo, entrada, saida, cache_leitura AS cacheLeitura, cache_escrita AS cacheEscrita, ok, erro, demanda_id AS demandaId
     FROM ia_uso ORDER BY id DESC LIMIT 20`,
  );
  const limite = lerLimite(banco);
  const usado = total(doMes);
  return {
    mes,
    limite,
    usado,
    atingido: limite > 0 && usado >= limite,
    doMes: { ...doMes, total: usado },
    porOperacao,
    meses,
    ultimas: ultimas.map((u) => ({ ...u, ok: u.ok === 1 })),
  };
}
