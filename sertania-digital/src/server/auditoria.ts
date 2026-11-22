import { createHash } from 'node:crypto';
import type { Banco } from './db.js';
import { agoraIso } from './db.js';

/**
 * Trilha de auditoria encadeada por hash: cada registro inclui o hash do anterior.
 * Alterar ou apagar uma linha quebra a cadeia, o que `verificarCadeia` detecta.
 */
export interface Ator { id: number | null; nome: string; ip?: string | undefined }

export function auditar(
  banco: Banco,
  ator: Ator,
  acao: string,
  entidade: string | null,
  entidadeId: string | number | null,
  detalhes: Record<string, unknown> = {},
): void {
  const anterior = banco.get<{ hash: string }>('SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1');
  const hashAnterior = anterior?.hash ?? 'GENESIS';
  const em = agoraIso();
  const det = JSON.stringify(detalhes);
  const id = entidadeId === null ? null : String(entidadeId);
  const hash = createHash('sha256')
    .update([hashAnterior, em, ator.id ?? '', acao, entidade ?? '', id ?? '', det].join('|'))
    .digest('hex');
  banco.run(
    `INSERT INTO auditoria (em, usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, ip, hash_anterior, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    em, ator.id, ator.nome, acao, entidade, id, det, ator.ip ?? null, hashAnterior, hash,
  );
}

export function verificarCadeia(banco: Banco): { integra: boolean; registros: number; quebraEm: number | null } {
  const linhas = banco.all<{
    id: number; em: string; usuario_id: number | null; acao: string; entidade: string | null;
    entidade_id: string | null; detalhes: string; hash_anterior: string; hash: string;
  }>('SELECT * FROM auditoria ORDER BY id');
  let anterior = 'GENESIS';
  for (const l of linhas) {
    const esperado = createHash('sha256')
      .update([anterior, l.em, l.usuario_id ?? '', l.acao, l.entidade ?? '', l.entidade_id ?? '', l.detalhes].join('|'))
      .digest('hex');
    if (l.hash_anterior !== anterior || l.hash !== esperado) return { integra: false, registros: linhas.length, quebraEm: l.id };
    anterior = l.hash;
  }
  return { integra: true, registros: linhas.length, quebraEm: null };
}
