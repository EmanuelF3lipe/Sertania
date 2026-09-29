/**
 * Estados internos de uma solicitacao (especificacao secao 6).
 *
 * O valor tecnico nunca e exposto como texto ao cidadao. Cada estado tem um
 * texto em linguagem simples para a interface, separado do valor interno.
 */
export const REQUEST_STATES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'WAITING_CITIZEN',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
] as const;

export type RequestState = (typeof REQUEST_STATES)[number];

/** Estados em que a solicitacao ainda esta aberta (nao encerrada). */
export const OPEN_STATES = [
  'SUBMITTED',
  'IN_REVIEW',
  'WAITING_CITIZEN',
  'SCHEDULED',
  'IN_PROGRESS',
] as const satisfies readonly RequestState[];

export type OpenRequestState = (typeof OPEN_STATES)[number];

export function isOpenState(state: RequestState): state is OpenRequestState {
  return (OPEN_STATES as readonly RequestState[]).includes(state);
}

/** Texto mostrado ao cidadao. Nao contem sigla interna nem jargao administrativo. */
export const CITIZEN_STATE_TEXT: Record<RequestState, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Solicitacao recebida',
  IN_REVIEW: 'Em analise',
  WAITING_CITIZEN: 'Precisamos de uma informacao',
  SCHEDULED: 'Atendimento programado',
  IN_PROGRESS: 'Em atendimento',
  COMPLETED: 'Concluida',
  CANCELED: 'Cancelada',
};

/**
 * Resultados possiveis na conclusao (secao 6).
 *
 * RESOLVED e o unico que alimenta o indicador de resolucoes. Negativa,
 * duplicidade e fora de competencia sao resultados distintos e nao podem ser
 * somados como problema solucionado.
 */
export const REQUEST_OUTCOMES = [
  'RESOLVED',
  'DENIED',
  'DUPLICATE',
  'OUT_OF_SCOPE',
] as const;

export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

export function isCompletionOutcome(
  outcome: string,
): outcome is RequestOutcome {
  return (REQUEST_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * Prioridade administrativa (secao 8).
 *
 * O cidadao relata o problema mas nao concede a si mesmo prioridade. Somente um
 * servidor autorizado altera, e a mudanca exige justificativa auditada.
 */
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_PRIORITY: Priority = 'NORMAL';

/**
 * Classificacao operacional da informacao (secao 13).
 *
 * Esta e uma classificacao tecnica de necessidade de protecao. NAO substitui
 * eventual classificacao juridica de sigilo definida por lei municipal.
 */
export const INFORMATION_CLASSIFICATIONS = [
  'PUBLIC_APPROVED',
  'INTERNAL',
  'RESTRICTED_PERSONAL',
  'RESTRICTED_SENSITIVE',
] as const;

export type InformationClassification = (typeof INFORMATION_CLASSIFICATIONS)[number];

/**
 * Conteudo de Saude e de menores recebe restricao por padrao ate avaliacao
 * especifica. "Ate avaliacao" e o padrao, nao a excecao.
 */
export const RESTRICTED_CLASSIFICATIONS = [
  'RESTRICTED_PERSONAL',
  'RESTRICTED_SENSITIVE',
] as const satisfies readonly InformationClassification[];

export type RestrictedClassification =
  (typeof RESTRICTED_CLASSIFICATIONS)[number];

export function isRestrictedClassification(
  classification: InformationClassification,
): classification is RestrictedClassification {
  return (RESTRICTED_CLASSIFICATIONS as readonly InformationClassification[]).includes(
    classification,
  );
}

/** Canais de origem de uma solicitacao (secao 5, atendimento assistido). */
export const REQUEST_CHANNELS = [
  'WEB',
  'ASSISTED_DESK',
  'ASSISTED_PHONE',
] as const;

export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

export const CITIZEN_CHANNEL_TEXT: Record<RequestChannel, string> = {
  WEB: 'Portal do cidadao',
  ASSISTED_DESK: 'Atendimento presencial',
  ASSISTED_PHONE: 'Atendimento por telefone',
};

/**
 * Metodos de verificacao de identidade no atendimento assistido.
 *
 * Nenhum destes valores e uma senha, e nenhum deles substitui validacao de
 * representacao. Ver secao 5.
 */
export const IDENTITY_VERIFICATION_METHODS = [
  'NONE_RECORDED',
  'CPF_CONFIRMED_IN_PERSON',
  'DOCUMENT_PRESENTED_IN_PERSON',
  'KNOWN_CADASTRE',
] as const;

export type IdentityVerificationMethod =
  (typeof IDENTITY_VERIFICATION_METHODS)[number];

/** Tipos de relacao entre solicitaoes (secao 6). */
export const REQUEST_RELATION_TYPES = ['DUPLICATE_OF', 'RECURRENCE_OF'] as const;
export type RequestRelationType = (typeof REQUEST_RELATION_TYPES)[number];

/** Tipos de evento de negocio persistidos em `request_events` (secao 6). */
export const REQUEST_EVENT_TYPES = [
  'CREATED',
  'SUBMITTED',
  'STATE_CHANGED',
  'ASSIGNED',
  'TRANSFERRED',
  'INFORMATION_REQUESTED',
  'INFORMATION_PROVIDED',
  'SCHEDULED',
  'EXECUTION_STARTED',
  'COMPLETED',
  'CANCELED',
  'REOPEN_REQUESTED',
  'REOPEN_DECIDED',
  'RELATED_LINKED',
  'TASK_CREATED',
  'TASK_ACCEPTED',
] as const;

export type RequestEventType = (typeof REQUEST_EVENT_TYPES)[number];

/**
 * Visibilidade de um evento (secao 6).
 *
 * Uma mensagem interna NUNCA aparece na API publica, em e-mail ou na linha do
 * tempo do cidadao. `INTERNAL_ONLY` e omitido na serializacao para o cidadao.
 */
export const EVENT_VISIBILITIES = ['CITIZEN_VISIBLE', 'INTERNAL_ONLY'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];
