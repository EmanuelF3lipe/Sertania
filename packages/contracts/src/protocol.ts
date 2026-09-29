/**
 * Geracao de protocolo (especificacao secao 6).
 *
 * Regras da especificacao, aplicadas a risca:
 * - O protocolo e gerado NO ENVIO, em transacao.
 * - Usar sequencia ou contador protegido por bloqueio transacional e
 *   restricao de unicidade.
 * - NUNCA calcular por `MAX + 1`.
 * - O identificador interno e UUID aleatorio; o protocolo serve para
 *   referencia e NAO funciona como senha.
 *
 * Por que `MAX + 1` esta descartado: dois envios concorrentes leem o mesmo
 * maximo e tentam gravar o mesmo numero. A restricao de unicidade faz um deles
 * falhar, e o cidadao vera um erro em vez de um protocolo. Com sequencia
 * dedicada do PostgreSQL, o banco distribui numeros distintos e a transacao
 * nao precisa de lock otimista.
 */
import { randomUUID } from 'node:crypto';
import { PROTOCOL_PATTERN } from './auth.js';

export const PROTOCOL_PREFIX = 'SER';

/** Ano do protocolo, derivado do instante de envio. */
export function protocolYear(at: Date): number {
  return at.getUTCFullYear();
}

/**
 * Formata o numero na sequencia com seis digitos.
 *
 * A sequencia e anual: o numero 1 de 2027 reinicia. Isso mantem o protocolo
 * curto e legivel, e o ano no proprio texto evita ambiguidade.
 */
export function formatProtocol(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Sequencia de protocolo invalida: ${sequence}`);
  }
  if (sequence > 999999) {
    // Estouro de seis digitos. Melhor falhar de forma explicita do que
    // gerar um protocolo com sete digitos que quebra o formato aceito pela
    // propria interface e pelos testes.
    throw new Error('Sequencia de protocolo esgotou o ano corrente');
  }
  return `${PROTOCOL_PREFIX}-${year}-${String(sequence).padStart(6, '0')}`;
}

export function isValidProtocol(value: string): boolean {
  return PROTOCOL_PATTERN.test(value);
}

/** Sequencia anual, alocada pelo banco. */
export const PROTOCOL_SEQUENCE_TABLE = 'protocol_sequences';

export interface ProtocolSequenceRow {
  readonly year: number;
  readonly last_value: number;
}

/**
 * SQL da reserva de numero.
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` e atomico: o proprio banco
 * distribui o proximo numero e devolve o valor reservado. Nao ha janela de
 * leitura, e portanto nao ha corrida.
 *
 * O numero fica reservado mesmo que a transacao seguinte falhe. Isso produz
 * lacuna na sequencia, o que e aceitavel e preferivel a duplicidade: o cidadao
 * nunca recebe dois protocolos iguais, e pular um numero nao incomoda ninguem.
 */
export function reserveNextProtocolSql(year: number): string {
  // O ano e parametro de CHAMADA, nao de SQL. Ele nao entra no texto porque a
  // consulta usa `$1`, e quem substitui e o array de parametros do driver. O
  // parametro existe para tornar o ano explicito na assinatura e permitir
  // conferir, no log, que o ano reservado e o do instante de envio.
  void year;
  // O ano entra como parametro ($1), nunca concatenado: query parametrizada e
  // obrigatoria, e concatenar tornaria o valor nao-confiavel.
  return `
    INSERT INTO ${PROTOCOL_SEQUENCE_TABLE} ("year", "last_value", "updated_at")
    VALUES ($1, 1, now())
    ON CONFLICT ("year")
    DO UPDATE SET
      "last_value" = ${PROTOCOL_SEQUENCE_TABLE}."last_value" + 1,
      "updated_at" = now()
    RETURNING "last_value"
  `.trim();
}

/** Identificador interno do pedido. Independente do protocolo. */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Verifica se o protocolo pertence ao ano esperado.
 *
 * Serve para rejeitar tentativas de usar o protocolo de um pedido em outro
 * contexto, e para o formulario de atendimento assistido pedir o ano correto.
 */
export function protocolMatchesYear(protocol: string, year: number): boolean {
  return protocol.startsWith(`${PROTOCOL_PREFIX}-${year}-`);
}
