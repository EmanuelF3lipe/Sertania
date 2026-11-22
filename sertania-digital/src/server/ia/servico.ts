import type { Banco } from '../db.js';
import { agoraIso } from '../db.js';
import type { Config } from '../config.js';
import { distanciaMetros, type AnaliseIa, type Prioridade } from '../../shared/dominio.js';
import { Classificador, jaccard, resumir, sugerirPrioridade } from './local.js';
import { analisarComClaude, narrativaComClaude } from './claude.js';
import { pseudonimizar } from '../privacidade.js';
import { carregar, slaDe, type LinhaDemanda } from '../demandas.js';

// ---------------------------------------------------------------------------
// Classificador (re-treinado sob demanda, com cache curto)
// ---------------------------------------------------------------------------

let cache: { quando: number; clf: Classificador } | null = null;

export function invalidarClassificador(): void {
  cache = null;
}

export function classificador(banco: Banco): Classificador {
  if (cache && Date.now() - cache.quando < 60_000) return cache.clf;
  const servicos = banco.all<{ id: number; nome: string; descricao: string; palavras_chave: string }>('SELECT * FROM servicos WHERE ativo = 1');
  // Exemplos: demandas cuja classificacao foi confirmada por uma pessoa (ja encaminhadas).
  const exemplos = banco.all<{ servico_id: number; descricao: string }>(
    "SELECT servico_id, descricao FROM demandas WHERE encaminhada_em IS NOT NULL ORDER BY id DESC LIMIT 5000",
  );
  const clf = new Classificador(
    servicos.map((s) => ({
      id: s.id, nome: s.nome, descricao: s.descricao, palavrasChave: s.palavras_chave,
      exemplos: exemplos.filter((e) => e.servico_id === s.id).map((e) => e.descricao),
    })),
  );
  cache = { quando: Date.now(), clf };
  return clf;
}

interface ServicoCat { id: number; nome: string; secretaria: string; palavras_chave: string; prioridade_padrao: Prioridade }
function catalogo(banco: Banco): ServicoCat[] {
  return banco.all<ServicoCat>(
    `SELECT sv.id, sv.nome, sc.nome AS secretaria, sv.palavras_chave, sv.prioridade_padrao
     FROM servicos sv JOIN setores st ON st.id = sv.setor_id JOIN secretarias sc ON sc.id = st.secretaria_id WHERE sv.ativo = 1`,
  );
}

/** Sugestao instantanea para o cidadao enquanto escreve (sempre local, nada e gravado). */
export function sugerirServico(banco: Banco, texto: string) {
  const cat = catalogo(banco);
  return classificador(banco)
    .classificar(texto)
    .filter((c) => c.confianca >= 0.15)
    .map((c) => {
      const s = cat.find((x) => x.id === c.servicoId)!;
      return { servicoId: s.id, servico: s.nome, secretaria: s.secretaria, confianca: c.confianca };
    });
}

// ---------------------------------------------------------------------------
// Recorrencia
// ---------------------------------------------------------------------------

const JANELA_RECORRENCIA_DIAS = 90;
const RAIO_METROS = 150;

export function similares(banco: Banco, d: LinhaDemanda): Array<{ id: number; protocolo: string; status: string; criada_em: string; distancia: number | null; semelhanca: number }> {
  const desde = new Date(new Date(d.criada_em).getTime() - JANELA_RECORRENCIA_DIAS * 86400000).toISOString();
  const candidatos = banco.all<LinhaDemanda>(
    `SELECT * FROM demandas WHERE servico_id = ? AND id <> ? AND criada_em >= ? AND criada_em <= ? ORDER BY criada_em`,
    d.servico_id, d.id, desde, new Date(new Date(d.criada_em).getTime() + JANELA_RECORRENCIA_DIAS * 86400000).toISOString(),
  );
  return candidatos
    .map((c) => {
      const distancia = d.lat !== null && d.lng !== null && c.lat !== null && c.lng !== null ? Math.round(distanciaMetros(d.lat, d.lng, c.lat, c.lng)) : null;
      return { id: c.id, protocolo: c.protocolo, status: c.status, criada_em: c.criada_em, distancia, semelhanca: Math.round(jaccard(d.descricao, c.descricao) * 100) / 100, localidade: c.localidade_id };
    })
    .filter((c) => (c.distancia !== null ? c.distancia <= RAIO_METROS : c.localidade === d.localidade_id && c.semelhanca >= 0.25))
    .map(({ localidade: _l, ...c }) => c);
}

/** Marca a demanda como recorrente apontando para a ocorrencia mais antiga do grupo. */
export function marcarRecorrencia(banco: Banco, id: number): void {
  const d = carregar(banco, id);
  const anteriores = similares(banco, d).filter((s) => s.criada_em < d.criada_em);
  if (anteriores.length === 0) return;
  const raiz = banco.get<{ id: number; recorrencia_de: number | null }>('SELECT id, recorrencia_de FROM demandas WHERE id = ?', anteriores[0]!.id)!;
  banco.run('UPDATE demandas SET recorrencia_de = ? WHERE id = ?', raiz.recorrencia_de ?? raiz.id, id);
}

export function gruposRecorrentes(banco: Banco, filtroSql = '1=1', params: Array<number | null> = []) {
  const desde = new Date(Date.now() - JANELA_RECORRENCIA_DIAS * 86400000).toISOString();
  return banco.all<{ raiz: number; total: number; servico: string; localidade: string | null; secretaria: string; secretaria_id: number; localidade_id: number | null; ultimo: string; abertas: number; lat: number | null; lng: number | null }>(
    `SELECT COALESCE(d.recorrencia_de, d.id) AS raiz, COUNT(*) AS total, MAX(sv.nome) AS servico, MAX(l.nome) AS localidade,
            MAX(sc.nome) AS secretaria, MAX(d.secretaria_id) AS secretaria_id, MAX(d.localidade_id) AS localidade_id,
            MAX(d.criada_em) AS ultimo, AVG(d.lat) AS lat, AVG(d.lng) AS lng,
            SUM(CASE WHEN d.status NOT IN ('CONCLUIDA','CANCELADA') THEN 1 ELSE 0 END) AS abertas
     FROM demandas d JOIN servicos sv ON sv.id = d.servico_id JOIN secretarias sc ON sc.id = d.secretaria_id
     LEFT JOIN localidades l ON l.id = d.localidade_id
     WHERE d.criada_em >= ? AND ${filtroSql}
     GROUP BY COALESCE(d.recorrencia_de, d.id) HAVING COUNT(*) >= 2 ORDER BY total DESC, ultimo DESC`,
    desde, ...params,
  );
}

// ---------------------------------------------------------------------------
// Analise de uma demanda (gera SUGESTAO pendente de decisao humana)
// ---------------------------------------------------------------------------

export async function analisarDemanda(banco: Banco, config: Config, id: number): Promise<AnaliseIa & { sugestaoId: number }> {
  const d = carregar(banco, id);
  const cat = catalogo(banco);
  const padrao = cat.find((s) => s.id === d.servico_id)?.prioridade_padrao ?? 'NORMAL';
  const qtdSimilares = similares(banco, d).length;
  let analise: AnaliseIa | null = null;

  if (config.iaProvedor === 'claude') {
    try {
      const texto = pseudonimizar(`${d.descricao}${d.referencia ? `\nReferência: ${d.referencia}` : ''}`, [d.solicitante_nome]);
      const r = await analisarComClaude(texto, cat.map((s) => ({ id: s.id, nome: s.nome, secretaria: s.secretaria, palavrasChave: s.palavras_chave })), padrao);
      const ids = [r.servicoId, ...r.alternativas.filter((a) => a !== r.servicoId)].slice(0, 3);
      analise = {
        classificacao: ids.flatMap((sid, i) => {
          const s = cat.find((x) => x.id === sid);
          return s ? [{ servicoId: s.id, servico: s.nome, secretaria: s.secretaria, confianca: i === 0 ? r.confianca : Math.max(0, (1 - r.confianca) / 2) }] : [];
        }),
        prioridade: r.prioridade,
        motivoPrioridade: r.motivoPrioridade,
        resumo: `${r.resumo}${qtdSimilares ? ` Há ${qtdSimilares} registro(s) semelhante(s) nos últimos 90 dias.` : ''}`,
        provedor: 'claude',
      };
    } catch (erro) {
      console.warn('[ia] Claude indisponível, usando IA local:', (erro as Error).message);
    }
  }
  if (!analise) {
    const cls = classificador(banco).classificar(`${d.descricao} ${d.referencia ?? ''}`);
    const p = sugerirPrioridade(d.descricao, padrao);
    analise = {
      classificacao: cls.map((c) => {
        const s = cat.find((x) => x.id === c.servicoId)!;
        return { servicoId: s.id, servico: s.nome, secretaria: s.secretaria, confianca: c.confianca };
      }),
      prioridade: p.prioridade,
      motivoPrioridade: p.motivo,
      resumo: resumir(d.descricao, d.servico_nome, d.localidade_nome, qtdSimilares),
      provedor: 'local',
    };
  }
  banco.run("UPDATE sugestoes_ia SET status = 'SUBSTITUIDA' WHERE demanda_id = ? AND status = 'PENDENTE'", id);
  const { id: sugestaoId } = banco.run(
    'INSERT INTO sugestoes_ia (demanda_id, conteudo, provedor, criado_em) VALUES (?,?,?,?)',
    id, JSON.stringify(analise), analise.provedor, agoraIso(),
  );
  return { ...analise, sugestaoId };
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

interface NovoAlerta { chave: string; tipo: string; severidade: 'BAIXA' | 'MEDIA' | 'ALTA'; titulo: string; descricao: string; secretaria_id: number | null; localidade_id: number | null; demanda_id: number | null }

export function recalcularAlertas(banco: Banco): { ativos: number } {
  const novos: NovoAlerta[] = [];
  const abertas = banco.all<LinhaDemanda>(
    `SELECT d.*, sv.nome AS servico_nome, l.nome AS localidade_nome FROM demandas d JOIN servicos sv ON sv.id = d.servico_id
     LEFT JOIN localidades l ON l.id = d.localidade_id WHERE d.status NOT IN ('CONCLUIDA','CANCELADA')`,
  );
  for (const d of abertas) {
    const sla = slaDe(d);
    if (sla.pausada || !sla.prazoEm) continue;
    if (sla.vencida)
      novos.push({ chave: `SLA_VENCIDO:${d.id}:${d.ciclo}`, tipo: 'SLA_VENCIDO', severidade: 'ALTA', titulo: `Prazo vencido: ${d.protocolo}`, descricao: `${d.servico_nome}${d.localidade_nome ? ` em ${d.localidade_nome}` : ''} está fora do prazo desde ${new Date(sla.prazoEm).toLocaleDateString('pt-BR')}.`, secretaria_id: d.secretaria_id, localidade_id: d.localidade_id, demanda_id: d.id });
    else if (sla.percentual >= 80)
      novos.push({ chave: `SLA_VENCENDO:${d.id}:${d.ciclo}`, tipo: 'SLA_VENCENDO', severidade: 'MEDIA', titulo: `Prazo perto de vencer: ${d.protocolo}`, descricao: `${sla.percentual}% do prazo consumido (${d.servico_nome}).`, secretaria_id: d.secretaria_id, localidade_id: d.localidade_id, demanda_id: d.id });
  }
  for (const g of gruposRecorrentes(banco)) {
    if (g.total < 3) continue;
    novos.push({ chave: `RECORRENCIA:${g.raiz}`, tipo: 'RECORRENCIA', severidade: g.total >= 5 ? 'ALTA' : 'MEDIA', titulo: `Problema recorrente: ${g.servico}${g.localidade ? ` – ${g.localidade}` : ''}`, descricao: `${g.total} registros semelhantes no mesmo local em 90 dias (${g.abertas} em aberto). Avalie uma ação estrutural em vez de atendimentos pontuais.`, secretaria_id: g.secretaria_id, localidade_id: g.localidade_id, demanda_id: g.raiz });
  }
  // Pico por localidade: ultimos 7 dias contra a media semanal das 4 semanas anteriores.
  const agora = Date.now();
  const d7 = new Date(agora - 7 * 86400000).toISOString();
  const d35 = new Date(agora - 35 * 86400000).toISOString();
  const picos = banco.all<{ localidade_id: number; localidade: string; secretaria_id: number; secretaria: string; recentes: number; anteriores: number }>(
    `SELECT d.localidade_id, l.nome AS localidade, d.secretaria_id, sc.nome AS secretaria,
            SUM(CASE WHEN d.criada_em >= ? THEN 1 ELSE 0 END) AS recentes,
            SUM(CASE WHEN d.criada_em < ? THEN 1 ELSE 0 END) AS anteriores
     FROM demandas d JOIN localidades l ON l.id = d.localidade_id JOIN secretarias sc ON sc.id = d.secretaria_id
     WHERE d.criada_em >= ? GROUP BY d.localidade_id, d.secretaria_id`,
    d7, d7, d35,
  );
  for (const p of picos) {
    const media = p.anteriores / 4;
    if (p.recentes >= 3 && p.recentes >= 2 * Math.max(media, 1))
      novos.push({ chave: `PICO:${p.localidade_id}:${p.secretaria_id}:${new Date().toISOString().slice(0, 10)}`, tipo: 'PICO_LOCALIDADE', severidade: 'MEDIA', titulo: `Aumento de demandas em ${p.localidade}`, descricao: `${p.recentes} solicitações para ${p.secretaria} nos últimos 7 dias, contra média de ${media.toFixed(1)} por semana no mês anterior.`, secretaria_id: p.secretaria_id, localidade_id: p.localidade_id, demanda_id: null });
  }

  const agoraS = agoraIso();
  banco.tx(() => {
    for (const a of novos)
      banco.run(
        `INSERT INTO alertas (chave, tipo, severidade, titulo, descricao, secretaria_id, localidade_id, demanda_id, criado_em, atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(chave) DO UPDATE SET descricao = excluded.descricao, severidade = excluded.severidade, atualizado_em = excluded.atualizado_em`,
        a.chave, a.tipo, a.severidade, a.titulo, a.descricao, a.secretaria_id, a.localidade_id, a.demanda_id, agoraS, agoraS,
      );
    // Condicao deixou de existir: encerra automaticamente (ex.: demanda concluida).
    const chaves = new Set(novos.map((n) => n.chave));
    for (const a of banco.all<{ id: number; chave: string }>("SELECT id, chave FROM alertas WHERE status IN ('ABERTO','RECONHECIDO')"))
      if (!chaves.has(a.chave)) banco.run("UPDATE alertas SET status = 'RESOLVIDO', tratado_em = ?, observacao = 'Condição encerrada automaticamente' WHERE id = ?", agoraS, a.id);
  });
  return { ativos: novos.length };
}

// ---------------------------------------------------------------------------
// Narrativa de relatorio
// ---------------------------------------------------------------------------

export interface IndicadoresBasicos {
  total: number; concluidas: number; abertas: number; noPrazoPct: number | null; tempoMedioHoras: number | null;
  tempoEncaminhamentoHoras: number | null; recorrenciaPct: number; satisfacaoMedia: number | null;
  porLocalidade: Array<{ nome: string; total: number }>; porServico: Array<{ nome: string; total: number }>;
  vencidasAbertas: number;
}

export function narrativaLocal(i: IndicadoresBasicos, periodo: string): string {
  const fmt = (v: number | null, suf = '') => (v === null ? 'sem dados suficientes' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${suf}`);
  const topLoc = i.porLocalidade.slice(0, 3).map((l) => `${l.nome} (${l.total})`).join(', ');
  const topSv = i.porServico.slice(0, 3).map((s) => `${s.nome} (${s.total})`).join(', ');
  const p: string[] = [];
  p.push(`No período ${periodo} foram registradas ${i.total} solicitações, das quais ${i.concluidas} foram encerradas e ${i.abertas} seguem em aberto.`);
  p.push(`O tempo médio entre o registro e o encaminhamento ao setor foi de ${fmt(i.tempoEncaminhamentoHoras, ' h')}, e o tempo médio de atendimento das concluídas foi de ${fmt(i.tempoMedioHoras, ' h')}. ${fmt(i.noPrazoPct, '%')} das concluídas ficaram dentro do prazo${i.vencidasAbertas ? `; há ${i.vencidasAbertas} solicitação(ões) em aberto com prazo vencido que merecem atenção` : ''}.`);
  if (topLoc) p.push(`As localidades com mais registros foram ${topLoc}. Os serviços mais demandados foram ${topSv}.`);
  p.push(`A taxa de recorrência (registros semelhantes no mesmo local em até 90 dias) foi de ${fmt(i.recorrenciaPct, '%')}${i.recorrenciaPct >= 15 ? ', o que sugere avaliar intervenções estruturais nos pontos mais repetidos' : ''}. A satisfação média informada pelos cidadãos foi ${fmt(i.satisfacaoMedia, ' de 5')}.`);
  p.push('Texto gerado automaticamente a partir dos indicadores; requer revisão do gestor responsável.');
  return p.join('\n\n');
}

export async function gerarNarrativa(config: Config, i: IndicadoresBasicos, periodo: string): Promise<{ texto: string; provedor: string }> {
  if (config.iaProvedor === 'claude') {
    try {
      return { texto: await narrativaComClaude(i, periodo), provedor: 'claude' };
    } catch (erro) {
      console.warn('[ia] narrativa via Claude falhou, usando local:', (erro as Error).message);
    }
  }
  return { texto: narrativaLocal(i, periodo), provedor: 'local' };
}
