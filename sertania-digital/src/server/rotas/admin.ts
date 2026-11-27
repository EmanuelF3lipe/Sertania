import { Router, type Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ESCOPOS_CARGO, PAPEIS, PRIORIDADES, TIPOS_LOCALIDADE, TODAS_PERMISSOES, type CargoDto, type Papel, type Permissao } from '../../shared/dominio.js';
import { alterarCargo, conferirAdministradores, criarCargo, duplicarCargo, excluirCargo, gravarLotacoes, lerCargo, listarCargos } from '../cargos.js';
import { ator, idParam, validar, type Ctx } from '../contexto.js';
import { exigir, hashSenha, sha256, validarForcaSenha } from '../auth.js';
import { auditar, verificarCadeia } from '../auditoria.js';
import { agoraIso } from '../db.js';
import { ErroHttp, conflito, invalido, naoEncontrado } from '../erros.js';
import { anonimizarVencidas } from '../privacidade.js';
import { invalidarClassificador } from '../ia/servico.js';
import { lerCatalogo } from './publico.js';
import { calcularIndicadores, lerFiltros } from '../indicadores.js';
import { abrirDemanda, paraResumo, SELECT_DEMANDA, type LinhaDemanda } from '../demandas.js';
import { esquemaNova } from './publico.js';
import { definirLimite, lerLimite, resumoUso } from '../ia/uso.js';
import { MODELO as MODELO_IA } from '../ia/claude.js';

export function fazerBackup(ctx: Ctx): { arquivo: string; tamanho: number } {
  const pasta = path.join(ctx.config.pastaDados, 'backups');
  fs.mkdirSync(pasta, { recursive: true });
  const nome = `sertania-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const destino = path.join(pasta, nome);
  ctx.banco.db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  // Mantem os 30 backups mais recentes.
  const todos = fs.readdirSync(pasta).filter((f) => f.endsWith('.db')).sort();
  for (const antigo of todos.slice(0, Math.max(0, todos.length - 30))) fs.rmSync(path.join(pasta, antigo));
  return { arquivo: nome, tamanho: fs.statSync(destino).size };
}

export function rotasAdmin(ctx: Ctx): Router {
  const r = Router();
  const b = ctx.banco;

  // ----------------------------------------------------------- equipe (servidores)
  r.get('/usuarios', (req, res) => {
    exigir(req, 'admin.usuarios');
    const lot = b.all<{ usuario_id: number; secretaria_id: number; setor_id: number | null; secretaria: string; setor: string | null }>(
      `SELECT l.usuario_id, l.secretaria_id, l.setor_id, sc.nome AS secretaria, st.nome AS setor FROM usuario_lotacoes l
       JOIN secretarias sc ON sc.id = l.secretaria_id LEFT JOIN setores st ON st.id = l.setor_id ORDER BY l.rowid`);
    const porUsuario = new Map<number, Array<{ secretariaId: number; setorId: number | null; secretaria: string; setor: string | null }>>();
    for (const l of lot) porUsuario.set(l.usuario_id, [...(porUsuario.get(l.usuario_id) ?? []), { secretariaId: l.secretaria_id, setorId: l.setor_id, secretaria: l.secretaria, setor: l.setor }]);
    res.json(b.all<{ id: number }>(
      `SELECT u.id, u.nome, u.email, u.telefone, u.cargo_id AS cargoId, c.nome AS cargo, c.escopo, u.ativo, u.criado_em AS criadoEm,
              u.ultimo_acesso_em AS ultimoAcessoEm, u.pediu_senha_em AS pediuSenhaEm, u.deve_trocar_senha AS deveTrocarSenha
       FROM usuarios u LEFT JOIN cargos c ON c.id = u.cargo_id
       WHERE u.papel <> 'CIDADAO' ORDER BY u.nome`,
    ).map((u) => ({ ...u, lotacoes: porUsuario.get(u.id) ?? [] })));
  });

  const esquemaUsuario = z.object({
    nome: z.string().min(3).max(120),
    email: z.string().email().max(160),
    telefone: z.string().max(30).optional().nullable(),
    cargoId: z.number().int().positive(),
    lotacoes: z.array(z.object({ secretariaId: z.number().int().positive(), setorId: z.number().int().positive().nullable() })).max(40),
    senha: z.string().max(200).optional(),
    ativo: z.boolean().default(true),
    exigirTroca: z.boolean().default(true),
  });

  /** papel legado (so para compatibilidade): o codigo do cargo original ou o mais restrito */
  const papelDoCargo = (c: CargoDto): Papel => ((c.codigo && (PAPEIS as readonly string[]).includes(c.codigo) ? c.codigo : 'CAMPO') as Papel);

  r.post('/usuarios', (req, res) => {
    exigir(req, 'admin.usuarios');
    const d = validar(esquemaUsuario, req.body);
    const cargo = lerCargo(b, d.cargoId);
    const senha = d.senha || `Sertania${randomBytes(3).toString('hex')}1`;
    const erro = validarForcaSenha(senha);
    if (erro) throw invalido(erro);
    if (b.get('SELECT id FROM usuarios WHERE email = ?', d.email.toLowerCase())) throw conflito('E-mail já cadastrado');
    const id = b.tx(() => {
      const { id } = b.run(
        'INSERT INTO usuarios (nome, email, telefone, senha_hash, papel, cargo_id, ativo, deve_trocar_senha) VALUES (?,?,?,?,?,?,?,?)',
        d.nome, d.email.toLowerCase(), d.telefone ?? null, hashSenha(senha), papelDoCargo(cargo), cargo.id, d.ativo, d.exigirTroca || !d.senha ? 1 : 0,
      );
      const principal = gravarLotacoes(b, id, cargo.escopo, d.lotacoes);
      b.run('UPDATE usuarios SET secretaria_id = ?, setor_id = ? WHERE id = ?', principal?.secretariaId ?? null, principal?.setorId ?? null, id);
      return id;
    });
    auditar(b, ator(req), 'USUARIO_CRIADO', 'usuario', id, { cargo: cargo.nome, cargoId: cargo.id, lotacoes: d.lotacoes });
    res.status(201).json({ id, senhaProvisoria: d.senha ? null : senha });
  });

  r.put('/usuarios/:id', (req, res) => {
    const u = exigir(req, 'admin.usuarios');
    const id = idParam(req);
    const d = validar(esquemaUsuario, req.body);
    const atual = b.get<{ cargo_id: number | null; papel: string }>('SELECT cargo_id, papel FROM usuarios WHERE id = ?', id);
    if (!atual || atual.papel === 'CIDADAO') throw naoEncontrado();
    if (id === u.id && (!d.ativo || d.cargoId !== atual.cargo_id)) throw invalido('Você não pode mudar o próprio cargo nem se desativar');
    const cargo = lerCargo(b, d.cargoId);
    conferirAdministradores(b, id, cargo.id, !d.ativo);
    b.tx(() => {
      const principal = gravarLotacoes(b, id, cargo.escopo, d.lotacoes);
      b.run('UPDATE usuarios SET nome = ?, email = ?, telefone = ?, papel = ?, cargo_id = ?, secretaria_id = ?, setor_id = ?, ativo = ? WHERE id = ?',
        d.nome, d.email.toLowerCase(), d.telefone ?? null, papelDoCargo(cargo), cargo.id, principal?.secretariaId ?? null, principal?.setorId ?? null, d.ativo, id);
      if (d.senha) {
        const erro = validarForcaSenha(d.senha);
        if (erro) throw invalido(erro);
        b.run('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1 WHERE id = ?', hashSenha(d.senha), id);
      }
      if (d.senha || !d.ativo || atual.cargo_id !== cargo.id) b.run('DELETE FROM sessoes WHERE usuario_id = ?', id);
    });
    auditar(b, ator(req), 'USUARIO_ALTERADO', 'usuario', id, { cargoAnterior: atual.cargo_id, cargoId: cargo.id, cargo: cargo.nome, lotacoes: d.lotacoes, ativo: d.ativo, senhaRedefinida: Boolean(d.senha) });
    res.json({ ok: true });
  });

  // Gera uma senha provisoria (atende ao pedido de "esqueci minha senha").
  r.post('/usuarios/:id/senha-provisoria', (req, res) => {
    const u = exigir(req, 'admin.usuarios');
    const id = idParam(req);
    if (id === u.id) throw invalido('Para a sua própria senha, use Alterar senha');
    const alvo = b.get<{ papel: string }>('SELECT papel FROM usuarios WHERE id = ?', id);
    if (!alvo || alvo.papel === 'CIDADAO') throw naoEncontrado();
    const senha = `Sertania${randomBytes(3).toString('hex')}1`;
    b.run('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1, pediu_senha_em = NULL WHERE id = ?', hashSenha(senha), id);
    b.run('DELETE FROM sessoes WHERE usuario_id = ?', id);
    auditar(b, ator(req), 'SENHA_PROVISORIA_GERADA', 'usuario', id);
    res.json({ senhaProvisoria: senha });
  });

  // ----------------------------------------------------------- cargos e permissoes
  const esquemaCargo = z.object({
    nome: z.string().min(2).max(80),
    descricao: z.string().max(300).optional().nullable().transform((v) => v ?? null),
    escopo: z.enum(ESCOPOS_CARGO),
    permissoes: z.array(z.enum(TODAS_PERMISSOES as [string, ...string[]])).max(60),
  });

  r.get('/cargos', (req, res) => {
    exigir(req, 'admin.usuarios');
    res.json(listarCargos(b));
  });

  r.post('/cargos', (req, res) => {
    exigir(req, 'admin.usuarios');
    const d = validar(esquemaCargo, req.body);
    const c = criarCargo(b, { ...d, permissoes: d.permissoes as Permissao[] });
    auditar(b, ator(req), 'CARGO_CRIADO', 'cargo', c.id, { nome: c.nome, escopo: c.escopo, permissoes: c.permissoes });
    res.status(201).json(c);
  });

  r.put('/cargos/:id', (req, res) => {
    exigir(req, 'admin.usuarios');
    const id = idParam(req);
    const d = validar(esquemaCargo, req.body);
    const { antes, depois } = alterarCargo(b, id, { ...d, permissoes: d.permissoes as Permissao[] });
    auditar(b, ator(req), 'CARGO_ALTERADO', 'cargo', id, {
      nome: depois.nome, nomeAnterior: antes.nome !== depois.nome ? antes.nome : undefined,
      escopo: depois.escopo, escopoAnterior: antes.escopo !== depois.escopo ? antes.escopo : undefined,
      incluidas: depois.permissoes.filter((p) => !antes.permissoes.includes(p)), removidas: antes.permissoes.filter((p) => !depois.permissoes.includes(p)),
    });
    res.json(depois);
  });

  r.post('/cargos/:id/duplicar', (req, res) => {
    exigir(req, 'admin.usuarios');
    const origem = idParam(req);
    const c = duplicarCargo(b, origem);
    auditar(b, ator(req), 'CARGO_CRIADO', 'cargo', c.id, { nome: c.nome, duplicadoDe: origem });
    res.status(201).json(c);
  });

  r.delete('/cargos/:id', (req, res) => {
    exigir(req, 'admin.usuarios');
    const c = excluirCargo(b, idParam(req));
    auditar(b, ator(req), 'CARGO_EXCLUIDO', 'cargo', c.id, { nome: c.nome, permissoes: c.permissoes });
    res.json({ ok: true });
  });

  // ----------------------------------------------------------- consumo da IA externa
  r.get('/ia', (req, res) => {
    exigir(req, 'admin.integracao');
    res.json({ provedor: ctx.config.iaProvedor, modelo: MODELO_IA, ...resumoUso(b) });
  });

  r.put('/ia', (req, res) => {
    exigir(req, 'admin.integracao');
    const { limiteTokensMes } = validar(z.object({ limiteTokensMes: z.number().int().min(0).max(10_000_000_000) }), req.body);
    const anterior = lerLimite(b);
    definirLimite(b, limiteTokensMes);
    auditar(b, ator(req), 'IA_LIMITE_ALTERADO', 'parametros', null, { anterior, limiteTokensMes });
    res.json({ provedor: ctx.config.iaProvedor, modelo: MODELO_IA, ...resumoUso(b) });
  });

  // ----------------------------------------------------------- organizacao
  r.get('/parametros', (req, res) => {
    exigir(req, 'admin.usuarios', 'admin.catalogo');
    res.json(lerParametros(ctx));
  });

  r.put('/parametros', (req, res) => {
    exigir(req, 'admin.usuarios');
    const d = validar(esquemaParametros, req.body);
    b.tx(() => {
      for (const [k, v] of Object.entries(d)) b.run('INSERT INTO parametros (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', k, v ?? '');
    });
    auditar(b, ator(req), 'PARAMETROS_ALTERADOS', 'parametros', null, d);
    res.json(lerParametros(ctx));
  });

  // ----------------------------------------------------------- catalogo
  r.get('/catalogo', (req, res) => {
    exigir(req, 'admin.catalogo');
    res.json({ ...lerCatalogo(ctx, true), feriados: b.all('SELECT data, nome FROM feriados ORDER BY data') });
  });

  r.post('/secretarias', (req, res) => {
    exigir(req, 'admin.catalogo');
    const d = validar(z.object({ nome: z.string().min(3).max(120), sigla: z.string().min(2).max(12) }), req.body);
    const { id } = b.run('INSERT INTO secretarias (nome, sigla) VALUES (?,?)', d.nome, d.sigla.toUpperCase());
    auditar(b, ator(req), 'SECRETARIA_CRIADA', 'secretaria', id, d);
    res.status(201).json({ id });
  });

  r.post('/setores', (req, res) => {
    exigir(req, 'admin.catalogo');
    const d = validar(z.object({ nome: z.string().min(3).max(120), secretariaId: z.number().int() }), req.body);
    const { id } = b.run('INSERT INTO setores (secretaria_id, nome) VALUES (?,?)', d.secretariaId, d.nome);
    auditar(b, ator(req), 'SETOR_CRIADO', 'setor', id, d);
    res.status(201).json({ id });
  });

  const esquemaServico = z.object({
    nome: z.string().min(3).max(120), setorId: z.number().int(), descricao: z.string().max(1000).default(''),
    palavrasChave: z.string().max(1000).default(''), prazoDiasUteis: z.number().int().min(1).max(365),
    prioridadePadrao: z.enum(PRIORIDADES).default('NORMAL'), ativo: z.boolean().default(true),
  });
  r.post('/servicos', (req, res) => {
    exigir(req, 'admin.catalogo');
    const d = validar(esquemaServico, req.body);
    const { id } = b.run('INSERT INTO servicos (setor_id, nome, descricao, palavras_chave, prazo_dias_uteis, prioridade_padrao, ativo) VALUES (?,?,?,?,?,?,?)',
      d.setorId, d.nome, d.descricao, d.palavrasChave, d.prazoDiasUteis, d.prioridadePadrao, d.ativo);
    invalidarClassificador();
    auditar(b, ator(req), 'SERVICO_CRIADO', 'servico', id, d);
    res.status(201).json({ id });
  });
  r.put('/servicos/:id', (req, res) => {
    exigir(req, 'admin.catalogo');
    const d = validar(esquemaServico, req.body);
    const id = idParam(req);
    const anterior = b.get('SELECT * FROM servicos WHERE id = ?', id);
    if (!anterior) throw naoEncontrado();
    b.run('UPDATE servicos SET setor_id = ?, nome = ?, descricao = ?, palavras_chave = ?, prazo_dias_uteis = ?, prioridade_padrao = ?, ativo = ? WHERE id = ?',
      d.setorId, d.nome, d.descricao, d.palavrasChave, d.prazoDiasUteis, d.prioridadePadrao, d.ativo, id);
    invalidarClassificador();
    auditar(b, ator(req), 'SERVICO_ALTERADO', 'servico', id, { anterior, novo: d });
    res.json({ ok: true });
  });

  r.post('/localidades', (req, res) => {
    exigir(req, 'admin.catalogo');
    const d = validar(z.object({ nome: z.string().min(2).max(120), tipo: z.enum(TIPOS_LOCALIDADE), lat: z.number(), lng: z.number() }), req.body);
    const { id } = b.run('INSERT INTO localidades (nome, tipo, lat, lng) VALUES (?,?,?,?)', d.nome, d.tipo, d.lat, d.lng);
    auditar(b, ator(req), 'LOCALIDADE_CRIADA', 'localidade', id, d);
    res.status(201).json({ id });
  });
  r.put('/localidades/:id', (req, res) => {
    exigir(req, 'admin.catalogo');
    const d = validar(z.object({ nome: z.string().min(2).max(120), tipo: z.enum(TIPOS_LOCALIDADE), lat: z.number(), lng: z.number() }), req.body);
    b.run('UPDATE localidades SET nome = ?, tipo = ?, lat = ?, lng = ? WHERE id = ?', d.nome, d.tipo, d.lat, d.lng, idParam(req));
    auditar(b, ator(req), 'LOCALIDADE_ALTERADA', 'localidade', idParam(req), d);
    res.json({ ok: true });
  });

  r.post('/feriados', (req, res) => {
    exigir(req, 'admin.catalogo');
    const d = validar(z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), nome: z.string().min(2).max(120) }), req.body);
    b.run('INSERT INTO feriados (data, nome) VALUES (?,?) ON CONFLICT(data) DO UPDATE SET nome = excluded.nome', d.data, d.nome);
    auditar(b, ator(req), 'FERIADO_DEFINIDO', 'feriado', d.data, d);
    res.status(201).json({ ok: true });
  });

  // ----------------------------------------------------------- diagnostico (linha de base)
  r.get('/diagnostico', (req, res) => {
    exigir(req, 'admin.diagnostico', 'painel.ver');
    res.json(b.all('SELECT d.*, u.nome AS registrado_por_nome FROM diagnostico d LEFT JOIN usuarios u ON u.id = d.registrado_por ORDER BY d.id DESC'));
  });
  r.post('/diagnostico', (req, res) => {
    const u = exigir(req, 'admin.diagnostico');
    const d = validar(z.object({ indicador: z.string().min(3).max(200), valor: z.string().min(1).max(200), unidade: z.string().max(40).optional(), periodo: z.string().max(60).optional(), fonte: z.string().min(3).max(300), observacao: z.string().max(1000).optional() }), req.body);
    const { id } = b.run('INSERT INTO diagnostico (indicador, valor, unidade, periodo, fonte, observacao, registrado_por, criado_em) VALUES (?,?,?,?,?,?,?,?)',
      d.indicador, d.valor, d.unidade ?? null, d.periodo ?? null, d.fonte, d.observacao ?? null, u.id, agoraIso());
    auditar(b, ator(req), 'DIAGNOSTICO_REGISTRADO', 'diagnostico', id, d);
    res.status(201).json({ id });
  });
  r.post('/diagnostico/:id/validar', (req, res) => {
    const u = exigir(req, 'admin.diagnostico');
    const reg = b.get<{ registrado_por: number }>('SELECT registrado_por FROM diagnostico WHERE id = ?', idParam(req));
    if (!reg) throw naoEncontrado();
    if (reg.registrado_por === u.id) throw invalido('A validação precisa ser feita por outra pessoa (dupla checagem)');
    b.run('UPDATE diagnostico SET validado = 1, validado_por = ? WHERE id = ?', u.id, idParam(req));
    auditar(b, ator(req), 'DIAGNOSTICO_VALIDADO', 'diagnostico', idParam(req));
    res.json({ ok: true });
  });

  // ----------------------------------------------------------- auditoria
  r.get('/auditoria', (req, res) => {
    exigir(req, 'auditoria.ver');
    const acao = typeof req.query['acao'] === 'string' && req.query['acao'] ? `%${req.query['acao']}%` : '%';
    res.json({
      cadeia: verificarCadeia(b),
      registros: b.all('SELECT id, em, usuario_nome AS usuario, acao, entidade, entidade_id AS entidadeId, detalhes, ip FROM auditoria WHERE acao LIKE ? ORDER BY id DESC LIMIT 500', acao),
    });
  });

  r.get('/notificacoes', (req, res) => {
    exigir(req, 'auditoria.ver', 'admin.privacidade');
    res.json(b.all('SELECT m.id, m.tipo, m.canal, m.destino, m.via, m.status, m.erro, m.criado_em, m.enviado_em, d.protocolo FROM mensagens m LEFT JOIN demandas d ON d.id = m.demanda_id ORDER BY m.id DESC LIMIT 200'));
  });

  // ----------------------------------------------------------- backup e portabilidade
  r.get('/backups', (req, res) => {
    exigir(req, 'admin.backup');
    const pasta = path.join(ctx.config.pastaDados, 'backups');
    const arquivos = fs.existsSync(pasta) ? fs.readdirSync(pasta).filter((f) => f.endsWith('.db')).sort().reverse() : [];
    res.json(arquivos.map((f) => ({ arquivo: f, tamanho: fs.statSync(path.join(pasta, f)).size })));
  });
  r.post('/backups', (req, res) => {
    exigir(req, 'admin.backup');
    const r1 = fazerBackup(ctx);
    auditar(b, ator(req), 'BACKUP_GERADO', 'backup', r1.arquivo, { tamanho: r1.tamanho });
    res.status(201).json(r1);
  });
  r.get('/exportacao-completa', (req, res) => {
    exigir(req, 'admin.backup');
    auditar(b, ator(req), 'EXPORTACAO_COMPLETA', null, null);
    const tabelas = ['secretarias', 'setores', 'servicos', 'localidades', 'feriados', 'demandas', 'eventos', 'anexos', 'sugestoes_ia', 'alertas', 'relatorios', 'diagnostico', 'auditoria'];
    const dados: Record<string, unknown> = { formato: 'sertania-exportacao/1', geradoEm: agoraIso(), observacao: 'Exportação aberta (JSON) para portabilidade e redução de dependência de fornecedor. Senhas e sessões não são exportadas.' };
    for (const t of tabelas) dados[t] = b.all(`SELECT * FROM ${t}`);
    dados['usuarios'] = b.all('SELECT id, nome, email, papel, cargo_id, secretaria_id, setor_id, ativo, criado_em FROM usuarios');
    dados['cargos'] = b.all('SELECT * FROM cargos');
    dados['usuario_lotacoes'] = b.all('SELECT * FROM usuario_lotacoes');
    res.attachment(`sertania-exportacao-${new Date().toISOString().slice(0, 10)}.json`).json(dados);
  });

  // ----------------------------------------------------------- privacidade
  r.post('/privacidade/anonimizar', (req, res) => {
    exigir(req, 'admin.privacidade');
    const n = anonimizarVencidas(b, ctx.config.retencaoDias);
    auditar(b, ator(req), 'ANONIMIZACAO_RETENCAO', 'demanda', null, { anonimizadas: n, retencaoDias: ctx.config.retencaoDias });
    res.json({ anonimizadas: n, retencaoDias: ctx.config.retencaoDias });
  });
  r.get('/privacidade', (req, res) => {
    exigir(req, 'admin.privacidade');
    res.json({
      retencaoDias: ctx.config.retencaoDias,
      limiarSupressao: ctx.config.limiarSupressao,
      iaProvedor: ctx.config.iaProvedor,
      comDadosPessoais: b.get<{ n: number }>('SELECT COUNT(*) AS n FROM demandas WHERE anonimizada_em IS NULL AND (solicitante_nome IS NOT NULL OR solicitante_telefone IS NOT NULL OR solicitante_email IS NOT NULL)')!.n,
      anonimizadas: b.get<{ n: number }>('SELECT COUNT(*) AS n FROM demandas WHERE anonimizada_em IS NOT NULL')!.n,
      anonimas: b.get<{ n: number }>('SELECT COUNT(*) AS n FROM demandas WHERE anonima = 1')!.n,
    });
  });

  // ----------------------------------------------------------- integracoes
  r.get('/tokens', (req, res) => {
    exigir(req, 'admin.integracao');
    res.json(b.all('SELECT id, nome, escopos, criado_em AS criadoEm, revogado_em AS revogadoEm, ultimo_uso AS ultimoUso FROM tokens_integracao ORDER BY id DESC'));
  });
  r.post('/tokens', (req, res) => {
    const u = exigir(req, 'admin.integracao');
    const d = validar(z.object({ nome: z.string().min(3).max(120), escopos: z.array(z.enum(['demandas:ler', 'demandas:criar', 'indicadores:ler'])).min(1) }), req.body);
    const token = `srt_${randomBytes(24).toString('base64url')}`;
    const { id } = b.run('INSERT INTO tokens_integracao (nome, token_hash, escopos, criado_por, criado_em) VALUES (?,?,?,?,?)', d.nome, sha256(token), d.escopos.join(' '), u.id, agoraIso());
    auditar(b, ator(req), 'TOKEN_CRIADO', 'token', id, d);
    res.status(201).json({ id, token, aviso: 'Guarde este token agora: ele não será exibido novamente.' });
  });
  r.post('/tokens/:id/revogar', (req, res) => {
    exigir(req, 'admin.integracao');
    b.run('UPDATE tokens_integracao SET revogado_em = ? WHERE id = ?', agoraIso(), idParam(req));
    auditar(b, ator(req), 'TOKEN_REVOGADO', 'token', idParam(req));
    res.json({ ok: true });
  });

  return r;
}

/** API de integracao com outros sistemas (token Bearer com escopos). Nunca devolve dados pessoais. */
export function rotasIntegracao(ctx: Ctx): Router {
  const r = Router();
  const b = ctx.banco;

  function autenticar(req: Request, escopo: string): { id: number; nome: string } {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const t = b.get<{ id: number; nome: string; escopos: string; revogado_em: string | null }>('SELECT * FROM tokens_integracao WHERE token_hash = ?', sha256(token));
    if (!t || t.revogado_em) throw new ErroHttp(401, 'Token de integração inválido ou revogado', 'token');
    if (!t.escopos.split(' ').includes(escopo)) throw new ErroHttp(403, `Token sem o escopo ${escopo}`, 'escopo');
    b.run('UPDATE tokens_integracao SET ultimo_uso = ? WHERE id = ?', agoraIso(), t.id);
    return t;
  }

  r.get('/v1/demandas', (req, res) => {
    autenticar(req, 'demandas:ler');
    const desde = typeof req.query['atualizadasDesde'] === 'string' ? req.query['atualizadasDesde'] : '1970-01-01';
    const linhas = b.all<LinhaDemanda>(`${SELECT_DEMANDA} WHERE d.criada_em >= ? ORDER BY d.id LIMIT 1000`, desde);
    res.json(linhas.map((d) => {
      const { descricao: _d, responsavel: _r, responsavelId: _ri, ...resto } = paraResumo(d);
      return resto;
    }));
  });

  r.get('/v1/indicadores', (req, res) => {
    autenticar(req, 'indicadores:ler');
    const i = calcularIndicadores(b, null, lerFiltros(req.query as Record<string, unknown>));
    const { usoPaineis: _u, ...publico } = i;
    res.json(publico);
  });

  r.post('/v1/demandas', (req, res) => {
    const t = autenticar(req, 'demandas:criar');
    const dados = validar(esquemaNova, req.body);
    const r1 = abrirDemanda(b, { ...dados, canal: dados.canal === 'APP' ? 'OUVIDORIA' : dados.canal }, { id: null, nome: `Integração: ${t.nome}`, ip: req.ip }, { solicitanteId: null, registradaPor: null });
    res.status(r1.repetida ? 200 : 201).json(r1);
  });

  return r;
}

const PARAMETROS_PADRAO = {
  nomeSistema: 'Sertânia Digital',
  orgao: 'Prefeitura Municipal de Sertânia – PE',
  emailContato: '',
  telefoneContato: '',
  enderecoAtendimento: '',
  horarioAtendimento: '',
  avisoInicio: '',
};
export type Parametros = typeof PARAMETROS_PADRAO;
const esquemaParametros = z.object({
  nomeSistema: z.string().trim().min(3).max(60),
  orgao: z.string().trim().min(3).max(120),
  emailContato: z.string().trim().max(160),
  telefoneContato: z.string().trim().max(40),
  enderecoAtendimento: z.string().trim().max(200),
  horarioAtendimento: z.string().trim().max(120),
  avisoInicio: z.string().trim().max(300),
});
export function lerParametros(ctx: Ctx): Parametros {
  const r: Parametros = { ...PARAMETROS_PADRAO };
  for (const { chave, valor } of ctx.banco.all<{ chave: string; valor: string }>('SELECT chave, valor FROM parametros')) {
    if (chave in r) (r as Record<string, string>)[chave] = valor;
  }
  return r;
}
