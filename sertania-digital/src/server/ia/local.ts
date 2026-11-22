/**
 * IA local (sem envio de dados para fora do servidor).
 *
 * - Classificacao: Naive Bayes multinomial treinado com o catalogo (nome,
 *   descricao, palavras-chave) e com as demandas ja triadas por servidores.
 *   Aprende com o uso: cada triagem humana vira exemplo de treino.
 * - Prioridade: regras explicitas e auditaveis por palavras de risco.
 * - Resumo: extrativo, a partir da primeira frase e do contexto.
 *
 * Tudo aqui e SUGESTAO: a decisao continua com uma pessoa.
 */
import { normalizar, type Prioridade } from '../../shared/dominio.js';

const PARADAS = new Set(
  'a o e de da do das dos em no na nos nas um uma uns umas que para por com sem ao aos se mais muito ja nao sim ha tem esta estao foi sao ser eu meu minha nosso nossa rua casa perto frente lado favor pois esta isso este essa esse aqui ali la tambem todo toda dia dias faz desde ate como quando onde porque'.split(
    ' ',
  ),
);

export function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((t) => t.length >= 3 && !PARADAS.has(t))
    .map((t) => t.slice(0, 6));
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface ServicoTreino {
  id: number;
  nome: string;
  descricao: string;
  palavrasChave: string;
  exemplos: string[];
}

export class Classificador {
  private contagens = new Map<number, Map<string, number>>();
  private totais = new Map<number, number>();
  private docs = new Map<number, number>();
  private vocab = new Set<string>();

  constructor(servicos: ServicoTreino[]) {
    for (const s of servicos) {
      const mapa = new Map<string, number>();
      const add = (texto: string, peso: number) => {
        for (const t of tokens(texto)) {
          mapa.set(t, (mapa.get(t) ?? 0) + peso);
          this.vocab.add(t);
        }
      };
      add(s.nome, 3);
      add(s.palavrasChave.replace(/[,;]/g, ' '), 3);
      add(s.descricao, 1);
      for (const e of s.exemplos) add(e, 1);
      this.contagens.set(s.id, mapa);
      this.totais.set(s.id, [...mapa.values()].reduce((x, y) => x + y, 0));
      this.docs.set(s.id, 1 + s.exemplos.length);
    }
  }

  classificar(texto: string, top = 3): Array<{ servicoId: number; confianca: number }> {
    const ts = tokens(texto);
    if (ts.length === 0 || this.contagens.size === 0) return [];
    const V = this.vocab.size || 1;
    const totalDocs = [...this.docs.values()].reduce((a, b) => a + b, 0);
    const pontuacoes: Array<{ servicoId: number; log: number; acertos: number }> = [];
    for (const [id, mapa] of this.contagens) {
      const total = this.totais.get(id) ?? 0;
      let log = Math.log((this.docs.get(id) ?? 1) / totalDocs) * 0.3; // prior suavizado
      let acertos = 0;
      for (const t of ts) {
        const c = mapa.get(t) ?? 0;
        if (c > 0) acertos++;
        log += Math.log((c + 0.5) / (total + 0.5 * V));
      }
      pontuacoes.push({ servicoId: id, log, acertos });
    }
    const max = Math.max(...pontuacoes.map((p) => p.log));
    const exps = pontuacoes.map((p) => ({ ...p, e: Math.exp(p.log - max) }));
    const soma = exps.reduce((a, b) => a + b.e, 0);
    return exps
      .map((p) => ({ servicoId: p.servicoId, confianca: p.acertos === 0 ? 0 : p.e / soma }))
      .filter((p) => p.confianca > 0)
      .sort((a, b) => b.confianca - a.confianca)
      .filter((p, i) => i === 0 || p.confianca >= 0.05)
      .slice(0, top)
      .map((p) => ({ ...p, confianca: Math.round(p.confianca * 100) / 100 }));
  }
}

const RISCO: Array<{ termos: string[]; prioridade: Prioridade; motivo: string }> = [
  {
    termos: ['fio partido', 'fio caido', 'choque', 'incendio', 'fogo', 'desabamento', 'desabou', 'risco de vida', 'acidente', 'ferido', 'desmaio', 'emergencia'],
    prioridade: 'URGENTE',
    motivo: 'Menciona risco imediato à vida ou à segurança',
  },
  {
    termos: ['crianca', 'idoso', 'idosa', 'gestante', 'deficiencia', 'acamado', 'cadeirante', 'escola', 'posto de saude', 'sem agua', 'falta de agua', 'esgoto a ceu aberto', 'alagamento', 'alagado', 'alaga', 'inunda', 'buraco grande', 'rato', 'escorpiao', 'dengue', 'urgente', 'perigo', 'perigoso'],
    prioridade: 'ALTA',
    motivo: 'Envolve público vulnerável, saúde pública ou serviço essencial',
  },
];

export function sugerirPrioridade(texto: string, padrao: Prioridade): { prioridade: Prioridade; motivo: string } {
  const t = normalizar(texto);
  for (const r of RISCO) {
    const achados = r.termos.filter((termo) => t.includes(termo));
    if (achados.length > 0) return { prioridade: r.prioridade, motivo: `${r.motivo} (termos: ${achados.join(', ')})` };
  }
  return { prioridade: padrao, motivo: 'Sem termos de risco; mantida a prioridade padrão do serviço' };
}

export function resumir(texto: string, servico: string, localidade: string | null, similares: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  const primeira = (limpo.split(/(?<=[.!?])\s/)[0] ?? limpo).slice(0, 180);
  const partes = [`${servico}${localidade ? ` em ${localidade}` : ''}: ${primeira}${primeira.length < limpo.length ? '…' : ''}`];
  if (similares > 0) partes.push(`Há ${similares} registro(s) semelhante(s) nos últimos 90 dias.`);
  return partes.join(' ');
}
