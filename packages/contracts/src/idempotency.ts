/**
 * Idempotencia de operacoes (especificacao secao 8 e 16).
 *
 * Criterio 2 da secao 20: "Repetir a mesma abertura por falha de rede nao cria
 * duplicata; envio concorrente de solicitações diferentes nao repete protocolo."
 *
 * A chave de idempotencia e por escopo de USUARIO e OPERACAO. Sem o escopo de
 * usuario, um cidadao poderia colidir com a chave de outro e receber o
 * protocolo de uma solicitacao que nao fez.
 */
import { createHash } from 'node:crypto';

export type IdempotencyLookup =
  | { readonly kind: 'NEW' }
  | { readonly kind: 'REPLAY'; readonly resultEntityId: string }
  /** Mesma chave, corpo diferente: o cliente reusou a chave por engano. */
  | { readonly kind: 'MISMATCH' }
  | { readonly kind: 'IN_FLIGHT' };

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 160;

/**
 * Valida o formato da chave.
 *
 * Restringir o conjunto de caracteres evita que a chave entre numa query sem
 * parametrizacao e impede colisao apos normalizacao. Uma chave deve ser opaca e
 * gerada pelo cliente.
 */
export function isValidIdempotencyKey(key: string): boolean {
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return false;
  }
  return /^[A-Za-z0-9._:-]+$/.test(key);
}

/**
 * Hash da entrada, guardado junto da chave.
 *
 * Serve para detectar reuso de chave com corpo diferente. Guardamos apenas o
 * hash: o corpo pode conter descricao do problema e dados pessoais, e nao
 * precisa ser replicado na tabela de idempotencia.
 */
export function hashRequestPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * Serializacao estavel, para que a mesma estrutura logica produza sempre o
 * mesmo hash, independentemente da ordem das chaves.
 *
 * Sem isso, um retry com o mesmo corpo em ordem de chaves diferente geraria
 * hash diferente e seria tratado comoMismatch, quebrando o idempotencia.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

/**
 * Classifica o resultado da busca da chave.
 *
 * A distincao entre REPLAY e IN_FLIGHT importa: REPLAY devolve o protocolo ja
 * criado, IN_FLIGHT diz para o cliente repetir a leitura. Tratar IN_FLIGHT como
 * erro faria o cidadao ver falha numa operacao que pode ter dado certo.
 */
export function classifyIdempotencyLookup(input: {
  readonly found: boolean;
  readonly storedHash: string | null;
  readonly requestHash: string;
  readonly resultEntityId: string | null;
  readonly expiresAt: Date;
  readonly now: Date;
}): IdempotencyLookup {
  if (!input.found) return { kind: 'NEW' };

  // Chave expirada e tratada como se nao existisse. O cliente pode reusar a
  // chave apos a expiracao, e isso e intencional.
  if (input.expiresAt.getTime() <= input.now.getTime()) {
    return { kind: 'NEW' };
  }

  if (input.storedHash !== input.requestHash) {
    return { kind: 'MISMATCH' };
  }

  if (input.resultEntityId === null) {
    return { kind: 'IN_FLIGHT' };
  }

  return { kind: 'REPLAY', resultEntityId: input.resultEntityId };
}

/** Janela padrao de validade da chave. Cobre retentativa de rede tipica. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export function idempotencyExpiry(now: Date): Date {
  return new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000);
}
