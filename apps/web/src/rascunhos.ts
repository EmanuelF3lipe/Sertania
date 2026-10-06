/**
 * Rascunho local e temporario de uma solicitacao.
 *
 * O texto fica apenas no sessionStorage do navegador: nao vai para o servidor
 * antes do envio e desaparece quando a sessao da aba termina. Fotos nao sao
 * persistidas por seguranca; ao retomar, a pessoa pode seleciona-las novamente.
 */

export interface RascunhoSolicitacao {
  readonly secretariaId: string;
  readonly secretariaNome: string;
  readonly servicoId: string;
  readonly servicoNome: string;
  readonly descricao: string;
  readonly atualizadoEm: string;
}

const CHAVE = 'sertania-rascunho-solicitacao';

export function carregarRascunho(): RascunhoSolicitacao | null {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE);
    if (bruto === null) return null;
    const valor: unknown = JSON.parse(bruto);
    if (!ehRascunho(valor)) {
      window.sessionStorage.removeItem(CHAVE);
      return null;
    }
    return valor;
  } catch {
    return null;
  }
}

export function salvarRascunho(rascunho: RascunhoSolicitacao): void {
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify(rascunho));
  } catch {
    // O navegador pode bloquear storage. O formulario continua utilizavel sem ele.
  }
}

export function limparRascunho(): void {
  try {
    window.sessionStorage.removeItem(CHAVE);
  } catch {
    // Storage indisponivel nao impede o envio da solicitacao.
  }
}

function ehRascunho(valor: unknown): valor is RascunhoSolicitacao {
  if (typeof valor !== 'object' || valor === null) return false;
  const objeto = valor as Record<string, unknown>;
  return (
    typeof objeto['secretariaId'] === 'string' &&
    typeof objeto['secretariaNome'] === 'string' &&
    typeof objeto['servicoId'] === 'string' &&
    typeof objeto['servicoNome'] === 'string' &&
    typeof objeto['descricao'] === 'string' &&
    typeof objeto['atualizadoEm'] === 'string'
  );
}
