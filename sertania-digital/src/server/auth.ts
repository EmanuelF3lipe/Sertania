import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Banco } from './db.js';
import type { Papel, Permissao, UsuarioSessao } from '../shared/dominio.js';
import { montarSessao, type LinhaSessao } from './cargos.js';
import { naoAutenticado, proibido, ErroHttp } from './erros.js';

export const COOKIE = 'sertania_sessao';
const DURACAO_MS = 8 * 3600 * 1000;

declare module 'express-serve-static-core' {
  interface Request {
    usuario?: UsuarioSessao;
    csrf?: string;
  }
}

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(senha, sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}

export function conferirSenha(senha: string, armazenado: string): boolean {
  const [alg, salB64, hB64] = armazenado.split('$');
  if (alg !== 'scrypt' || !salB64 || !hB64) return false;
  const esperado = Buffer.from(hB64, 'base64');
  const h = scryptSync(senha, Buffer.from(salB64, 'base64'), esperado.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(h, esperado);
}

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

export function validarForcaSenha(senha: string): string | null {
  if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres';
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return 'Use letras e números na senha';
  return null;
}

export function criarSessao(banco: Banco, usuarioId: number): { token: string; csrf: string } {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(18).toString('base64url');
  const agora = new Date();
  banco.run(
    'INSERT INTO sessoes (token_hash, usuario_id, csrf, expira_em, criado_em) VALUES (?,?,?,?,?)',
    sha256(token), usuarioId, csrf, new Date(agora.getTime() + DURACAO_MS).toISOString(), agora.toISOString(),
  );
  banco.run('DELETE FROM sessoes WHERE expira_em < ?', agora.toISOString());
  return { token, csrf };
}

export function encerrarSessao(banco: Banco, token: string): void {
  banco.run('DELETE FROM sessoes WHERE token_hash = ?', sha256(token));
}

export function definirCookie(res: Response, token: string, producao: boolean): void {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: producao, maxAge: DURACAO_MS, path: '/' });
}

export function tokenDaRequisicao(req: Request): string | undefined {
  const bruto = req.headers.cookie;
  if (!bruto) return undefined;
  for (const parte of bruto.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

interface LinhaUsuario {
  id: number; nome: string; email: string; papel: Papel; secretaria_id: number | null;
  setor_id: number | null; ativo: number; csrf: string; expira_em: string; deve_trocar_senha: number;
}

/** Sessao do usuario: permissoes, alcance e lotacoes vem do cargo. */
export function paraSessao(u: LinhaSessao, banco?: Banco): UsuarioSessao {
  return montarSessao(banco, u);
}

/** Le a sessao (se houver) e protege mutacoes autenticadas com token CSRF por sessao. */
export function middlewareSessao(banco: Banco) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = tokenDaRequisicao(req);
    if (token) {
      const u = banco.get<LinhaUsuario>(
        'SELECT u.*, s.csrf, s.expira_em FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?',
        sha256(token),
      );
      if (u && u.ativo === 1 && u.expira_em > new Date().toISOString()) {
        req.usuario = paraSessao(u, banco);
        req.csrf = u.csrf;
      }
    }
    const mutacao = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isento = ['/api/auth/entrar', '/api/auth/cadastro', '/api/auth/sair', '/api/integracao/'].some((p) => req.path.startsWith(p));
    if (mutacao && req.usuario && !isento && req.headers['x-csrf'] !== req.csrf) {
      next(new ErroHttp(403, 'Sessão expirada ou requisição inválida. Recarregue a página.', 'csrf'));
      return;
    }
    // Senha provisoria: so permite trocar a senha, sair e usar as paginas publicas.
    if (req.usuario?.deveTrocarSenha && !req.path.startsWith('/api/auth/') && !req.path.startsWith('/api/publico/')) {
      next(new ErroHttp(403, 'Troque sua senha provisória para continuar.', 'trocar_senha'));
      return;
    }
    next();
  };
}

export function exigirLogin(req: Request): UsuarioSessao {
  if (!req.usuario) throw naoAutenticado();
  return req.usuario;
}

export function exigir(req: Request, ...permissoes: Permissao[]): UsuarioSessao {
  const u = exigirLogin(req);
  if (!permissoes.some((p) => u.permissoes.includes(p))) throw proibido();
  return u;
}

/** Limite simples por IP e rota, em memoria, contra abuso de formularios publicos. */
export function limitador(maximo: number, janelaMs: number) {
  const baldes = new Map<string, { n: number; inicio: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const chave = `${req.ip}:${req.path}`;
    const agora = Date.now();
    const b = baldes.get(chave);
    if (!b || agora - b.inicio > janelaMs) baldes.set(chave, { n: 1, inicio: agora });
    else if (++b.n > maximo) {
      next(new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos.', 'limite'));
      return;
    }
    next();
  };
}
