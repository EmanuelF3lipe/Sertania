/**
 * Provedor opcional via Claude API (IA_PROVEDOR=claude + ANTHROPIC_API_KEY).
 *
 * Garantias:
 * - O texto e pseudonimizado ANTES do envio (CPF, telefone, e-mail, nome do solicitante).
 * - Saida estruturada (JSON Schema) validada com zod; qualquer falha cai para a IA local.
 * - O resultado e gravado como SUGESTAO pendente de decisao humana.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PRIORIDADES, type Prioridade } from '../../shared/dominio.js';
import type { UsoTokens } from './uso.js';

export const MODELO = 'claude-opus-5-5';
/** Chamado logo apos cada resposta da API, para registrar os tokens gastos. */
export type AoUsar = (uso: UsoTokens, modelo: string) => void;

let cliente: Anthropic | null = null;
function obterCliente(): Anthropic {
  cliente ??= new Anthropic();
  return cliente;
}

const esquemaAnalise = z.object({
  servicoId: z.number().int(),
  alternativas: z.array(z.number().int()).max(2),
  confianca: z.number().min(0).max(1),
  prioridade: z.enum(PRIORIDADES),
  motivoPrioridade: z.string(),
  resumo: z.string(),
});
export type AnaliseClaude = z.infer<typeof esquemaAnalise>;

const JSON_ANALISE = {
  type: 'object',
  additionalProperties: false,
  required: ['servicoId', 'alternativas', 'confianca', 'prioridade', 'motivoPrioridade', 'resumo'],
  properties: {
    servicoId: { type: 'integer', description: 'id do servico mais adequado do catalogo' },
    alternativas: { type: 'array', items: { type: 'integer' }, description: 'ate 2 outros ids plausiveis' },
    confianca: { type: 'number', description: 'de 0 a 1' },
    prioridade: { type: 'string', enum: [...PRIORIDADES] },
    motivoPrioridade: { type: 'string' },
    resumo: { type: 'string', description: 'uma ou duas frases, linguagem simples, sem dados pessoais' },
  },
} as const;

const SISTEMA_TRIAGEM = `Você apoia a triagem de solicitações de cidadãos à Prefeitura de Sertânia (PE).
Sua resposta é uma SUGESTÃO que um servidor público vai revisar; não tome decisões finais.
Escolha o serviço do catálogo que melhor corresponde ao relato. Se nenhum servir bem, escolha o mais próximo e use confiança baixa.
Prioridade: URGENTE só para risco imediato à vida ou segurança; ALTA para público vulnerável, saúde pública ou serviço essencial interrompido; NORMAL no geral; BAIXA para pedidos sem impacto imediato.
O resumo deve ter no máximo duas frases, em linguagem simples, sem nomes ou contatos.`;

function texto(msg: Anthropic.Beta.BetaMessage): string {
  return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

export async function analisarComClaude(
  relato: string,
  catalogo: Array<{ id: number; nome: string; secretaria: string; palavrasChave: string }>,
  prioridadePadrao: Prioridade,
  aoUsar: AoUsar,
): Promise<AnaliseClaude> {
  const lista = catalogo.map((s) => `${s.id} | ${s.nome} | ${s.secretaria} | ${s.palavrasChave}`).join('\n');
  const msg = await obterCliente().beta.messages.create({
    model: MODELO,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: JSON_ANALISE } },
    system: [{ type: 'text', text: SISTEMA_TRIAGEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Catálogo (id | serviço | secretaria | palavras-chave):\n${lista}\n\nPrioridade padrão do serviço escolhido pelo cidadão: ${prioridadePadrao}\n\nRelato (já sem dados pessoais):\n"""${relato}"""`,
      },
    ],
  });
  aoUsar(msg.usage, msg.model);
  if (msg.stop_reason === 'refusal') throw new Error('Modelo recusou a análise');
  const analise = esquemaAnalise.parse(JSON.parse(texto(msg)));
  if (!catalogo.some((s) => s.id === analise.servicoId)) throw new Error('Serviço sugerido fora do catálogo');
  return analise;
}

export async function narrativaComClaude(indicadores: unknown, periodo: string, aoUsar: AoUsar): Promise<string> {
  const msg = await obterCliente().beta.messages.create({
    model: MODELO,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: `Você redige a seção "Análise" de relatórios gerenciais da Prefeitura de Sertânia (PE).
Use somente os números fornecidos; não invente dados nem compare com outros municípios.
Escreva em português claro, de 3 a 5 parágrafos curtos: visão geral, prazos, territórios e recorrências, satisfação e recomendações.
Termine com a frase: "Texto gerado com apoio de IA; requer revisão do gestor responsável."`,
    messages: [{ role: 'user', content: `Período: ${periodo}\nIndicadores agregados (JSON):\n${JSON.stringify(indicadores)}` }],
  });
  aoUsar(msg.usage, msg.model);
  if (msg.stop_reason === 'refusal') throw new Error('Modelo recusou a narrativa');
  return texto(msg).trim();
}
