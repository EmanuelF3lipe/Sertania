import { Router } from 'express';
import { z } from 'zod';
import { ator, validar, type Ctx } from '../contexto.js';
import {
  conferirSenha, criarSessao, definirCookie, encerrarSessao, exigirLogin, hashSenha, limitador, paraSessao,
  tokenDaRequisicao, validarForcaSenha, COOKIE,
} from '../auth.js';
import { auditar } from '../auditoria.js';
import { agoraIso } from '../db.js';
import { ErroHttp, conflito, invalido } from '../erros.js';
import type { Papel } from '../../shared/dominio.js';
import { paraDetalhe, paraResumo, SELECT_DEMANDA, type LinhaDemanda } from '../demandas.js';

export function rotasAuth(ctx: Ctx): Router {
  const r = Router();
  const lim = limitador(10, 10 * 60_000);

  r.post('/cadastro', lim, (req, res) => {
    const d = validar(
      z.object({
        nome: z.string().min(3).max(120),
        email: z.string().email('e-mail inválido').max(160),
        telefone: z.string().max(30).optional().nullable(),
        senha: z.string().max(200),
        consentimento: z.literal(true, { errorMap: () => ({ message: 'é preciso concordar com o uso dos dados (LGPD)' }) }),
      }),
      req.body,
    );
    const erroSenha = validarForcaSenha(d.senha);
    if (erroSenha) throw invalido(erroSenha);
    const email = d.email.toLowerCase();
    if (ctx.banco.get('SELECT id FROM usuarios WHERE email = ?', email)) throw conflito('Já existe uma conta com este e-mail');
    const { id } = ctx.banco.run(
      "INSERT INTO usuarios (nome, email, telefone, senha_hash, papel, consentimento_em) VALUES (?,?,?,?,'CIDADAO',?)",
      d.nome.trim(), email, d.telefone ?? null, hashSenha(d.senha), agoraIso(),
    );
    auditar(ctx.banco, { id, nome: d.nome, ip: req.ip }, 'CADASTRO_CIDADAO', 'usuario', id);
    const s = criarSessao(ctx.banco, id);
    definirCookie(res, s.token, ctx.config.producao);
    res.status(201).json({ csrf: s.csrf, usuario: paraSessao({ id, nome: d.nome, email, papel: 'CIDADAO', secretaria_id: null, setor_id: null }) });
  });

  // Bloqueio por tentativas ERRADas (por IP + e-mail): login correto nao consome cota.
  const falhas = new Map<string, { n: number; inicio: number }>();
  r.post('/entrar', (req, res) => {
    const d = validar(z.object({ email: z.string().max(160), senha: z.string().max(200) }), req.body);
    const chave = `${req.ip}:${d.email.trim().toLowerCase()}`;
    const f = falhas.get(chave);
    if (f && Date.now() - f.inicio < 15 * 60_000 && f.n >= 8) throw new ErroHttp(429, 'Muitas tentativas erradas. Aguarde 15 minutos.', 'limite');
    const registrarFalha = () => {
      const atual = falhas.get(chave);
      falhas.set(chave, !atual || Date.now() - atual.inicio > 15 * 60_000 ? { n: 1, inicio: Date.now() } : { ...atual, n: atual.n + 1 });
    };
    const u = ctx.banco.get<{ id: number; nome: string; email: string; senha_hash: string; papel: Papel; secretaria_id: number | null; setor_id: number | null; ativo: number }>(
      'SELECT * FROM usuarios WHERE email = ?', d.email.trim().toLowerCase(),
    );
    if (!u || !u.ativo || !conferirSenha(d.senha, u.senha_hash)) {
      registrarFalha();
      auditar(ctx.banco, { id: null, nome: d.email.slice(0, 60), ip: req.ip }, 'LOGIN_FALHOU', 'usuario', null);
      throw new ErroHttp(401, 'E-mail ou senha incorretos', 'credenciais');
    }
    const antigo = tokenDaRequisicao(req);
    if (antigo) encerrarSessao(ctx.banco, antigo); // rotaciona a sessao
    const s = criarSessao(ctx.banco, u.id);
    definirCookie(res, s.token, ctx.config.producao);
    auditar(ctx.banco, { id: u.id, nome: u.nome, ip: req.ip }, 'LOGIN', 'usuario', u.id);
    res.json({ csrf: s.csrf, usuario: paraSessao(u) });
  });

  r.post('/sair', (req, res) => {
    const t = tokenDaRequisicao(req);
    if (t) encerrarSessao(ctx.banco, t);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.post('/trocar-senha', (req, res) => {
    const u = exigirLogin(req);
    const d = validar(z.object({ atual: z.string().max(200), nova: z.string().max(200) }), req.body);
    const linha = ctx.banco.get<{ senha_hash: string }>('SELECT senha_hash FROM usuarios WHERE id = ?', u.id)!;
    if (!conferirSenha(d.atual, linha.senha_hash)) throw new ErroHttp(400, 'A senha atual não confere', 'credenciais');
    const erro = validarForcaSenha(d.nova);
    if (erro) throw invalido(erro);
    if (d.nova === d.atual) throw invalido('A nova senha precisa ser diferente da atual');
    ctx.banco.run('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0 WHERE id = ?', hashSenha(d.nova), u.id);
    // Encerra as outras sessoes e rotaciona a atual.
    ctx.banco.run('DELETE FROM sessoes WHERE usuario_id = ?', u.id);
    const s = criarSessao(ctx.banco, u.id);
    definirCookie(res, s.token, ctx.config.producao);
    auditar(ctx.banco, ator(req), 'SENHA_TROCADA', 'usuario', u.id);
    res.json({ csrf: s.csrf, usuario: { ...u, deveTrocarSenha: false } });
  });

  r.get('/eu', (req, res) => {
    res.json(req.usuario ? { usuario: req.usuario, csrf: req.csrf } : { usuario: null });
  });

  return r;
}

/** Area do cidadao com conta: suas solicitacoes e direitos do titular (LGPD art. 18). */
export function rotasCidadao(ctx: Ctx): Router {
  const r = Router();

  r.get('/demandas', (req, res) => {
    const u = exigirLogin(req);
    const linhas = ctx.banco.all<LinhaDemanda>(`${SELECT_DEMANDA} WHERE d.solicitante_id = ? ORDER BY d.criada_em DESC`, u.id);
    res.json(linhas.map((l) => ({ ...paraResumo(l), responsavel: null })));
  });

  r.get('/demandas/:protocolo', (req, res) => {
    const u = exigirLogin(req);
    const d = ctx.banco.get<LinhaDemanda>(`${SELECT_DEMANDA} WHERE d.protocolo = ? AND d.solicitante_id = ?`, String(req.params['protocolo']), u.id);
    if (!d) throw new ErroHttp(404, 'Solicitação não encontrada');
    res.json(paraDetalhe(ctx.banco, d, null));
  });

  r.get('/meus-dados', (req, res) => {
    const u = exigirLogin(req);
    const conta = ctx.banco.get('SELECT id, nome, email, telefone, papel, consentimento_em, criado_em FROM usuarios WHERE id = ?', u.id);
    const demandas = ctx.banco.all(
      'SELECT protocolo, status, descricao, endereco, referencia, criada_em, concluida_em, solicitante_nome, solicitante_telefone, solicitante_email, avaliacao_nota FROM demandas WHERE solicitante_id = ?',
      u.id,
    );
    auditar(ctx.banco, ator(req), 'TITULAR_EXPORTOU_DADOS', 'usuario', u.id);
    res.attachment('meus-dados-sertania.json').json({ geradoEm: agoraIso(), conta, demandas });
  });

  r.post('/excluir-conta', (req, res) => {
    const u = exigirLogin(req);
    if (u.papel !== 'CIDADAO') throw invalido('Contas institucionais são desativadas pela administração');
    ctx.banco.tx(() => {
      ctx.banco.run(
        `UPDATE demandas SET solicitante_nome = NULL, solicitante_telefone = NULL, solicitante_email = NULL, solicitante_id = NULL, anonimizada_em = ? WHERE solicitante_id = ?`,
        agoraIso(), u.id,
      );
      ctx.banco.run("UPDATE usuarios SET nome = 'Titular removido', email = ?, telefone = NULL, ativo = 0, senha_hash = 'x' WHERE id = ?", `removido-${u.id}@invalido`, u.id);
      ctx.banco.run('DELETE FROM sessoes WHERE usuario_id = ?', u.id);
      auditar(ctx.banco, ator(req), 'TITULAR_EXCLUIU_CONTA', 'usuario', u.id);
    });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true, mensagem: 'Conta removida. As solicitações foram mantidas sem seus dados pessoais, para fins de histórico do serviço público.' });
  });

  return r;
}
