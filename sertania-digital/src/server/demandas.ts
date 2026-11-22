import { randomInt } from 'node:crypto';
import type { Banco } from './db.js';
import { agoraIso } from './db.js';
import {
  CANAIS, ESCOPO_PAPEL, PRIORIDADES, REGRAS, RESULTADOS, STATUS_TEXTO, comandosPermitidos, podeTransicionar, tem,
  type AnexoDto, type Canal, type Comando, type DemandaDetalhe, type DemandaResumo, type EventoDto, type Prioridade,
  type Resultado, type Status, type UsuarioSessao,
} from '../shared/dominio.js';
import { calcularSla, somarDiasUteis } from '../shared/sla.js';
import { conflito, invalido, naoEncontrado, proibido } from './erros.js';
import { sha256 } from './auth.js';
import { auditar, type Ator } from './auditoria.js';
import { mascararEmail, mascararNome, mascararTelefone } from './privacidade.js';

export interface LinhaDemanda {
  id: number; protocolo: string; codigo_hash: string; servico_id: number; setor_id: number; secretaria_id: number;
  status: Status; status_anterior: Status | null; prioridade: Prioridade; descricao: string;
  endereco: string | null; referencia: string | null; localidade_id: number | null; lat: number | null; lng: number | null;
  canal: Canal; solicitante_id: number | null; solicitante_nome: string | null; solicitante_telefone: string | null;
  solicitante_email: string | null; anonima: number; responsavel_id: number | null; registrada_por: number | null;
  criada_em: string; encaminhada_em: string | null; primeira_resposta_em: string | null; concluida_em: string | null;
  prazo_em: string | null; pausada_desde: string | null; resultado: Resultado | null; agendada_para: string | null;
  ciclo: number; reaberturas: number; recorrencia_de: number | null; avaliacao_nota: number | null;
  avaliacao_comentario: string | null; versao: number; anonimizada_em: string | null;
  // juncoes
  servico_nome: string; setor_nome: string; secretaria_nome: string; localidade_nome: string | null; responsavel_nome: string | null;
}

export const SELECT_DEMANDA = `
  SELECT d.*, sv.nome AS servico_nome, st.nome AS setor_nome, sc.nome AS secretaria_nome,
         l.nome AS localidade_nome, r.nome AS responsavel_nome
  FROM demandas d
  JOIN servicos sv ON sv.id = d.servico_id
  JOIN setores st ON st.id = d.setor_id
  JOIN secretarias sc ON sc.id = d.secretaria_id
  LEFT JOIN localidades l ON l.id = d.localidade_id
  LEFT JOIN usuarios r ON r.id = d.responsavel_id`;

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function gerarCodigo(): string {
  return Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
}

export function feriados(banco: Banco): Set<string> {
  return new Set(banco.all<{ data: string }>('SELECT data FROM feriados').map((f) => f.data));
}

function proximoProtocolo(banco: Banco, ano: number): string {
  const chave = `protocolo-${ano}`;
  banco.run('INSERT INTO contadores (chave, valor) VALUES (?, 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1', chave);
  const { valor } = banco.get<{ valor: number }>('SELECT valor FROM contadores WHERE chave = ?', chave)!;
  return `SER-${ano}-${String(valor).padStart(6, '0')}`;
}

export function slaDe(d: LinhaDemanda) {
  return calcularSla({
    criadaEm: new Date(d.criada_em),
    prazoEm: d.prazo_em ? new Date(d.prazo_em) : null,
    pausadaDesde: d.pausada_desde ? new Date(d.pausada_desde) : null,
    encerradaEm: d.concluida_em ? new Date(d.concluida_em) : null,
  });
}

// ---------------------------------------------------------------------------
// Escopo e visibilidade
// ---------------------------------------------------------------------------

export function filtroEscopo(u: UsuarioSessao): { sql: string; params: Array<number | null> } {
  switch (ESCOPO_PAPEL[u.papel]) {
    case 'PROPRIO': return { sql: 'd.solicitante_id = ?', params: [u.id] };
    case 'SETOR': return { sql: 'd.setor_id = ?', params: [u.setorId ?? -1] };
    case 'SECRETARIA': return { sql: 'd.secretaria_id = ?', params: [u.secretariaId ?? -1] };
    default: return { sql: '1 = 1', params: [] };
  }
}

export function noEscopo(u: UsuarioSessao, d: { setor_id: number; secretaria_id: number; solicitante_id: number | null }): boolean {
  switch (ESCOPO_PAPEL[u.papel]) {
    case 'PROPRIO': return d.solicitante_id === u.id;
    case 'SETOR': return d.setor_id === u.setorId;
    case 'SECRETARIA': return d.secretaria_id === u.secretariaId;
    default: return true;
  }
}

export function carregar(banco: Banco, id: number): LinhaDemanda {
  const d = banco.get<LinhaDemanda>(`${SELECT_DEMANDA} WHERE d.id = ?`, id);
  if (!d) throw naoEncontrado('Solicitação não encontrada');
  return d;
}

export function paraResumo(d: LinhaDemanda): DemandaResumo {
  return {
    id: d.id, protocolo: d.protocolo, status: d.status, statusTexto: STATUS_TEXTO[d.status], prioridade: d.prioridade,
    servico: d.servico_nome, servicoId: d.servico_id, setor: d.setor_nome, setorId: d.setor_id,
    secretaria: d.secretaria_nome, secretariaId: d.secretaria_id, localidade: d.localidade_nome, localidadeId: d.localidade_id,
    descricao: d.descricao, canal: d.canal, criadaEm: d.criada_em, responsavel: d.responsavel_nome,
    responsavelId: d.responsavel_id, sla: slaDe(d), recorrente: d.recorrencia_de !== null, lat: d.lat, lng: d.lng,
  };
}

function anexosDe(banco: Banco, demandaId: number): Array<AnexoDto & { evento_id: number | null }> {
  return banco.all<AnexoDto & { evento_id: number | null }>(
    'SELECT id, nome, mime, tamanho, origem, evento_id FROM anexos WHERE demanda_id = ? ORDER BY id', demandaId,
  );
}

/**
 * Detalhe com visao dependente do perfil:
 * - cidadao: textos publicos, sem notas internas nem nomes de servidores
 * - equipe: tudo; dados pessoais completos apenas com a permissao especifica
 */
export function paraDetalhe(banco: Banco, d: LinhaDemanda, u: UsuarioSessao | null): DemandaDetalhe {
  const interno = u !== null && u.papel !== 'CIDADAO';
  const completo = interno && tem(u.papel, 'demanda.ver_dados_pessoais');
  const anexos = anexosDe(banco, d.id);
  const eventos = banco
    .all<{ id: number; tipo: string; de_status: Status | null; para_status: Status | null; texto_publico: string | null; nota_interna: string | null; autor_id: number | null; autor_nome: string; criado_em: string }>(
      'SELECT * FROM eventos WHERE demanda_id = ? ORDER BY id', d.id,
    )
    .filter((e) => interno || e.texto_publico !== null || e.de_status !== e.para_status)
    .map<EventoDto>((e) => ({
      id: e.id, tipo: e.tipo, deStatus: e.de_status, paraStatus: e.para_status, textoPublico: e.texto_publico,
      ...(interno ? { notaInterna: e.nota_interna } : {}),
      autor: interno ? e.autor_nome : e.autor_id === d.solicitante_id && e.tipo === 'CIDADAO' ? 'Você' : e.tipo === 'CIDADAO' ? 'Cidadão' : `Equipe – ${d.setor_nome}`,
      criadoEm: e.criado_em,
      anexos: anexos.filter((a) => a.evento_id === e.id && (interno || a.origem !== 'INTERNO')),
    }));
  const solicitante = d.anonima
    ? { nome: null, telefone: null, email: null, anonima: true }
    : completo || !interno
      ? { nome: d.solicitante_nome, telefone: d.solicitante_telefone, email: d.solicitante_email, anonima: false }
      : { nome: mascararNome(d.solicitante_nome), telefone: mascararTelefone(d.solicitante_telefone), email: mascararEmail(d.solicitante_email), anonima: false };
  return {
    ...paraResumo(d),
    responsavel: interno ? d.responsavel_nome : null,
    endereco: d.endereco, referencia: d.referencia, solicitante,
    resultado: d.resultado, agendadaPara: d.agendada_para, ciclo: d.ciclo, versao: d.versao,
    avaliacao: d.avaliacao_nota ? { nota: d.avaliacao_nota, comentario: d.avaliacao_comentario } : null,
    eventos,
    anexos: anexos.filter((a) => interno || a.origem !== 'INTERNO').map(({ evento_id: _e, ...a }) => a),
    comandos: interno ? comandosPermitidos(d.status).filter((c) => podeExecutar(u, d, c)) : [],
    dadosPessoaisOcultos: interno && !completo,
  };
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

export interface NovaDemanda {
  servicoId: number;
  descricao: string;
  localidadeId: number | null;
  lat: number | null;
  lng: number | null;
  endereco: string | null;
  referencia: string | null;
  canal: Canal;
  anonima: boolean;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  prioridade?: Prioridade | undefined;
  chaveIdempotencia?: string | undefined;
}

export function validarNova(n: NovaDemanda): void {
  if (!CANAIS.includes(n.canal)) throw invalido('Canal inválido');
  if (n.descricao.trim().length < 10) throw invalido('Descreva o problema com pelo menos 10 caracteres');
  if (n.descricao.length > 4000) throw invalido('Descrição muito longa (máximo 4000 caracteres)');
  if (n.lat !== null && (n.lat < -90 || n.lat > 90 || n.lng === null || n.lng < -180 || n.lng > 180)) throw invalido('Coordenadas inválidas');
  if (n.localidadeId === null && n.lat === null) throw invalido('Informe a localidade (sede, distrito ou comunidade) ou marque no mapa');
  if (n.prioridade && !PRIORIDADES.includes(n.prioridade)) throw invalido('Prioridade inválida');
}

export function abrirDemanda(
  banco: Banco,
  n: NovaDemanda,
  ator: Ator,
  opcoes: { solicitanteId: number | null; registradaPor: number | null },
): { id: number; protocolo: string; codigo: string; repetida: boolean } {
  validarNova(n);
  if (n.chaveIdempotencia) {
    const anterior = banco.get<{ resposta: string }>('SELECT resposta FROM idempotencia WHERE chave = ?', n.chaveIdempotencia);
    if (anterior) return { ...(JSON.parse(anterior.resposta) as { id: number; protocolo: string; codigo: string }), repetida: true };
  }
  const servico = banco.get<{ id: number; setor_id: number; secretaria_id: number; prazo_dias_uteis: number; prioridade_padrao: Prioridade; ativo: number }>(
    'SELECT sv.*, st.secretaria_id FROM servicos sv JOIN setores st ON st.id = sv.setor_id WHERE sv.id = ?', n.servicoId,
  );
  if (!servico || !servico.ativo) throw invalido('Serviço inválido ou indisponível');
  if (n.localidadeId !== null && !banco.get('SELECT id FROM localidades WHERE id = ?', n.localidadeId)) throw invalido('Localidade inválida');

  return banco.tx(() => {
    const agora = new Date();
    const protocolo = proximoProtocolo(banco, agora.getFullYear());
    const codigo = gerarCodigo();
    const prazo = somarDiasUteis(agora, servico.prazo_dias_uteis, feriados(banco));
    const { id } = banco.run(
      `INSERT INTO demandas (protocolo, codigo_hash, servico_id, setor_id, secretaria_id, status, prioridade, descricao,
        endereco, referencia, localidade_id, lat, lng, canal, solicitante_id, solicitante_nome, solicitante_telefone,
        solicitante_email, anonima, registrada_por, criada_em, prazo_em, chave_idempotencia)
       VALUES (?,?,?,?,?,'RECEBIDA',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      protocolo, sha256(codigo), servico.id, servico.setor_id, servico.secretaria_id, n.prioridade ?? servico.prioridade_padrao,
      n.descricao.trim(), n.endereco, n.referencia, n.localidadeId, n.lat, n.lng, n.canal, opcoes.solicitanteId,
      n.anonima ? null : n.nome, n.anonima ? null : n.telefone, n.anonima ? null : n.email, n.anonima,
      opcoes.registradaPor, agora.toISOString(), prazo.toISOString(), n.chaveIdempotencia ?? null,
    );
    banco.run(
      `INSERT INTO eventos (demanda_id, tipo, de_status, para_status, texto_publico, autor_id, autor_nome, criado_em)
       VALUES (?, 'ABERTURA', NULL, 'RECEBIDA', ?, ?, ?, ?)`,
      id, `Solicitação registrada pelo canal: ${n.canal.toLowerCase()}. Protocolo ${protocolo}.`, ator.id, ator.nome, agora.toISOString(),
    );
    const resposta = { id, protocolo, codigo };
    if (n.chaveIdempotencia)
      banco.run('INSERT INTO idempotencia (chave, resposta, criado_em) VALUES (?,?,?)', n.chaveIdempotencia, JSON.stringify(resposta), agora.toISOString());
    auditar(banco, ator, 'DEMANDA_ABERTA', 'demanda', id, { protocolo, canal: n.canal, servicoId: servico.id });
    notificar(banco, id, protocolo, 'RECEBIDA', n);
    return { ...resposta, repetida: false };
  });
}

function notificar(banco: Banco, demandaId: number, protocolo: string, status: Status, contato: { telefone: string | null; email: string | null; anonima?: boolean }) {
  const msg = `Prefeitura de Sertânia: sua solicitação ${protocolo} está "${STATUS_TEXTO[status]}". Acompanhe com o protocolo e o código de acesso.`;
  if (contato.telefone) banco.run('INSERT INTO notificacoes (demanda_id, canal, destino, mensagem, criado_em) VALUES (?,?,?,?,?)', demandaId, 'SMS/WHATSAPP', mascararTelefone(contato.telefone), msg, agoraIso());
  if (contato.email) banco.run('INSERT INTO notificacoes (demanda_id, canal, destino, mensagem, criado_em) VALUES (?,?,?,?,?)', demandaId, 'EMAIL', mascararEmail(contato.email), msg, agoraIso());
}

// ---------------------------------------------------------------------------
// Comandos de fluxo
// ---------------------------------------------------------------------------

export function podeExecutar(u: UsuarioSessao | null, d: LinhaDemanda, c: Comando): boolean {
  if (!u || !noEscopo(u, d)) return false;
  const triagem = tem(u.papel, 'demanda.triagem');
  const executar = tem(u.papel, 'demanda.executar');
  switch (c) {
    case 'ENCAMINHAR': case 'REABRIR': return triagem;
    case 'SOLICITAR_INFO': case 'CANCELAR': return triagem || executar;
    default: return executar;
  }
}

export interface EntradaComando {
  versao: number;
  textoPublico?: string | undefined;
  notaInterna?: string | undefined;
  servicoId?: number | undefined;
  resultado?: Resultado | undefined;
  agendadaPara?: string | undefined;
  prioridade?: Prioridade | undefined;
}

export function executarComando(banco: Banco, id: number, comando: Comando, e: EntradaComando, u: UsuarioSessao, ip?: string): LinhaDemanda {
  const ator: Ator = { id: u.id, nome: u.nome, ip };
  return banco.tx(() => {
    const d = carregar(banco, id);
    if (!podeExecutar(u, d, comando)) {
      auditar(banco, ator, 'ACESSO_NEGADO', 'demanda', id, { comando });
      throw proibido();
    }
    if (d.versao !== e.versao) throw conflito('Esta solicitação foi alterada por outra pessoa. Recarregue para ver a versão atual.');
    if (!podeTransicionar(d.status, comando)) throw conflito(`Não é possível "${REGRAS[comando].rotulo}" no estado atual`);
    const regra = REGRAS[comando];
    const texto = e.textoPublico?.trim() || null;
    if (regra.exigeTexto && !texto) throw invalido('Escreva uma mensagem para o cidadão explicando a ação');
    if (regra.exigeResultado && (!e.resultado || !RESULTADOS.includes(e.resultado))) throw invalido('Informe o resultado da conclusão');

    const agora = new Date();
    const agoraS = agora.toISOString();
    const sets: string[] = ['status = ?', 'versao = versao + 1'];
    const params: Array<string | number | null> = [regra.para];
    let paraSetor = d.setor_id;

    if (comando === 'ENCAMINHAR') {
      if (!e.servicoId) throw invalido('Escolha o serviço/setor de destino');
      const sv = banco.get<{ id: number; setor_id: number; secretaria_id: number }>(
        'SELECT sv.id, sv.setor_id, st.secretaria_id FROM servicos sv JOIN setores st ON st.id = sv.setor_id WHERE sv.id = ? AND sv.ativo = 1', e.servicoId,
      );
      if (!sv) throw invalido('Serviço de destino inválido');
      paraSetor = sv.setor_id;
      sets.push('servico_id = ?', 'setor_id = ?', 'secretaria_id = ?', 'encaminhada_em = COALESCE(encaminhada_em, ?)');
      params.push(sv.id, sv.setor_id, sv.secretaria_id, agoraS);
      if (sv.setor_id !== d.setor_id) { sets.push('responsavel_id = NULL'); }
    }
    if (e.prioridade && PRIORIDADES.includes(e.prioridade)) { sets.push('prioridade = ?'); params.push(e.prioridade); }
    if (comando === 'SOLICITAR_INFO') { sets.push('status_anterior = ?', 'pausada_desde = ?'); params.push(d.status, agoraS); }
    if (comando === 'AGENDAR') {
      if (!e.agendadaPara || Number.isNaN(Date.parse(e.agendadaPara))) throw invalido('Informe a data do agendamento');
      if (Date.parse(e.agendadaPara) < agora.getTime() - 86400000) throw invalido('A data do agendamento não pode estar no passado');
      sets.push('agendada_para = ?'); params.push(new Date(e.agendadaPara).toISOString());
    }
    if (comando === 'CONCLUIR' || comando === 'CANCELAR') {
      sets.push('concluida_em = ?', 'resultado = ?'); params.push(agoraS, comando === 'CONCLUIR' ? e.resultado! : null);
      if (d.pausada_desde) { sets.push('pausada_desde = NULL'); }
    }
    if (comando === 'REABRIR') {
      const sv = banco.get<{ prazo_dias_uteis: number }>('SELECT prazo_dias_uteis FROM servicos WHERE id = ?', d.servico_id)!;
      sets.push('concluida_em = NULL', 'resultado = NULL', 'ciclo = ciclo + 1', 'reaberturas = reaberturas + 1', 'prazo_em = ?', 'avaliacao_nota = NULL', 'avaliacao_comentario = NULL');
      params.push(somarDiasUteis(agora, sv.prazo_dias_uteis, feriados(banco)).toISOString());
    }
    sets.push('primeira_resposta_em = COALESCE(primeira_resposta_em, ?)'); params.push(agoraS);

    const r = banco.run(`UPDATE demandas SET ${sets.join(', ')} WHERE id = ? AND versao = ?`, ...params, id, e.versao);
    if (r.alteradas !== 1) throw conflito('Esta solicitação foi alterada por outra pessoa. Recarregue.');

    const setorNome = banco.get<{ nome: string }>('SELECT nome FROM setores WHERE id = ?', paraSetor)!.nome;
    const textoFinal = texto ?? (comando === 'ENCAMINHAR' ? `Solicitação encaminhada para ${setorNome}.` : comando === 'INICIAR_EXECUCAO' ? 'A equipe iniciou o atendimento.' : null);
    banco.run(
      `INSERT INTO eventos (demanda_id, tipo, de_status, para_status, texto_publico, nota_interna, autor_id, autor_nome, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, comando, d.status, regra.para,
      comando === 'AGENDAR' ? `${textoFinal ? `${textoFinal} ` : ''}Data prevista: ${new Date(e.agendadaPara!).toLocaleDateString('pt-BR', { timeZone: 'America/Recife' })}.` : textoFinal,
      e.notaInterna?.trim() || null, u.id, u.nome, agoraS,
    );
    auditar(banco, ator, `COMANDO_${comando}`, 'demanda', id, { de: d.status, para: regra.para, servicoId: e.servicoId, resultado: e.resultado });
    if (d.status !== regra.para || comando === 'ENCAMINHAR') notificar(banco, id, d.protocolo, regra.para, { telefone: d.solicitante_telefone, email: d.solicitante_email });
    return carregar(banco, id);
  });
}

/** Resposta do cidadao a um pedido de informacao: retoma o estado anterior e o prazo. */
export function responderCidadao(banco: Banco, d: LinhaDemanda, texto: string, ator: Ator): number {
  if (d.status !== 'AGUARDANDO_CIDADAO') throw conflito('Esta solicitação não está aguardando resposta');
  if (texto.trim().length < 2) throw invalido('Escreva sua resposta');
  return banco.tx(() => {
    const agora = new Date();
    const volta = d.status_anterior ?? 'ENCAMINHADA';
    const pausa = d.pausada_desde ? agora.getTime() - new Date(d.pausada_desde).getTime() : 0;
    const prazo = d.prazo_em ? new Date(new Date(d.prazo_em).getTime() + pausa).toISOString() : null;
    banco.run(
      'UPDATE demandas SET status = ?, status_anterior = NULL, pausada_desde = NULL, prazo_em = ?, versao = versao + 1 WHERE id = ?',
      volta, prazo, d.id,
    );
    const { id } = banco.run(
      `INSERT INTO eventos (demanda_id, tipo, de_status, para_status, texto_publico, autor_id, autor_nome, criado_em)
       VALUES (?, 'CIDADAO', 'AGUARDANDO_CIDADAO', ?, ?, ?, ?, ?)`,
      d.id, volta, texto.trim().slice(0, 4000), ator.id, ator.nome, agora.toISOString(),
    );
    auditar(banco, ator, 'CIDADAO_RESPONDEU', 'demanda', d.id, {});
    return id;
  });
}

export function anotar(banco: Banco, d: LinhaDemanda, u: UsuarioSessao, textoPublico: string | null, notaInterna: string | null): number {
  if (!textoPublico && !notaInterna) throw invalido('Escreva uma anotação ou anexe uma evidência');
  const { id } = banco.run(
    `INSERT INTO eventos (demanda_id, tipo, de_status, para_status, texto_publico, nota_interna, autor_id, autor_nome, criado_em)
     VALUES (?, 'REGISTRO_EXECUCAO', ?, ?, ?, ?, ?, ?, ?)`,
    d.id, d.status, d.status, textoPublico, notaInterna, u.id, u.nome, agoraIso(),
  );
  banco.run('UPDATE demandas SET primeira_resposta_em = COALESCE(primeira_resposta_em, ?) WHERE id = ?', agoraIso(), d.id);
  return id;
}
