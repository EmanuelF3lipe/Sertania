import type { Banco } from './db.js';
import { STATUS, type UsuarioSessao } from '../shared/dominio.js';
import { filtroEscopo } from './demandas.js';
import type { IndicadoresBasicos } from './ia/servico.js';

export interface Filtros {
  de?: string | undefined;
  ate?: string | undefined;
  secretariaId?: number | undefined;
  setorId?: number | undefined;
  servicoId?: number | undefined;
  localidadeId?: number | undefined;
  status?: string | undefined;
  canal?: string | undefined;
  prioridade?: string | undefined;
  busca?: string | undefined;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? undefined : n;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

export function lerFiltros(q: Record<string, unknown>): Filtros {
  return {
    de: str(q['de']), ate: str(q['ate']), secretariaId: num(q['secretariaId']), setorId: num(q['setorId']),
    servicoId: num(q['servicoId']), localidadeId: num(q['localidadeId']), status: str(q['status']), canal: str(q['canal']),
    prioridade: str(q['prioridade']), busca: str(q['busca']),
  };
}

/** Monta WHERE combinando escopo do perfil e filtros; o escopo nunca e relaxado por filtro. */
export function whereFiltros(u: UsuarioSessao | null, f: Filtros): { sql: string; params: Array<string | number | null> } {
  const partes: string[] = [];
  const params: Array<string | number | null> = [];
  if (u) {
    const e = filtroEscopo(u);
    partes.push(e.sql);
    params.push(...e.params);
  }
  if (f.de) { partes.push('d.criada_em >= ?'); params.push(new Date(`${f.de}T00:00:00-03:00`).toISOString()); }
  if (f.ate) { partes.push('d.criada_em <= ?'); params.push(new Date(`${f.ate}T23:59:59-03:00`).toISOString()); }
  if (f.secretariaId) { partes.push('d.secretaria_id = ?'); params.push(f.secretariaId); }
  if (f.setorId) { partes.push('d.setor_id = ?'); params.push(f.setorId); }
  if (f.servicoId) { partes.push('d.servico_id = ?'); params.push(f.servicoId); }
  if (f.localidadeId) { partes.push('d.localidade_id = ?'); params.push(f.localidadeId); }
  if (f.canal) { partes.push('d.canal = ?'); params.push(f.canal); }
  if (f.prioridade) { partes.push('d.prioridade = ?'); params.push(f.prioridade); }
  if (f.status === 'ABERTAS') partes.push("d.status NOT IN ('CONCLUIDA','CANCELADA')");
  else if (f.status && (STATUS as readonly string[]).includes(f.status)) { partes.push('d.status = ?'); params.push(f.status); }
  if (f.busca) { partes.push('(d.protocolo LIKE ? OR d.descricao LIKE ? OR d.endereco LIKE ?)'); const b = `%${f.busca}%`; params.push(b, b, b); }
  return { sql: partes.length ? partes.join(' AND ') : '1 = 1', params };
}

const horas = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
const media = (v: number[]) => (v.length ? Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10 : null);
const mediana = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) * 10) / 10;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export function calcularIndicadores(banco: Banco, u: UsuarioSessao | null, f: Filtros) {
  const w = whereFiltros(u, f);
  const linhas = banco.all<{
    id: number; status: string; criada_em: string; encaminhada_em: string | null; primeira_resposta_em: string | null;
    concluida_em: string | null; prazo_em: string | null; resultado: string | null; recorrencia_de: number | null;
    avaliacao_nota: number | null; canal: string; prioridade: string; reaberturas: number; pausada_desde: string | null;
    servico: string; secretaria: string; secretaria_id: number; localidade: string | null; localidade_tipo: string | null; eventos: number;
  }>(
    `SELECT d.id, d.status, d.criada_em, d.encaminhada_em, d.primeira_resposta_em, d.concluida_em, d.prazo_em, d.resultado,
            d.recorrencia_de, d.avaliacao_nota, d.canal, d.prioridade, d.reaberturas, d.pausada_desde,
            sv.nome AS servico, sc.nome AS secretaria, d.secretaria_id, l.nome AS localidade, l.tipo AS localidade_tipo,
            (SELECT COUNT(*) FROM eventos e WHERE e.demanda_id = d.id) AS eventos
     FROM demandas d JOIN servicos sv ON sv.id = d.servico_id JOIN secretarias sc ON sc.id = d.secretaria_id
     LEFT JOIN localidades l ON l.id = d.localidade_id WHERE ${w.sql}`,
    ...w.params,
  );
  const agora = new Date().toISOString();
  const total = linhas.length;
  const concluidas = linhas.filter((l) => l.status === 'CONCLUIDA');
  const encerradas = linhas.filter((l) => l.status === 'CONCLUIDA' || l.status === 'CANCELADA');
  const abertas = total - encerradas.length;
  const tEnc = linhas.filter((l) => l.encaminhada_em).map((l) => horas(l.criada_em, l.encaminhada_em!));
  const tResp = linhas.filter((l) => l.primeira_resposta_em).map((l) => horas(l.criada_em, l.primeira_resposta_em!));
  const tAt = concluidas.filter((l) => l.concluida_em).map((l) => horas(l.criada_em, l.concluida_em!));
  const noPrazo = concluidas.filter((l) => l.prazo_em && l.concluida_em && l.concluida_em <= l.prazo_em).length;
  const vencidasAbertas = linhas.filter((l) => !['CONCLUIDA', 'CANCELADA'].includes(l.status) && !l.pausada_desde && l.prazo_em && l.prazo_em < agora).length;
  const notas = linhas.filter((l) => l.avaliacao_nota).map((l) => l.avaliacao_nota!);

  const agrupar = (chave: (l: (typeof linhas)[number]) => string | null) => {
    const m = new Map<string, { total: number; abertas: number; concluidas: number; vencidas: number }>();
    for (const l of linhas) {
      const k = chave(l) ?? 'Não informado';
      const g = m.get(k) ?? { total: 0, abertas: 0, concluidas: 0, vencidas: 0 };
      g.total++;
      if (l.status === 'CONCLUIDA') g.concluidas++;
      if (!['CONCLUIDA', 'CANCELADA'].includes(l.status)) {
        g.abertas++;
        if (!l.pausada_desde && l.prazo_em && l.prazo_em < agora) g.vencidas++;
      }
      m.set(k, g);
    }
    return [...m.entries()].map(([nome, g]) => ({ nome, ...g })).sort((a, b) => b.total - a.total);
  };

  const porDia = new Map<string, { registradas: number; concluidas: number }>();
  for (const l of linhas) {
    const dia = new Date(l.criada_em).toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
    const g = porDia.get(dia) ?? { registradas: 0, concluidas: 0 };
    g.registradas++;
    porDia.set(dia, g);
    if (l.concluida_em && l.status === 'CONCLUIDA') {
      const dc = new Date(l.concluida_em).toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
      const gc = porDia.get(dc) ?? { registradas: 0, concluidas: 0 };
      gc.concluidas++;
      porDia.set(dc, gc);
    }
  }

  const desde30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const uso = banco.all<{ painel: string; acessos: number; usuarios: number }>(
    'SELECT painel, COUNT(*) AS acessos, COUNT(DISTINCT usuario_id) AS usuarios FROM uso_paineis WHERE em >= ? GROUP BY painel ORDER BY acessos DESC', desde30,
  );
  const ia = banco.get<{ total: number; aceitas: number; ajustadas: number; rejeitadas: number }>(
    `SELECT COUNT(*) AS total, SUM(status='ACEITA') AS aceitas, SUM(status='AJUSTADA') AS ajustadas, SUM(status='REJEITADA') AS rejeitadas
     FROM sugestoes_ia WHERE status IN ('ACEITA','AJUSTADA','REJEITADA')`,
  )!;

  return {
    geradoEm: agora,
    filtros: f,
    total, abertas, encerradas: encerradas.length, concluidas: concluidas.length, vencidasAbertas,
    rastreabilidadePct: pct(linhas.filter((l) => l.eventos > 0).length, total),
    tempoEncaminhamentoHoras: { media: media(tEnc), mediana: mediana(tEnc), amostras: tEnc.length },
    tempoPrimeiraRespostaHoras: { media: media(tResp), mediana: mediana(tResp) },
    tempoAtendimentoHoras: { media: media(tAt), mediana: mediana(tAt), amostras: tAt.length },
    noPrazoPct: pct(noPrazo, concluidas.length),
    resolvidasPct: pct(concluidas.filter((l) => l.resultado === 'RESOLVIDA').length, concluidas.length),
    recorrenciaPct: pct(linhas.filter((l) => l.recorrencia_de !== null).length, total) ?? 0,
    reaberturaPct: pct(linhas.filter((l) => l.reaberturas > 0).length, total) ?? 0,
    satisfacao: {
      media: media(notas), respostas: notas.length, taxaResposta: pct(notas.length, concluidas.length),
      distribuicao: [1, 2, 3, 4, 5].map((n) => ({ nota: n, total: notas.filter((x) => x === n).length })),
    },
    porStatus: agrupar((l) => l.status),
    porSecretaria: agrupar((l) => l.secretaria),
    porServico: agrupar((l) => l.servico),
    porLocalidade: agrupar((l) => l.localidade),
    porTipoLocalidade: agrupar((l) => l.localidade_tipo),
    porCanal: agrupar((l) => l.canal),
    porPrioridade: agrupar((l) => l.prioridade),
    serie: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, g]) => ({ dia, ...g })),
    usoPaineis: uso,
    ia: { decididas: ia.total, aceitas: ia.aceitas ?? 0, ajustadas: ia.ajustadas ?? 0, rejeitadas: ia.rejeitadas ?? 0, aceitacaoPct: pct((ia.aceitas ?? 0), ia.total) },
  };
}
export type Indicadores = ReturnType<typeof calcularIndicadores>;

export function paraBasicos(i: Indicadores): IndicadoresBasicos {
  return {
    total: i.total, concluidas: i.concluidas, abertas: i.abertas, noPrazoPct: i.noPrazoPct,
    tempoMedioHoras: i.tempoAtendimentoHoras.media, tempoEncaminhamentoHoras: i.tempoEncaminhamentoHoras.media,
    recorrenciaPct: i.recorrenciaPct, satisfacaoMedia: i.satisfacao.media,
    porLocalidade: i.porLocalidade.map((l) => ({ nome: l.nome, total: l.total })),
    porServico: i.porServico.map((s) => ({ nome: s.nome, total: s.total })),
    vencidasAbertas: i.vencidasAbertas,
  };
}

/** Dados abertos: apenas agregados, com supressao de grupos pequenos (risco de reidentificacao). */
export function dadosAbertos(banco: Banco, limiar: number) {
  const linhas = banco.all<{ mes: string; secretaria: string; servico: string; localidade: string | null; status: string; total: number }>(
    `SELECT substr(d.criada_em, 1, 7) AS mes, sc.nome AS secretaria, sv.nome AS servico, l.nome AS localidade,
            CASE WHEN d.status IN ('CONCLUIDA','CANCELADA') THEN 'ENCERRADA' ELSE 'EM_ANDAMENTO' END AS status, COUNT(*) AS total
     FROM demandas d JOIN servicos sv ON sv.id = d.servico_id JOIN secretarias sc ON sc.id = d.secretaria_id
     LEFT JOIN localidades l ON l.id = d.localidade_id GROUP BY 1,2,3,4,5 ORDER BY 1 DESC, 6 DESC`,
  );
  return {
    licenca: 'CC-BY 4.0',
    descricao: 'Solicitações agregadas por mês, secretaria, serviço, localidade e situação. Grupos com menos casos que o limiar são suprimidos.',
    limiarSupressao: limiar,
    registros: linhas.map((l) => (l.total < limiar ? { ...l, total: null, suprimido: true } : { ...l, suprimido: false })),
  };
}
