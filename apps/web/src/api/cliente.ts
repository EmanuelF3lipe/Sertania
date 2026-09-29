/**
 * Cliente da API (especificacao secao 16).
 *
 * Tres regras que este arquivo existe para tornar impossiveis de quebrar:
 *
 * 1. NENHUM token e guardado no navegador. Nao ha `localStorage`, nem
 *    `sessionStorage`, nem IndexedDB. O identificador de sessao vive num cookie
 *    `HttpOnly` que o JavaScript nao le. E o que faz o XSS nao virar sessao
 *    roubada, e o que faz "limpar o armazenamento do navegador" encerrar a
 *    sessao de verdade.
 *
 * 2. `credentials: 'include'` em TODA chamada. Sem isso o navegador nao envia o
 *    cookie, e a falha aparece como "sessao expirada" em tudo, sem que a
 *    interface diga o que aconteceu.
 *
 * 3. A URL da API vem de `VITE_API_URL` e, na ausencia dela, e a MESMA origem.
 *    Nao existe URL de API escrita dentro do codigo: o dev server faz proxy de
 *    `/api`, e o deploy usa o mesmo caminho. Uma URL fixa no codigo seria uma
 *    origem a mais para errar e um destino a mais para vazar dados.
 */

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

/** Cabecalho de idempotencia. O nome vem do contrato, e nao de uma constante solta. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Cabecalho de CSRF. O valor e lido do cookie legivel e conferido no servidor. */
const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_COOKIE = '__Host-csrf';

/** Erro de API com o codigo estavel do contrato. */
export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly identificadorCorrelacao: string;

  constructor(status: number, codigo: string, mensagem: string, correlacao: string) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.identificadorCorrelacao = correlacao;
  }

  /** A sessao terminou ou nunca existiu. A tela de entrada e' a resposta certa. */
  get semSessao(): boolean {
    return this.status === 401;
  }

  /**
   * A acao foi recusada por conflito de versao ou estado.
   *
   * O texto de "erro generico" esconderia a distincao que importa: conflito
   * pede recarregar e revisar, negacao nao pede nada disso.
   */
  get conflito(): boolean {
    return this.codigo === 'VERSION_CONFLICT' || this.codigo === 'ILLEGAL_TRANSITION';
  }
}

/**
 * Le o token de CSRF do cookie.
 *
 * O cookie existe justamente para ser legivel pelo JavaScript. Ele NAO e
 * segredo: e um valor que liga a requisicao a sessao, e o guarda no servidor
 * exige que ele esteja na sessao ativa.
 */
function lerCsrf(): string {
  const partes = document.cookie.split(';');
  for (const parte of partes) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === CSRF_COOKIE) return decodeURIComponent(resto.join('='));
  }
  return '';
}

interface RespostaApi<T> {
  readonly status: number;
  readonly corpo: T;
}

async function pedir<T>(caminho: string, init: RequestInit = {}): Promise<RespostaApi<T>> {
  const metodo = (init.method ?? 'GET').toUpperCase();
  const precisaCsrf = metodo !== 'GET' && metodo !== 'HEAD' && metodo !== 'OPTIONS';

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (precisaCsrf) {
    const token = lerCsrf();
    if (token !== '') headers.set(CSRF_HEADER, token);
  }

  const resposta = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  const texto = await resposta.text();
  let corpo: unknown = null;
  if (texto !== '') {
    try {
      corpo = JSON.parse(texto);
    } catch {
      // Resposta sem JSON. O que importa aqui e o status e o codigo, e o filtro
      // global de erro do servidor ja devolve JSON para erro. Uma pagina de erro
      // vinda de um proxy chega sem JSON, e `corpo` fica `null` de proposito.
      corpo = null;
    }
  }

  if (!resposta.ok) {
    const erro = corpo as { code?: string; message?: string; correlationId?: string } | null;
    throw new ErroApi(
      resposta.status,
      erro?.code ?? 'ERRO_DESCONHECIDO',
      erro?.message ?? 'Nao foi possivel completar a operacao.',
      erro?.correlationId ?? '',
    );
  }

  return { status: resposta.status, corpo: corpo as T };
}

export function apiGet<T>(caminho: string): Promise<T> {
  return pedir<T>(caminho).then((r) => r.corpo);
}

export function apiPost<T>(caminho: string, corpo: unknown, cabecalhos?: Record<string, string>): Promise<T> {
  // headers so entra no objeto quando existe. Com exactOptionalPropertyTypes,
  // passar undefined para uma propriedade opcional e' erro de compilacao, e a
  // correcao nao e' desligar a regra: e' nao enviar o campo.
  return pedir<T>(
    caminho,
    cabecalhos === undefined
      ? { method: 'POST', body: JSON.stringify(corpo) }
      : { method: 'POST', body: JSON.stringify(corpo), headers: cabecalhos },
  ).then((r) => r.corpo);
}
