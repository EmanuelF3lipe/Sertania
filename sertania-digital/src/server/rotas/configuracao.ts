import { Router } from 'express';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { validar, type Ctx } from '../contexto.js';
import { criarSessao, definirCookie, hashSenha, limitador, paraSessao, sha256, validarForcaSenha } from '../auth.js';
import { auditar } from '../auditoria.js';
import { agoraIso } from '../db.js';
import { ErroHttp, invalido } from '../erros.js';
import type { Papel } from '../../shared/dominio.js';
import { lerParametros } from './admin.js';

/**
 * Primeiro acesso de uma instalacao nova (banco sem administrador).
 *
 * Quem cria o primeiro administrador precisa do CODIGO DE INSTALACAO, que so
 * aparece no terminal/log do servidor. Assim, um visitante que abra o site antes
 * da configuracao nao consegue se tornar administrador. Depois que existe um
 * administrador ativo, a rota deixa de funcionar.
 */
export function precisaPrimeiroAcesso(ctx: Ctx): boolean {
  return !ctx.banco.get("SELECT id FROM usuarios WHERE papel = 'ADMIN_SAD' AND ativo = 1 LIMIT 1");
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function prepararPrimeiroAcesso(ctx: Ctx): string | null {
  if (!precisaPrimeiroAcesso(ctx)) return null;
  const codigo = Array.from({ length: 10 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  codigoAtual = sha256(codigo);
  return codigo;
}

export const VERSAO = '1.1.0';

let codigoAtual: string | null = null;

export function rotasConfiguracao(ctx: Ctx): Router {
  const r = Router();

  r.get('/estado', (_req, res) => {
    res.json({
      precisaPrimeiroAcesso: precisaPrimeiroAcesso(ctx),
      demonstracao: !!ctx.banco.get("SELECT valor FROM contadores WHERE chave = 'seed-demo'"),
      ia: ctx.config.iaProvedor,
      mapa: { tiles: ctx.config.mapaTiles, atribuicao: ctx.config.mapaAtribuicao },
      parametros: lerParametros(ctx),
      versao: VERSAO,
    });
  });

  r.post('/primeiro-acesso', limitador(10, 15 * 60_000), (req, res) => {
    if (!precisaPrimeiroAcesso(ctx) || !codigoAtual) throw new ErroHttp(409, 'Esta instalação já foi configurada. Entre com sua conta.', 'configurado');
    const d = validar(
      z.object({
        codigo: z.string().min(4).max(20),
        nome: z.string().min(3).max(120),
        email: z.string().email('e-mail inválido').max(160),
        senha: z.string().max(200),
      }),
      req.body,
    );
    const recebido = Buffer.from(sha256(d.codigo.trim().toUpperCase()), 'hex');
    if (!timingSafeEqual(recebido, Buffer.from(codigoAtual, 'hex'))) {
      auditar(ctx.banco, { id: null, nome: 'Instalação', ip: req.ip }, 'PRIMEIRO_ACESSO_CODIGO_INVALIDO', null, null);
      throw new ErroHttp(400, 'Código de instalação incorreto. Ele aparece no terminal onde o servidor foi iniciado.', 'codigo');
    }
    const erro = validarForcaSenha(d.senha);
    if (erro) throw invalido(erro);
    const email = d.email.trim().toLowerCase();
    const sad = ctx.banco.get<{ id: number }>("SELECT id FROM secretarias WHERE sigla = 'SAD'");
    const usuario = ctx.banco.tx(() => {
      const existente = ctx.banco.get<{ id: number }>('SELECT id FROM usuarios WHERE email = ?', email);
      if (existente) ctx.banco.run("UPDATE usuarios SET nome = ?, senha_hash = ?, papel = 'ADMIN_SAD', secretaria_id = ?, ativo = 1, deve_trocar_senha = 0 WHERE id = ?", d.nome, hashSenha(d.senha), sad?.id ?? null, existente.id);
      const id = existente?.id ?? ctx.banco.run(
        "INSERT INTO usuarios (nome, email, senha_hash, papel, secretaria_id, criado_em) VALUES (?,?,?, 'ADMIN_SAD', ?, ?)",
        d.nome.trim(), email, hashSenha(d.senha), sad?.id ?? null, agoraIso(),
      ).id;
      auditar(ctx.banco, { id, nome: d.nome, ip: req.ip }, 'PRIMEIRO_ADMINISTRADOR_CRIADO', 'usuario', id);
      return { id, nome: d.nome.trim(), email, papel: 'ADMIN_SAD' as Papel, secretaria_id: sad?.id ?? null, setor_id: null };
    });
    codigoAtual = null;
    const s = criarSessao(ctx.banco, usuario.id);
    definirCookie(res, s.token, ctx.config.producao);
    res.status(201).json({ csrf: s.csrf, usuario: paraSessao(usuario, ctx.banco) });
  });

  return r;
}
