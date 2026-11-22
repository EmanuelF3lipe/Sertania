import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { COMANDOS, PRIORIDADES, RESULTADOS, STATUS_TEXTO, tem, type AnaliseIa, type Comando } from '../../shared/dominio.js';
import { ator, idParam, validar, textoOpc, type Ctx } from '../contexto.js';
import { exigir, exigirLogin } from '../auth.js';
import { abrirDemanda, anotar, carregar, executarComando, noEscopo, paraDetalhe, paraResumo, SELECT_DEMANDA, type LinhaDemanda } from '../demandas.js';
import { corpoMultipart, esquemaNova, registrarAnexos } from './publico.js';
import { receberArquivos } from '../arquivos.js';
import { auditar } from '../auditoria.js';
import { agoraIso } from '../db.js';
import { conflito, invalido, naoEncontrado, proibido } from '../erros.js';
import { calcularIndicadores, lerFiltros, paraBasicos, whereFiltros } from '../indicadores.js';
import { analisarDemanda, gerarNarrativa, gruposRecorrentes, invalidarClassificador, marcarRecorrencia, recalcularAlertas, similares } from '../ia/servico.js';
import { filtroEscopo } from '../demandas.js';

export function rotasGestao(ctx: Ctx): Router {
  const r = Router();
  const b = ctx.banco;

  const registrarUso = (usuarioId: number, painel: string) => b.run('INSERT INTO uso_paineis (usuario_id, painel, em) VALUES (?,?,?)', usuarioId, painel, agoraIso());

  const carregarNoEscopo = (req: Parameters<typeof exigirLogin>[0]): LinhaDemanda => {
    const u = exigir(req, 'demanda.ver');
    const d = carregar(b, idParam(req));
    if (!noEscopo(u, d)) {
      auditar(b, ator(req), 'ACESSO_NEGADO', 'demanda', d.id, { motivo: 'fora do escopo' });
      throw proibido('Esta solicitação pertence a outro setor ou secretaria');
    }
    return d;
  };

  // ------------------------------------------------------------- fila
  r.get('/demandas', (req, res) => {
    const u = exigir(req, 'demanda.ver');
    const f = lerFiltros(req.query as Record<string, unknown>);
    const w = whereFiltros(u, f);
    const extra: string[] = [];
    const vis = String(req.query['visao'] ?? '');
    if (vis === 'minhas') extra.push(`d.responsavel_id = ${u.id}`);
    if (vis === 'sem_responsavel') extra.push("d.responsavel_id IS NULL AND d.status NOT IN ('CONCLUIDA','CANCELADA')");
    if (vis === 'triagem') extra.push("d.status = 'RECEBIDA'");
    if (vis === 'vencidas') extra.push(`d.status NOT IN ('CONCLUIDA','CANCELADA') AND d.pausada_desde IS NULL AND d.prazo_em < '${new Date().toISOString()}'`);
    if (vis === 'urgentes') extra.push("d.prioridade IN ('ALTA','URGENTE') AND d.status NOT IN ('CONCLUIDA','CANCELADA')");
    const where = [w.sql, ...extra].join(' AND ');
    const limite = Math.min(Number(req.query['limite'] ?? 50) || 50, 500);
    const pagina = Math.max(Number(req.query['pagina'] ?? 1) || 1, 1);
    const total = b.get<{ n: number }>(`SELECT COUNT(*) AS n FROM demandas d WHERE ${where}`, ...w.params)!.n;
    const linhas = b.all<LinhaDemanda>(
      `${SELECT_DEMANDA} WHERE ${where}
       ORDER BY CASE d.prioridade WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
                CASE WHEN d.status IN ('CONCLUIDA','CANCELADA') THEN 1 ELSE 0 END, d.prazo_em, d.criada_em DESC
       LIMIT ? OFFSET ?`,
      ...w.params, limite, (pagina - 1) * limite,
    );
    res.json({ total, pagina, limite, itens: linhas.map(paraResumo) });
  });

  r.get('/demandas/:id', (req, res) => {
    const d = carregarNoEscopo(req);
    const u = req.usuario!;
    if (tem(u.papel, 'demanda.ver_dados_pessoais')) auditar(b, ator(req), 'DADOS_PESSOAIS_VISUALIZADOS', 'demanda', d.id);
    const sugestao = b.get<{ id: number; conteudo: string; status: string; provedor: string; criado_em: string }>(
      "SELECT * FROM sugestoes_ia WHERE demanda_id = ? AND status <> 'SUBSTITUIDA' ORDER BY id DESC LIMIT 1", d.id,
    );
    res.json({
      ...paraDetalhe(b, d, u),
      similares: similares(b, d),
      sugestaoIa: sugestao ? { ...(JSON.parse(sugestao.conteudo) as AnaliseIa), id: sugestao.id, status: sugestao.status, provedor: sugestao.provedor, criadoEm: sugestao.criado_em } : null,
      notificacoes: b.all('SELECT canal, destino, mensagem, criado_em AS criadoEm FROM notificacoes WHERE demanda_id = ? ORDER BY id DESC LIMIT 20', d.id),
    });
  });

  // ------------------------------------------------------------- atendimento assistido
  r.post('/demandas', receberArquivos, (req, res) => {
    const u = exigir(req, 'demanda.registrar_assistido');
    const dados = validar(esquemaNova, corpoMultipart(req));
    if (dados.canal === 'APP') throw invalido('Informe o canal do atendimento (presencial, telefone, WhatsApp ou ouvidoria)');
    const r1 = abrirDemanda(b, { ...dados }, ator(req), { solicitanteId: null, registradaPor: u.id });
    if (!r1.repetida) {
      registrarAnexos(ctx, req, r1.id, null, 'CIDADAO');
      marcarRecorrencia(b, r1.id);
      void analisarDemanda(b, ctx.config, r1.id).catch(() => undefined);
    }
    res.status(201).json({ ...r1, id: r1.id });
  });

  // ------------------------------------------------------------- comandos
  r.post('/demandas/:id/comandos/:comando', (req, res) => {
    const u = exigirLogin(req);
    const comando = String(req.params['comando']) as Comando;
    if (!COMANDOS.includes(comando)) throw invalido('Comando desconhecido');
    const e = validar(
      z.object({
        versao: z.number().int(),
        textoPublico: z.string().max(4000).optional(),
        notaInterna: z.string().max(4000).optional(),
        servicoId: z.number().int().optional(),
        resultado: z.enum(RESULTADOS).optional(),
        agendadaPara: z.string().optional(),
        prioridade: z.enum(PRIORIDADES).optional(),
      }),
      req.body,
    );
    const d = executarComando(b, idParam(req), comando, e, u, req.ip);
    if (comando === 'ENCAMINHAR') invalidarClassificador();
    res.json(paraDetalhe(b, d, u));
  });

  r.post('/demandas/:id/atribuir', (req, res) => {
    const u = exigir(req, 'demanda.atribuir');
    const d = carregarNoEscopo(req);
    const { responsavelId, versao } = validar(z.object({ responsavelId: z.number().int().nullable(), versao: z.number().int() }), req.body);
    if (d.versao !== versao) throw conflito('Esta solicitação foi alterada. Recarregue.');
    if (responsavelId !== null) {
      const resp = b.get<{ setor_id: number | null; ativo: number; nome: string }>('SELECT setor_id, ativo, nome FROM usuarios WHERE id = ?', responsavelId);
      if (!resp || !resp.ativo || resp.setor_id !== d.setor_id) throw invalido('O responsável precisa estar ativo e lotado no setor da solicitação');
    }
    b.run('UPDATE demandas SET responsavel_id = ?, versao = versao + 1 WHERE id = ?', responsavelId, d.id);
    const nome = responsavelId ? b.get<{ nome: string }>('SELECT nome FROM usuarios WHERE id = ?', responsavelId)!.nome : 'ninguém';
    b.run(
      "INSERT INTO eventos (demanda_id, tipo, de_status, para_status, nota_interna, autor_id, autor_nome, criado_em) VALUES (?, 'ATRIBUICAO', ?, ?, ?, ?, ?, ?)",
      d.id, d.status, d.status, `Responsável definido: ${nome}`, u.id, u.nome, agoraIso(),
    );
    auditar(b, ator(req), 'ATRIBUICAO', 'demanda', d.id, { responsavelId });
    res.json(paraDetalhe(b, carregar(b, d.id), u));
  });

  r.post('/demandas/:id/anotacoes', receberArquivos, (req, res) => {
    const u = exigir(req, 'demanda.executar', 'demanda.triagem');
    const d = carregarNoEscopo(req);
    const dados = validar(z.object({ textoPublico: textoOpc, notaInterna: textoOpc, visivelCidadao: z.boolean().default(false) }), corpoMultipart(req));
    const temArquivos = ((req.files as unknown[] | undefined) ?? []).length > 0;
    const eventoId = anotar(b, d, u, dados.textoPublico, dados.notaInterna ?? (temArquivos ? 'Evidência anexada' : null));
    registrarAnexos(ctx, req, d.id, eventoId, dados.visivelCidadao ? 'EXECUCAO' : 'INTERNO');
    auditar(b, ator(req), 'REGISTRO_EXECUCAO', 'demanda', d.id, { arquivos: temArquivos });
    res.json(paraDetalhe(b, carregar(b, d.id), u));
  });

  r.get('/responsaveis', (req, res) => {
    exigir(req, 'demanda.atribuir');
    const setorId = Number(req.query['setorId']);
    res.json(b.all("SELECT id, nome, papel FROM usuarios WHERE setor_id = ? AND ativo = 1 AND papel IN ('CAMPO','GESTOR_SETOR','GESTOR_SECRETARIA') ORDER BY nome", setorId));
  });

  // ------------------------------------------------------------- anexos
  r.get('/anexos/:id', (req, res) => {
    const u = exigirLogin(req);
    const a = b.get<{ demanda_id: number; caminho: string; mime: string; nome: string; origem: string }>('SELECT * FROM anexos WHERE id = ?', idParam(req));
    if (!a) throw naoEncontrado();
    const d = carregar(b, a.demanda_id);
    const permitido = u.papel === 'CIDADAO' ? d.solicitante_id === u.id && a.origem !== 'INTERNO' : tem(u.papel, 'demanda.ver') && noEscopo(u, d);
    if (!permitido) throw proibido();
    const arquivo = path.resolve(ctx.config.pastaDados, a.caminho);
    if (!arquivo.startsWith(path.resolve(ctx.config.pastaDados)) || !fs.existsSync(arquivo)) throw naoEncontrado('Arquivo indisponível');
    auditar(b, ator(req), 'ANEXO_ACESSADO', 'anexo', String(req.params['id']));
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.nome)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(arquivo).pipe(res);
  });

  // ------------------------------------------------------------- mapa
  r.get('/mapa', (req, res) => {
    const u = exigir(req, 'demanda.ver');
    registrarUso(u.id, 'mapa');
    const w = whereFiltros(u, lerFiltros(req.query as Record<string, unknown>));
    const pontos = b.all<LinhaDemanda>(`${SELECT_DEMANDA} WHERE ${w.sql} ORDER BY d.criada_em DESC LIMIT 3000`, ...w.params).map((d) => {
      const lat = d.lat ?? b.get<{ lat: number }>('SELECT lat FROM localidades WHERE id = ?', d.localidade_id)?.lat ?? null;
      const lng = d.lng ?? b.get<{ lng: number }>('SELECT lng FROM localidades WHERE id = ?', d.localidade_id)?.lng ?? null;
      return { id: d.id, protocolo: d.protocolo, status: d.status, statusTexto: STATUS_TEXTO[d.status], servico: d.servico_nome, secretaria: d.secretaria_nome, localidade: d.localidade_nome, prioridade: d.prioridade, lat, lng, aproximado: d.lat === null, recorrente: d.recorrencia_de !== null, criadaEm: d.criada_em };
    });
    const e = filtroEscopo(u);
    res.json({ pontos: pontos.filter((p) => p.lat !== null), recorrencias: gruposRecorrentes(b, e.sql, e.params).filter((g) => g.total >= 3) });
  });

  // ------------------------------------------------------------- indicadores e relatorios
  r.get('/indicadores', (req, res) => {
    const u = exigir(req, 'painel.ver');
    registrarUso(u.id, 'painel');
    res.json(calcularIndicadores(b, u, lerFiltros(req.query as Record<string, unknown>)));
  });

  r.get('/exportar', (req, res) => {
    const u = exigir(req, 'relatorio.gerar', 'painel.ver');
    registrarUso(u.id, 'exportacao');
    const w = whereFiltros(u, lerFiltros(req.query as Record<string, unknown>));
    const linhas = b.all<LinhaDemanda>(`${SELECT_DEMANDA} WHERE ${w.sql} ORDER BY d.criada_em`, ...w.params);
    auditar(b, ator(req), 'EXPORTACAO', 'demanda', null, { registros: linhas.length, formato: req.query['formato'] });
    // Exportacao gerencial nunca leva dados pessoais do solicitante.
    const dados = linhas.map((d) => {
      const s = paraResumo(d);
      return {
        protocolo: s.protocolo, status: s.statusTexto, prioridade: s.prioridade, servico: s.servico, setor: s.setor, secretaria: s.secretaria,
        localidade: s.localidade ?? '', canal: s.canal, criada_em: s.criadaEm, encaminhada_em: d.encaminhada_em ?? '', concluida_em: d.concluida_em ?? '',
        prazo_em: d.prazo_em ?? '', no_prazo: d.concluida_em && d.prazo_em ? (d.concluida_em <= d.prazo_em ? 'sim' : 'não') : '', resultado: d.resultado ?? '',
        recorrente: s.recorrente ? 'sim' : 'não', avaliacao: d.avaliacao_nota ?? '', lat: d.lat ?? '', lng: d.lng ?? '',
      };
    });
    if (req.query['formato'] === 'json') {
      res.attachment('demandas-sertania.json').json(dados);
      return;
    }
    const cab = Object.keys(dados[0] ?? { protocolo: '' });
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [cab.join(';'), ...dados.map((l) => cab.map((c) => esc((l as Record<string, unknown>)[c])).join(';'))].join('\n');
    res.type('text/csv; charset=utf-8').attachment('demandas-sertania.csv').send(`﻿${csv}`);
  });

  r.get('/relatorios', (req, res) => {
    const u = exigir(req, 'relatorio.gerar', 'painel.ver');
    registrarUso(u.id, 'relatorios');
    res.json(b.all('SELECT r.id, r.titulo, r.filtros, r.narrativa_status AS narrativaStatus, r.provedor, r.criado_em AS criadoEm, u.nome AS autor FROM relatorios r LEFT JOIN usuarios u ON u.id = r.gerado_por ORDER BY r.id DESC LIMIT 100'));
  });

  r.get('/relatorios/:id', (req, res) => {
    exigir(req, 'relatorio.gerar', 'painel.ver');
    const rel = b.get<Record<string, string>>('SELECT * FROM relatorios WHERE id = ?', idParam(req));
    if (!rel) throw naoEncontrado();
    res.json({ ...rel, filtros: JSON.parse(rel['filtros'] ?? '{}'), conteudo: JSON.parse(rel['conteudo'] ?? '{}') });
  });

  r.post('/relatorios', async (req, res) => {
    const u = exigir(req, 'relatorio.gerar');
    const { titulo, filtros } = validar(z.object({ titulo: z.string().min(3).max(160), filtros: z.record(z.unknown()).default({}) }), req.body);
    const f = lerFiltros(filtros);
    const ind = calcularIndicadores(b, u, f);
    const periodo = `${f.de ?? 'início'} a ${f.ate ?? 'hoje'}`;
    const n = await gerarNarrativa(ctx.config, paraBasicos(ind), periodo);
    const { id } = b.run(
      "INSERT INTO relatorios (titulo, filtros, conteudo, narrativa, narrativa_status, provedor, gerado_por, criado_em) VALUES (?,?,?,?, 'RASCUNHO_IA', ?, ?, ?)",
      titulo, JSON.stringify(f), JSON.stringify(ind), n.texto, n.provedor, u.id, agoraIso(),
    );
    auditar(b, ator(req), 'RELATORIO_GERADO', 'relatorio', id, { provedor: n.provedor });
    res.status(201).json({ id });
  });

  r.patch('/relatorios/:id', (req, res) => {
    const u = exigir(req, 'relatorio.gerar');
    const { narrativa } = validar(z.object({ narrativa: z.string().min(10).max(20000) }), req.body);
    const rel = b.get<{ id: number }>('SELECT id FROM relatorios WHERE id = ?', idParam(req));
    if (!rel) throw naoEncontrado();
    b.run("UPDATE relatorios SET narrativa = ?, narrativa_status = 'REVISADO', revisado_por = ? WHERE id = ?", narrativa, u.id, rel.id);
    auditar(b, ator(req), 'RELATORIO_REVISADO', 'relatorio', rel.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- IA supervisionada
  r.post('/demandas/:id/analisar', async (req, res) => {
    exigir(req, 'ia.usar');
    const d = carregarNoEscopo(req);
    const a = await analisarDemanda(b, ctx.config, d.id);
    auditar(b, ator(req), 'IA_ANALISE_SOLICITADA', 'demanda', d.id, { provedor: a.provedor });
    res.json(a);
  });

  r.post('/ia/sugestoes/:id/decidir', (req, res) => {
    const u = exigir(req, 'ia.decidir');
    const s = b.get<{ id: number; demanda_id: number; status: string }>('SELECT * FROM sugestoes_ia WHERE id = ?', idParam(req));
    if (!s) throw naoEncontrado();
    if (s.status !== 'PENDENTE') throw conflito('Esta sugestão já foi decidida');
    const d = carregar(b, s.demanda_id);
    if (!noEscopo(u, d)) throw proibido();
    const { decisao, detalhe } = validar(z.object({ decisao: z.enum(['ACEITA', 'AJUSTADA', 'REJEITADA']), detalhe: z.string().max(1000).optional() }), req.body);
    b.run('UPDATE sugestoes_ia SET status = ?, decisao_detalhe = ?, decidido_por = ?, decidido_em = ? WHERE id = ?', decisao, detalhe ?? null, u.id, agoraIso(), s.id);
    auditar(b, ator(req), `IA_SUGESTAO_${decisao}`, 'demanda', d.id, { sugestaoId: s.id, detalhe });
    res.json({ ok: true });
  });

  r.get('/ia/sugestoes', (req, res) => {
    const u = exigir(req, 'ia.usar');
    const e = filtroEscopo(u);
    res.json(
      b.all<{ conteudo: string } & Record<string, unknown>>(
        `SELECT s.id, s.demanda_id AS demandaId, d.protocolo, s.status, s.provedor, s.conteudo, s.criado_em AS criadoEm, d.status AS statusDemanda
         FROM sugestoes_ia s JOIN demandas d ON d.id = s.demanda_id WHERE ${e.sql} AND s.status = 'PENDENTE' ORDER BY s.id DESC LIMIT 100`,
        ...e.params,
      ).map(({ conteudo, ...s }) => ({ ...s, ...(JSON.parse(conteudo) as AnaliseIa) })),
    );
  });

  r.get('/ia/recorrencias', (req, res) => {
    const u = exigir(req, 'ia.usar', 'painel.ver');
    const e = filtroEscopo(u);
    res.json(gruposRecorrentes(b, e.sql, e.params));
  });

  r.get('/alertas', (req, res) => {
    const u = exigir(req, 'painel.ver', 'demanda.triagem', 'demanda.executar');
    const status = String(req.query['status'] ?? 'ABERTO');
    const escopo = u.papel === 'GESTOR_SECRETARIA' || u.papel === 'GESTOR_SETOR' || u.papel === 'CAMPO' ? 'AND (a.secretaria_id = ? OR a.secretaria_id IS NULL)' : '';
    res.json(
      b.all(
        `SELECT a.*, l.nome AS localidade, sc.nome AS secretaria, d.protocolo FROM alertas a
         LEFT JOIN localidades l ON l.id = a.localidade_id LEFT JOIN secretarias sc ON sc.id = a.secretaria_id LEFT JOIN demandas d ON d.id = a.demanda_id
         WHERE a.status = ? ${escopo} ORDER BY CASE a.severidade WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END, a.atualizado_em DESC LIMIT 300`,
        status, ...(escopo ? [u.secretariaId] : []),
      ),
    );
  });

  r.post('/alertas/recalcular', (req, res) => {
    exigir(req, 'alerta.tratar');
    res.json(recalcularAlertas(b));
  });

  r.post('/alertas/:id', (req, res) => {
    const u = exigir(req, 'alerta.tratar');
    const { status, observacao } = validar(z.object({ status: z.enum(['RECONHECIDO', 'DESCARTADO', 'RESOLVIDO']), observacao: z.string().max(1000).optional() }), req.body);
    const a = b.get<{ id: number }>('SELECT id FROM alertas WHERE id = ?', idParam(req));
    if (!a) throw naoEncontrado();
    b.run('UPDATE alertas SET status = ?, observacao = ?, tratado_por = ?, tratado_em = ? WHERE id = ?', status, observacao ?? null, u.id, agoraIso(), a.id);
    auditar(b, ator(req), `ALERTA_${status}`, 'alerta', a.id, { observacao });
    res.json({ ok: true });
  });

  return r;
}
