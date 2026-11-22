import { Router, type Request } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { CANAIS, PRIORIDADES, type Catalogo } from '../../shared/dominio.js';
import { ator, validar, textoOpc, type Ctx } from '../contexto.js';
import { limitador, sha256 } from '../auth.js';
import { abrirDemanda, carregar, paraDetalhe, responderCidadao, SELECT_DEMANDA, type LinhaDemanda, type NovaDemanda } from '../demandas.js';
import { receberArquivos, salvarArquivo } from '../arquivos.js';
import { agoraIso } from '../db.js';
import { invalido, naoEncontrado, conflito } from '../erros.js';
import { auditar } from '../auditoria.js';
import { marcarRecorrencia, sugerirServico, analisarDemanda } from '../ia/servico.js';
import { calcularIndicadores, dadosAbertos } from '../indicadores.js';

export const esquemaNova = z.object({
  servicoId: z.coerce.number().int().positive(),
  descricao: z.string().min(10, 'descreva com pelo menos 10 caracteres').max(4000),
  localidadeId: z.coerce.number().int().positive().nullable().optional().transform((v) => v ?? null),
  lat: z.number().nullable().optional().transform((v) => v ?? null),
  lng: z.number().nullable().optional().transform((v) => v ?? null),
  endereco: textoOpc,
  referencia: textoOpc,
  canal: z.enum(CANAIS).default('APP'),
  anonima: z.boolean().default(false),
  nome: textoOpc,
  telefone: textoOpc,
  email: z.string().email('e-mail inválido').optional().nullable().or(z.literal('')).transform((v) => (v ? v : null)),
  prioridade: z.enum(PRIORIDADES).optional(),
  chaveIdempotencia: z.string().min(8).max(80).optional(),
  consentimento: z.boolean().optional(),
});

export function lerCatalogo(ctx: Ctx, incluirInativos = false): Catalogo {
  const b = ctx.banco;
  return {
    secretarias: b.all('SELECT id, nome, sigla FROM secretarias ORDER BY nome'),
    setores: b.all('SELECT id, secretaria_id AS secretariaId, nome FROM setores ORDER BY nome'),
    servicos: b
      .all<Record<string, unknown>>(
        `SELECT sv.id, sv.setor_id AS setorId, st.secretaria_id AS secretariaId, sv.nome, sv.descricao, sv.palavras_chave AS palavrasChave,
                sv.prazo_dias_uteis AS prazoDiasUteis, sv.prioridade_padrao AS prioridadePadrao, sv.ativo
         FROM servicos sv JOIN setores st ON st.id = sv.setor_id ${incluirInativos ? '' : 'WHERE sv.ativo = 1'} ORDER BY sv.nome`,
      )
      .map((s) => ({ ...s, ativo: s['ativo'] === 1 })) as Catalogo['servicos'],
    localidades: b.all('SELECT id, nome, tipo, lat, lng FROM localidades ORDER BY tipo, nome'),
  };
}

/** Le o campo "dados" (JSON) de um multipart, ou o corpo JSON. */
export function corpoMultipart(req: Request): unknown {
  const bruto = (req.body as Record<string, unknown> | undefined)?.['dados'];
  if (typeof bruto === 'string') {
    try {
      return JSON.parse(bruto);
    } catch {
      throw invalido('Dados do formulário ilegíveis');
    }
  }
  return req.body;
}

export function registrarAnexos(ctx: Ctx, req: Request, demandaId: number, eventoId: number | null, origem: string): void {
  const arquivos = (req.files as Express.Multer.File[] | undefined) ?? [];
  for (const a of arquivos) {
    const s = salvarArquivo(ctx.config.pastaDados, a);
    ctx.banco.run(
      'INSERT INTO anexos (demanda_id, evento_id, nome, mime, tamanho, sha256, caminho, origem, enviado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)',
      demandaId, eventoId, s.nome, s.mime, s.tamanho, s.sha256, s.caminho, origem, req.usuario?.id ?? null, agoraIso(),
    );
  }
}

/** Valida protocolo + codigo de acesso em tempo constante. */
export function demandaPorCodigo(ctx: Ctx, protocolo: string, codigo: string): LinhaDemanda {
  const d = ctx.banco.get<LinhaDemanda>(`${SELECT_DEMANDA} WHERE d.protocolo = ?`, protocolo.trim().toUpperCase());
  const esperado = Buffer.from(d?.codigo_hash ?? sha256('x'), 'hex');
  const recebido = Buffer.from(sha256(codigo.trim().toUpperCase()), 'hex');
  if (!d || !timingSafeEqual(esperado, recebido)) throw naoEncontrado('Protocolo ou código de acesso não conferem');
  return d;
}

export function rotasPublicas(ctx: Ctx): Router {
  const r = Router();
  const lim = limitador(30, 10 * 60_000);

  r.get('/catalogo', (_req, res) => {
    res.json(lerCatalogo(ctx));
  });

  r.post('/sugerir-servico', (req, res) => {
    const { texto } = validar(z.object({ texto: z.string().max(4000) }), req.body);
    res.json(texto.trim().length < 8 ? [] : sugerirServico(ctx.banco, texto));
  });

  r.post('/demandas', lim, receberArquivos, async (req, res) => {
    const dados = validar(esquemaNova, corpoMultipart(req));
    if (!dados.anonima && !dados.consentimento && !req.usuario)
      throw invalido('Para informar seus dados de contato, confirme que concorda com o uso para este atendimento (LGPD)');
    const nova: NovaDemanda = {
      ...dados,
      nome: dados.nome ?? (req.usuario?.nome ?? null),
      email: dados.email ?? (req.usuario?.email ?? null),
      canal: 'APP',
      prioridade: undefined, // o cidadao nao define prioridade
    };
    const r1 = abrirDemanda(ctx.banco, nova, ator(req), { solicitanteId: req.usuario?.papel === 'CIDADAO' ? req.usuario.id : null, registradaPor: null });
    if (!r1.repetida) {
      registrarAnexos(ctx, req, r1.id, null, 'CIDADAO');
      marcarRecorrencia(ctx.banco, r1.id);
      void analisarDemanda(ctx.banco, ctx.config, r1.id).catch((e: Error) => console.warn('[ia]', e.message));
    }
    res.status(r1.repetida ? 200 : 201).json({ protocolo: r1.protocolo, codigo: r1.codigo, repetida: r1.repetida });
  });

  const esquemaAcesso = z.object({ protocolo: z.string().min(5).max(30), codigo: z.string().min(4).max(12) });

  r.post('/acompanhar', lim, (req, res) => {
    const { protocolo, codigo } = validar(esquemaAcesso, req.body);
    const d = demandaPorCodigo(ctx, protocolo, codigo);
    res.json(paraDetalhe(ctx.banco, d, null));
  });

  r.post('/responder', lim, receberArquivos, (req, res) => {
    const dados = validar(esquemaAcesso.extend({ texto: z.string().min(2).max(4000) }), corpoMultipart(req));
    const d = demandaPorCodigo(ctx, dados.protocolo, dados.codigo);
    const eventoId = responderCidadao(ctx.banco, d, dados.texto, ator(req));
    registrarAnexos(ctx, req, d.id, eventoId, 'CIDADAO');
    res.json(paraDetalhe(ctx.banco, carregar(ctx.banco, d.id), null));
  });

  r.post('/avaliar', lim, (req, res) => {
    const dados = validar(esquemaAcesso.extend({ nota: z.number().int().min(1).max(5), comentario: textoOpc }), req.body);
    const d = demandaPorCodigo(ctx, dados.protocolo, dados.codigo);
    if (d.status !== 'CONCLUIDA') throw conflito('A avaliação fica disponível quando a solicitação for concluída');
    if (d.avaliacao_nota) throw conflito('Esta solicitação já foi avaliada. Obrigado!');
    ctx.banco.run('UPDATE demandas SET avaliacao_nota = ?, avaliacao_comentario = ? WHERE id = ?', dados.nota, dados.comentario, d.id);
    auditar(ctx.banco, ator(req), 'AVALIACAO', 'demanda', d.id, { nota: dados.nota });
    res.json({ ok: true });
  });

  /** Transparencia: indicadores agregados do municipio, sem dados pessoais. */
  r.get('/transparencia', (_req, res) => {
    const desde = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const i = calcularIndicadores(ctx.banco, null, { de: desde });
    res.json({
      periodo: `últimos 90 dias (desde ${desde})`,
      total: i.total, concluidas: i.concluidas, abertas: i.abertas, noPrazoPct: i.noPrazoPct,
      tempoAtendimentoHoras: i.tempoAtendimentoHoras.mediana, satisfacao: i.satisfacao.media,
      porSecretaria: i.porSecretaria.map(({ nome, total, concluidas }) => ({ nome, total, concluidas })),
      porLocalidade: i.porLocalidade.map(({ nome, total }) => ({ nome, total })),
    });
  });

  r.get('/dados-abertos', (req, res) => {
    const dados = dadosAbertos(ctx.banco, ctx.config.limiarSupressao);
    if (req.query['formato'] === 'csv') {
      const linhas = ['mes;secretaria;servico;localidade;situacao;total', ...dados.registros.map((x) => [x.mes, x.secretaria, x.servico, x.localidade ?? '', x.status, x.suprimido ? `<${dados.limiarSupressao}` : x.total].join(';'))];
      res.type('text/csv; charset=utf-8').attachment('sertania-dados-abertos.csv').send(`﻿${linhas.join('\n')}`);
      return;
    }
    res.json(dados);
  });

  return r;
}
