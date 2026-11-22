import type { Banco } from './db.js';
import { agoraIso } from './db.js';

/** Mascara telefone/e-mail para exibicao a quem nao precisa do dado completo. */
export function mascararTelefone(t: string | null): string | null {
  if (!t) return null;
  const d = t.replace(/\D/g, '');
  return d.length < 4 ? '****' : `(**) *****-${d.slice(-4)}`;
}

export function mascararEmail(e: string | null): string | null {
  if (!e) return null;
  const [u, dom] = e.split('@');
  return `${(u ?? '').slice(0, 1)}***@${dom ?? ''}`;
}

export function mascararNome(n: string | null): string | null {
  if (!n) return null;
  const partes = n.trim().split(/\s+/);
  return partes.map((p, i) => (i === 0 ? p : `${p[0] ?? ''}.`)).join(' ');
}

/**
 * Remove identificadores diretos de um texto livre antes de envia-lo a um
 * provedor externo de IA (minimizacao, LGPD art. 6o, III).
 */
export function pseudonimizar(texto: string, nomes: Array<string | null> = []): string {
  let t = texto
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]');
  for (const n of nomes) {
    if (!n) continue;
    for (const parte of n.split(/\s+/).filter((p) => p.length > 2)) {
      t = t.replace(new RegExp(`\\b${parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[NOME]');
    }
  }
  return t;
}

/**
 * Politica de retencao: demandas encerradas ha mais de N dias tem os dados
 * pessoais do solicitante removidos. O registro operacional e os indicadores
 * permanecem (base historica), sem identificar a pessoa.
 */
export function anonimizarVencidas(banco: Banco, retencaoDias: number): number {
  const limite = new Date(Date.now() - retencaoDias * 86400000).toISOString();
  return banco.run(
    `UPDATE demandas SET solicitante_nome = NULL, solicitante_telefone = NULL, solicitante_email = NULL,
       solicitante_id = NULL, anonimizada_em = ?
     WHERE anonimizada_em IS NULL AND status IN ('CONCLUIDA','CANCELADA') AND concluida_em < ?`,
    agoraIso(), limite,
  ).alteradas;
}
