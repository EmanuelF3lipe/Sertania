/**
 * Tipos compartilhados entre API, web e worker (especificacao secao 10).
 *
 * Este pacote concentra os tipos PUBLICOS e os esquemas de validacao. Nunca
 * exportar entidades completas do banco como resposta de API: os DTOs de
 * cidadao, operacao e gestao sao distintos e ficam definidos aqui.
 */
export * from './request.js';
export * from './auth.js';
export * from './workflow.js';
export * from './errors.js';
export * from './authorization.js';
export * from './sla.js';
export * from './protocol.js';
export * from './idempotency.js';

/** Formato de erro estavel da API (secao 16). Nao expoe stack trace nem SQL. */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly correlationId: string;
  /** Detalhes de validacao por campo, sem ecoar o valor recebido. */
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export const API_ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
  ATTACHMENT_NOT_AVAILABLE: 'ATTACHMENT_NOT_AVAILABLE',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  OUTCOME_REQUIRED: 'OUTCOME_REQUIRED',
  REOPEN_WINDOW_CLOSED: 'REOPEN_WINDOW_CLOSED',
  SMALL_GROUP_SUPPRESSED: 'SMALL_GROUP_SUPPRESSED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/**
 * Capacidades do contexto de trabalho, entregues por `/me` (secao 16).
 *
 * A interface deriva botoes destes flags. Nenhuma funcao privilegiada depende
 * de um botao escondido: esconder um botao e convenience, a verificacao e no
 * backend.
 */
export interface SessionCapabilities {
  readonly isCitizen: boolean;
  readonly isServer: boolean;
  readonly actions: readonly string[];
  readonly contexts: readonly WorkContext[];
}

export interface WorkContext {
  readonly contextId: string;
  readonly secretariatId: string;
  readonly secretariatName: string;
  readonly unitIds: readonly string[];
  readonly roles: readonly string[];
  readonly isCurrent: boolean;
}

/** Envelope de paginacao no servidor (secao 16). */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Indicadores agregados (secao 14). Toda resposta de indicador apresenta
 * periodo, filtro, instante de atualizacao e definicao.
 */
export interface IndicatorMeta {
  readonly key: string;
  readonly label: string;
  readonly definition: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOf: string;
  readonly filter: Readonly<Record<string, string>>;
  /** true quando o dado e de demonstracao (seed sintetico), nao producao. */
  readonly isDemonstrationData: boolean;
  /**
   * Denominador exibido junto do numerador. Indicadores de taxa nunca sao
   * publicados sem o total que os sustenta.
   */
  readonly denominator?: number;
}
