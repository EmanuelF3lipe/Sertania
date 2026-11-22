import type { UsuarioSessao } from '../shared/dominio';

let csrf = '';
export function definirCsrf(t: string | undefined): void {
  csrf = t ?? '';
}

export class ErroApi extends Error {
  constructor(readonly status: number, message: string, readonly codigo?: string) {
    super(message);
  }
}

async function tratar<T>(r: Response): Promise<T> {
  const tipo = r.headers.get('content-type') ?? '';
  const corpo: unknown = tipo.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const c = corpo as { erro?: string; codigo?: string };
    throw new ErroApi(r.status, c?.erro ?? `Erro ${r.status}`, c?.codigo);
  }
  return corpo as T;
}

export async function api<T = unknown>(metodo: string, rota: string, corpo?: unknown, tentativa = 0): Promise<T> {
  try {
    return await apiUmaVez<T>(metodo, rota, corpo);
  } catch (e) {
    // Token CSRF ausente/antigo (ex.: a pagina abriu sem conexao): renova e tenta de novo uma vez.
    if (e instanceof ErroApi && e.codigo === 'csrf' && tentativa === 0) {
      const s = await apiUmaVez<{ csrf?: string }>('GET', '/auth/eu');
      definirCsrf(s.csrf);
      return api<T>(metodo, rota, corpo, 1);
    }
    throw e;
  }
}

async function apiUmaVez<T>(metodo: string, rota: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${rota}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF': csrf } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com a internet. Tente de novo quando o sinal voltar.', 'offline');
  }
  return tratar<T>(r);
}

export async function enviarFormulario<T = unknown>(rota: string, dados: unknown, arquivos: File[] = []): Promise<T> {
  const fd = new FormData();
  fd.append('dados', JSON.stringify(dados));
  for (const a of arquivos) fd.append('arquivos', a, a.name);
  let r: Response;
  try {
    r = await fetch(`/api${rota}`, { method: 'POST', credentials: 'same-origin', headers: csrf ? { 'X-CSRF': csrf } : {}, body: fd });
  } catch {
    throw new ErroApi(0, 'Sem conexão com a internet.', 'offline');
  }
  return tratar<T>(r);
}

export const get = <T>(rota: string) => api<T>('GET', rota);
export const post = <T>(rota: string, corpo?: unknown) => api<T>('POST', rota, corpo ?? {});

export async function lerSessao(): Promise<UsuarioSessao | null> {
  const r = await get<{ usuario: UsuarioSessao | null; csrf?: string }>('/auth/eu');
  definirCsrf(r.csrf);
  return r.usuario;
}

export function qs(filtros: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Reduz fotos no aparelho antes do envio: economiza dados em conexao fraca. */
export async function comprimirImagem(arquivo: File, ladoMax = 1600, qualidade = 0.75): Promise<File> {
  if (!arquivo.type.startsWith('image/') || arquivo.size < 400_000) return arquivo;
  try {
    const bmp = await createImageBitmap(arquivo);
    const escala = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', qualidade));
    if (!blob || blob.size >= arquivo.size) return arquivo;
    return new File([blob], arquivo.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return arquivo;
  }
}

export const fmtData = (iso: string | null | undefined, hora = true) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', year: 'numeric', ...(hora ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '—';

export const fmtNum = (v: number | null | undefined, casas = 1, suf = '') =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas })}${suf}`;

export const fmtHoras = (h: number | null | undefined) => {
  if (h === null || h === undefined) return '—';
  if (h < 24) return `${fmtNum(h)} h`;
  return `${fmtNum(h / 24)} dias`;
};
