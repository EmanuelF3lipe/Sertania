import { randomBytes } from 'node:crypto';
import type { Banco } from '../db.js';
import { agoraIso } from '../db.js';
import { STATUS, STATUS_TEXTO, type Status } from '../../shared/dominio.js';
import { sha256 } from '../auth.js';
import { mascararEmail, mascararTelefone } from '../privacidade.js';
import { canalPronto, enviar, lerConfigAvisos, telefoneE164, type ConfigAvisos, type Envio, type ResultadoEnvio, type Via } from './provedores.js';

/**
 * Fila de mensagens: o fluxo grava a mensagem (com o contato MASCARADO) e um trabalho em segundo plano envia.
 * O contato real e lido da solicitacao na hora do envio: se os dados pessoais ja foram anonimizados ou a
 * pessoa e anonima, a mensagem e cancelada. Assim a fila nunca guarda uma segunda copia de telefone ou e-mail.
 */

export type TipoMensagem = 'SITUACAO' | 'PESQUISA' | 'RELATORIO_MENSAL';
export type StatusMensagem = 'PENDENTE' | 'ENVIADA' | 'FALHOU' | 'CANCELADA' | 'SEM_PROVEDOR' | 'HISTORICO';
export type CanalMensagem = 'TELEFONE' | 'EMAIL';

export interface PreferenciasAvisos {
  /** situacoes que geram aviso ao cidadao */
  situacoes: Status[];
  pesquisaAtiva: boolean;
  /** horas depois da conclusao para pedir a avaliacao */
  pesquisaHoras: number;
  relatorioMensalAtivo: boolean;
  /** WhatsApp e SMS so saem nesta faixa (hora de Recife); fora dela esperam. */
  horaInicio: number;
  horaFim: number;
}

export const PREFERENCIAS_PADRAO: PreferenciasAvisos = {
  situacoes: ['RECEBIDA', 'ENCAMINHADA', 'AGUARDANDO_CIDADAO', 'AGENDADA', 'EM_EXECUCAO', 'IMPEDIDA', 'CONCLUIDA', 'CANCELADA'],
  pesquisaAtiva: true,
  pesquisaHoras: 2,
  relatorioMensalAtivo: true,
  horaInicio: 8,
  horaFim: 20,
};
const CHAVE = 'avisos';

export function lerPreferencias(banco: Banco): PreferenciasAvisos {
  const v = banco.get<{ valor: string }>('SELECT valor FROM parametros WHERE chave = ?', CHAVE)?.valor;
  if (!v) return { ...PREFERENCIAS_PADRAO };
  try {
    const p = { ...PREFERENCIAS_PADRAO, ...(JSON.parse(v) as Partial<PreferenciasAvisos>) };
    p.situacoes = p.situacoes.filter((s) => (STATUS as readonly string[]).includes(s));
    return p;
  } catch {
    return { ...PREFERENCIAS_PADRAO };
  }
}
export function salvarPreferencias(banco: Banco, p: PreferenciasAvisos): void {
  banco.run('INSERT INTO parametros (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', CHAVE, JSON.stringify(p));
}

// ------------------------------------------------------------------ horario de envio (fuso de Recife, UTC-3, sem horario de verao)
const RECIFE = -3;
const horaRecife = (d: Date) => (d.getUTCHours() + 24 + RECIFE) % 24;
/** Se estiver fora da faixa, devolve o proximo horario de inicio; senao, o proprio momento. */
export function dentroDoHorario(d: Date, p: Pick<PreferenciasAvisos, 'horaInicio' | 'horaFim'>): Date {
  const h = horaRecife(d);
  if (p.horaInicio <= 0 && p.horaFim >= 24) return d;
  if (h >= p.horaInicio && h < p.horaFim) return d;
  const proximo = new Date(d);
  proximo.setUTCMinutes(0, 0, 0);
  proximo.setUTCHours(p.horaInicio - RECIFE);
  if (proximo <= d) proximo.setUTCDate(proximo.getUTCDate() + 1);
  return proximo;
}

// ------------------------------------------------------------------ gravar mensagens
interface ContatoDemanda { id: number; protocolo: string; telefone: string | null; email: string | null; anonima?: boolean | number }

function linkAcompanhar(c: ConfigAvisos, protocolo: string) {
  return `${c.urlPublica}/#/acompanhar?protocolo=${encodeURIComponent(protocolo)}`;
}

function gravar(banco: Banco, m: {
  tipo: TipoMensagem; canal: CanalMensagem; destino: string; demandaId?: number | null; usuarioId?: number | null;
  assunto?: string | null; texto: string; html?: string | null; dados?: unknown; quando: Date; chave?: string | null;
}): boolean {
  const r = banco.run(
    `INSERT OR IGNORE INTO mensagens (tipo, canal, destino, demanda_id, usuario_id, assunto, texto, html, dados, status, tentativas, criado_em, proxima_em, chave)
     VALUES (?,?,?,?,?,?,?,?,?,'PENDENTE',0,?,?,?)`,
    m.tipo, m.canal, m.destino, m.demandaId ?? null, m.usuarioId ?? null, m.assunto ?? null, m.texto, m.html ?? null,
    m.dados === undefined ? null : JSON.stringify(m.dados), agoraIso(), m.quando.toISOString(), m.chave ?? null,
  );
  return r.alteradas > 0;
}

/** Aviso de mudanca de situacao para o cidadao (WhatsApp/SMS e e-mail). */
export function avisarSituacao(banco: Banco, d: ContatoDemanda, status: Status, cfg: ConfigAvisos = lerConfigAvisos()): number {
  const p = lerPreferencias(banco);
  if (d.anonima || !p.situacoes.includes(status)) return 0;
  const agora = new Date();
  const situacao = STATUS_TEXTO[status];
  const link = linkAcompanhar(cfg, d.protocolo);
  const texto = `Prefeitura de Sertânia: sua solicitação ${d.protocolo} está "${situacao}". Acompanhe: ${link}`;
  const dados = { protocolo: d.protocolo, situacao, link };
  let n = 0;
  if (d.telefone && telefoneE164(d.telefone))
    n += Number(gravar(banco, { tipo: 'SITUACAO', canal: 'TELEFONE', destino: mascararTelefone(d.telefone)!, demandaId: d.id, texto, dados, quando: dentroDoHorario(agora, p) }));
  if (d.email)
    n += Number(gravar(banco, {
      tipo: 'SITUACAO', canal: 'EMAIL', destino: mascararEmail(d.email)!, demandaId: d.id, dados, quando: agora,
      assunto: `Solicitação ${d.protocolo}: ${situacao}`,
      texto: `${texto}\n\nPara ver o histórico, use também o código de acesso que está no seu comprovante.\n\nEsta é uma mensagem automática da Prefeitura Municipal de Sertânia.`,
    }));
  return n;
}

const LINK_PESQUISA = '{{link-avaliacao}}';

/** Pede a avaliacao depois da conclusao. O link com token e criado so na hora do envio. */
export function agendarPesquisa(banco: Banco, d: ContatoDemanda & { servico: string }): number {
  const p = lerPreferencias(banco);
  if (!p.pesquisaAtiva || d.anonima) return 0;
  const quando = new Date(Date.now() + p.pesquisaHoras * 3600_000);
  const texto = `Prefeitura de Sertânia: sua solicitação ${d.protocolo} (${d.servico}) foi concluída. O problema foi resolvido? Dê uma nota de 1 a 5, leva 10 segundos: ${LINK_PESQUISA}`;
  const dados = { protocolo: d.protocolo, servico: d.servico };
  let n = 0;
  // chave unica: uma pesquisa por canal e por ciclo de atendimento
  const ciclo = banco.get<{ ciclo: number }>('SELECT ciclo FROM demandas WHERE id = ?', d.id)?.ciclo ?? 1;
  if (d.telefone && telefoneE164(d.telefone))
    n += Number(gravar(banco, { tipo: 'PESQUISA', canal: 'TELEFONE', destino: mascararTelefone(d.telefone)!, demandaId: d.id, texto, dados, quando: dentroDoHorario(quando, p), chave: `pesquisa:${d.id}:${ciclo}:tel` }));
  if (d.email)
    n += Number(gravar(banco, {
      tipo: 'PESQUISA', canal: 'EMAIL', destino: mascararEmail(d.email)!, demandaId: d.id, dados, quando, chave: `pesquisa:${d.id}:${ciclo}:email`,
      assunto: `Como foi o atendimento da solicitação ${d.protocolo}?`,
      texto: `${texto}\n\nObrigado por ajudar a melhorar o atendimento.\nPrefeitura Municipal de Sertânia`,
    }));
  return n;
}

/** Relatorio mensal para um servidor (e-mail institucional). A chave evita mandar duas vezes o mesmo mes. */
export function gravarRelatorio(banco: Banco, r: { usuarioId: number; email: string; assunto: string; texto: string; html: string; chave: string }): boolean {
  return gravar(banco, { tipo: 'RELATORIO_MENSAL', canal: 'EMAIL', destino: mascararEmail(r.email)!, usuarioId: r.usuarioId, assunto: r.assunto, texto: r.texto, html: r.html, quando: new Date(), chave: r.chave });
}

// ------------------------------------------------------------------ pesquisa por link
const VALIDADE_PESQUISA_DIAS = 30;
export function criarTokenPesquisa(banco: Banco, demandaId: number): string {
  const token = randomBytes(18).toString('base64url');
  const agora = new Date();
  banco.run('INSERT INTO pesquisas (token_hash, demanda_id, criado_em, expira_em) VALUES (?,?,?,?)', sha256(token), demandaId, agora.toISOString(), new Date(agora.getTime() + VALIDADE_PESQUISA_DIAS * 86400_000).toISOString());
  return token;
}
export function lerPesquisa(banco: Banco, token: string): { demandaId: number; usado: boolean; expirado: boolean } | null {
  const p = banco.get<{ demanda_id: number; usado_em: string | null; expira_em: string }>('SELECT demanda_id, usado_em, expira_em FROM pesquisas WHERE token_hash = ?', sha256(token));
  if (!p) return null;
  return { demandaId: p.demanda_id, usado: !!p.usado_em, expirado: Date.parse(p.expira_em) < Date.now() };
}
export function marcarPesquisaUsada(banco: Banco, demandaId: number): void {
  banco.run('UPDATE pesquisas SET usado_em = ? WHERE demanda_id = ? AND usado_em IS NULL', agoraIso(), demandaId);
}

// ------------------------------------------------------------------ envio
interface LinhaMensagem {
  id: number; tipo: TipoMensagem; canal: CanalMensagem; demanda_id: number | null; usuario_id: number | null;
  assunto: string | null; texto: string; html: string | null; dados: string | null; tentativas: number;
}
/** Espera entre tentativas: 5 min, 30 min, 2 h, 6 h. Na quinta falha, desiste. */
const ESPERAS_MIN = [5, 30, 120, 360];
export const MAX_TENTATIVAS = ESPERAS_MIN.length + 1;

type Destino = { via: Via[]; para: string } | { cancelar: string };

function destinoReal(banco: Banco, m: LinhaMensagem, cfg: ConfigAvisos): Destino {
  if (m.tipo === 'RELATORIO_MENSAL') {
    const u = banco.get<{ email: string; ativo: number }>('SELECT email, ativo FROM usuarios WHERE id = ?', m.usuario_id);
    if (!u || !u.ativo) return { cancelar: 'Servidor inativo ou removido' };
    return { via: ['EMAIL'], para: u.email };
  }
  const d = banco.get<{ solicitante_telefone: string | null; solicitante_email: string | null; anonima: number; anonimizada_em: string | null; status: Status; avaliacao_nota: number | null }>(
    'SELECT solicitante_telefone, solicitante_email, anonima, anonimizada_em, status, avaliacao_nota FROM demandas WHERE id = ?', m.demanda_id);
  if (!d) return { cancelar: 'Solicitação não encontrada' };
  if (d.anonima || d.anonimizada_em) return { cancelar: 'Dados de contato removidos (anônima ou retenção LGPD)' };
  if (m.tipo === 'PESQUISA' && (d.status !== 'CONCLUIDA' || d.avaliacao_nota)) return { cancelar: d.avaliacao_nota ? 'Já avaliada' : 'Não está mais concluída' };
  if (m.canal === 'EMAIL') return d.solicitante_email ? { via: ['EMAIL'], para: d.solicitante_email } : { cancelar: 'Sem e-mail' };
  const tel = telefoneE164(d.solicitante_telefone);
  if (!tel) return { cancelar: 'Telefone ausente ou inválido' };
  // WhatsApp primeiro (se houver modelo aprovado para o tipo), SMS como alternativa
  const temModelo = cfg.whatsapp === 'webhook' || (m.tipo === 'SITUACAO' ? !!cfg.meta.modeloSituacao : !!cfg.meta.modeloPesquisa);
  const vias: Via[] = [];
  if (canalPronto(cfg, 'WHATSAPP') && temModelo) vias.push('WHATSAPP');
  if (canalPronto(cfg, 'SMS')) vias.push('SMS');
  return { via: vias, para: tel };
}

function montarEnvio(banco: Banco, m: LinhaMensagem, via: Via, para: string, cfg: ConfigAvisos): Envio {
  const dados = (m.dados ? JSON.parse(m.dados) : {}) as Record<string, string>;
  let texto = m.texto;
  let html = m.html ?? undefined;
  let link = dados['link'] ?? '';
  if (m.tipo === 'PESQUISA') {
    link = `${cfg.urlPublica}/#/avaliar/${criarTokenPesquisa(banco, m.demanda_id!)}`;
    texto = texto.replaceAll(LINK_PESQUISA, link);
    html = html?.replaceAll(LINK_PESQUISA, link);
  }
  const modelo = via !== 'WHATSAPP' ? undefined
    : m.tipo === 'SITUACAO' ? { nome: cfg.meta.modeloSituacao, parametros: [dados['protocolo'] ?? '', dados['situacao'] ?? '', link] }
      : { nome: cfg.meta.modeloPesquisa, parametros: [dados['protocolo'] ?? '', dados['servico'] ?? '', link] };
  return { via, para, assunto: m.assunto ?? undefined, texto, html, modelo, mensagemId: m.id };
}

let ocupado = false;
export interface ResumoProcessamento { enviadas: number; falhas: number; canceladas: number; semProvedor: number }

/** Envia o que estiver vencido na fila. Chamado a cada minuto pelo servidor e pelo botao "Enviar agora". */
export async function processarFila(banco: Banco, cfg: ConfigAvisos = lerConfigAvisos(), agora = new Date(), limite = 30): Promise<ResumoProcessamento> {
  const r: ResumoProcessamento = { enviadas: 0, falhas: 0, canceladas: 0, semProvedor: 0 };
  if (ocupado) return r;
  ocupado = true;
  try {
    const fila = banco.all<LinhaMensagem>(
      "SELECT id, tipo, canal, demanda_id, usuario_id, assunto, texto, html, dados, tentativas FROM mensagens WHERE status = 'PENDENTE' AND proxima_em <= ? ORDER BY proxima_em, id LIMIT ?",
      agora.toISOString(), limite);
    for (const m of fila) {
      const dest = destinoReal(banco, m, cfg);
      if ('cancelar' in dest) {
        banco.run("UPDATE mensagens SET status = 'CANCELADA', erro = ? WHERE id = ?", dest.cancelar, m.id);
        r.canceladas++;
        continue;
      }
      const vias = dest.via.filter((v) => canalPronto(cfg, v));
      if (!vias.length) {
        banco.run("UPDATE mensagens SET status = 'SEM_PROVEDOR', erro = ? WHERE id = ?", m.canal === 'EMAIL' ? 'Envio de e-mail não configurado' : 'Envio de WhatsApp/SMS não configurado', m.id);
        r.semProvedor++;
        continue;
      }
      let res: ResultadoEnvio = { ok: false, erro: 'não tentado' };
      let usada: Via = vias[0]!;
      const erros: string[] = [];
      for (const v of vias) {
        usada = v;
        res = await enviar(cfg, montarEnvio(banco, m, v, dest.para, cfg));
        if (res.ok) break;
        erros.push(`${v}: ${res.erro}`);
      }
      if (res.ok) {
        banco.run("UPDATE mensagens SET status = 'ENVIADA', via = ?, id_externo = ?, enviado_em = ?, tentativas = tentativas + 1, erro = ? WHERE id = ?",
          usada, res.idExterno ?? null, agoraIso(), erros.length ? erros.join(' | ') : null, m.id);
        r.enviadas++;
      } else {
        const t = m.tentativas + 1;
        const espera = ESPERAS_MIN[t - 1];
        if (espera === undefined) banco.run("UPDATE mensagens SET status = 'FALHOU', tentativas = ?, erro = ? WHERE id = ?", t, erros.join(' | '), m.id);
        else banco.run('UPDATE mensagens SET tentativas = ?, erro = ?, proxima_em = ? WHERE id = ?', t, erros.join(' | '), new Date(agora.getTime() + espera * 60_000).toISOString(), m.id);
        r.falhas++;
      }
    }
    return r;
  } finally {
    ocupado = false;
  }
}

/** Volta uma mensagem para a fila (ex.: depois de configurar o provedor). */
export function reenviar(banco: Banco, id: number): boolean {
  return banco.run("UPDATE mensagens SET status = 'PENDENTE', tentativas = 0, erro = NULL, proxima_em = ? WHERE id = ? AND status IN ('FALHOU','SEM_PROVEDOR','CANCELADA')", agoraIso(), id).alteradas > 0;
}

/** Mensagem de teste, enviada na hora para um endereco digitado pela administracao (nao fica guardado). */
export async function enviarTeste(cfg: ConfigAvisos, via: Via, para: string): Promise<ResultadoEnvio> {
  const destino = via === 'EMAIL' ? para.trim() : telefoneE164(para);
  if (!destino) return { ok: false, erro: 'Telefone inválido. Use DDD + número, ex.: (87) 99999-1234' };
  const texto = 'Teste do Sertânia Digital: se você recebeu esta mensagem, o envio está funcionando.';
  return enviar(cfg, {
    via, para: destino, assunto: 'Teste de envio do Sertânia Digital', texto,
    modelo: via === 'WHATSAPP' ? { nome: cfg.meta.modeloSituacao, parametros: ['SER-TESTE', 'Teste de envio', cfg.urlPublica] } : undefined,
  });
}

export function resumoMensagens(banco: Banco) {
  const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
  const porStatus = banco.all<{ status: StatusMensagem; total: number }>('SELECT status, COUNT(*) AS total FROM mensagens WHERE criado_em >= ? GROUP BY status', desde);
  const porTipo = banco.all<{ tipo: TipoMensagem; total: number }>("SELECT tipo, COUNT(*) AS total FROM mensagens WHERE criado_em >= ? AND status = 'ENVIADA' GROUP BY tipo", desde);
  const ultimas = banco.all<{
    id: number; tipo: TipoMensagem; canal: CanalMensagem; destino: string; via: string | null; status: StatusMensagem; tentativas: number;
    erro: string | null; criado_em: string; enviado_em: string | null; proxima_em: string; assunto: string | null; texto: string; protocolo: string | null;
  }>(`SELECT m.id, m.tipo, m.canal, m.destino, m.via, m.status, m.tentativas, m.erro, m.criado_em, m.enviado_em, m.proxima_em, m.assunto, m.texto, d.protocolo
      FROM mensagens m LEFT JOIN demandas d ON d.id = m.demanda_id ORDER BY m.id DESC LIMIT 60`);
  return {
    porStatus: Object.fromEntries(porStatus.map((s) => [s.status, s.total])) as Partial<Record<StatusMensagem, number>>,
    porTipo: Object.fromEntries(porTipo.map((s) => [s.tipo, s.total])) as Partial<Record<TipoMensagem, number>>,
    ultimas: ultimas.map((m) => ({
      id: m.id, tipo: m.tipo, canal: m.canal, destino: m.destino, via: m.via, status: m.status, tentativas: m.tentativas, erro: m.erro,
      criadoEm: m.criado_em, enviadoEm: m.enviado_em, proximaEm: m.proxima_em, protocolo: m.protocolo,
      resumo: (m.assunto ?? m.texto).replaceAll(LINK_PESQUISA, '[link de avaliação]').slice(0, 160),
    })),
  };
}
