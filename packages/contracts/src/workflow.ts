/**
 * Tabela de transicoes de estado (especificacao secao 6, "Transicoes e resultados").
 *
 * Regra central: o backend recebe COMANDOS DE NEGOCIO, nao um PATCH generico
 * que aceite qualquer status. Cada transicao e verificada contra esta tabela,
 * que e a unica fonte de verdade sobre o que e possivel.
 */
import type { RequestState } from './request.js';

/** Acao de negocio invocada pelo servidor. Cada uma mapeia para uma unica transicao valida. */
export const WORKFLOW_COMMANDS = [
  'SUBMIT',
  'START_REVIEW',
  'REQUEST_INFORMATION',
  'PROVIDE_INFORMATION',
  'SCHEDULE',
  'START_EXECUTION',
  'COMPLETE',
  'CANCEL',
  'REOPEN',
  'DECIDE_REOPEN_APPROVE',
  'DECIDE_REOPEN_DENY',
  'RESCHEDULE_TO_REVIEW',
] as const;

export type WorkflowCommand = (typeof WORKFLOW_COMMANDS)[number];

export interface TransitionRule {
  readonly from: readonly RequestState[];
  readonly to: RequestState;
  /**
   * Estados para os quais a solicitacao volta apos uma resposta do cidadao.
   * Vazio significa que nao ha retorno automatico.
   */
  readonly returnsTo?: readonly RequestState[];
  /** Conclusion exige resultado e justificativa publica (secao 6). */
  readonly requiresOutcome?: boolean;
  /** Reabertura e uma acao registrada que cria novo ciclo (secao 6). */
  readonly startsNewCycle?: boolean;
  /** Justificativa publica obrigatoria. */
  readonly requiresPublicReason?: boolean;
}

export const TRANSITION_RULES: Record<WorkflowCommand, TransitionRule> = {
  // DRAFT -> SUBMITTED -> IN_REVIEW e o caminho inicial.
  SUBMIT: {
    from: ['DRAFT'],
    to: 'SUBMITTED',
    requiresPublicReason: false,
  },
  START_REVIEW: {
    from: ['SUBMITTED'],
    to: 'IN_REVIEW',
  },

  // De IN_REVIEW: WAITING_CITIZEN, SCHEDULED, IN_PROGRESS ou COMPLETED.
  REQUEST_INFORMATION: {
    from: ['IN_REVIEW', 'SCHEDULED', 'IN_PROGRESS'],
    to: 'WAITING_CITIZEN',
    // Ao receber resposta, volta ao estado anterior valido, registrado no
    // pedido de complementacao.
    returnsTo: ['IN_REVIEW', 'SCHEDULED', 'IN_PROGRESS'],
  },
  SCHEDULE: {
    from: ['IN_REVIEW', 'IN_PROGRESS'],
    to: 'SCHEDULED',
  },
  START_EXECUTION: {
    from: ['IN_REVIEW', 'SCHEDULED'],
    to: 'IN_PROGRESS',
  },
  COMPLETE: {
    from: ['IN_REVIEW', 'IN_PROGRESS'],
    to: 'COMPLETED',
    requiresOutcome: true,
    requiresPublicReason: true,
  },

  // Cancelamento em estados abertos segue permissao e regra do servico.
  CANCEL: {
    from: ['SUBMITTED', 'IN_REVIEW', 'WAITING_CITIZEN', 'SCHEDULED', 'IN_PROGRESS'],
    to: 'CANCELED',
    requiresPublicReason: true,
  },

  // Reabertura e acao registrada que retorna a IN_REVIEW e cria novo ciclo.
  REOPEN: {
    from: ['COMPLETED', 'CANCELED'],
    to: 'IN_REVIEW',
    startsNewCycle: true,
    requiresPublicReason: true,
  },

  // Decisao sobre pedido de reabertura: o cidadao pede, a equipe decide.
  DECIDE_REOPEN_APPROVE: {
    from: ['COMPLETED'],
    to: 'IN_REVIEW',
    startsNewCycle: true,
    requiresPublicReason: true,
  },
  DECIDE_REOPEN_DENY: {
    from: ['COMPLETED'],
    to: 'COMPLETED',
    requiresPublicReason: true,
  },

  // De SCHEDULED: IN_REVIEW para replanejamento.
  RESCHEDULE_TO_REVIEW: {
    from: ['SCHEDULED'],
    to: 'IN_REVIEW',
    requiresPublicReason: true,
  },

  // Resposta do cidadao a um pedido de complementacao. O destino real depende
  // do estado anterior registrado no pedido; ver `resolveInformationReturn`.
  PROVIDE_INFORMATION: {
    from: ['WAITING_CITIZEN'],
    to: 'IN_REVIEW',
  },
};

/** Transicoes validas a partir de um estado, para uso em testes e na interface. */
export function allowedCommandsFrom(state: RequestState): WorkflowCommand[] {
  return (Object.keys(TRANSITION_RULES) as WorkflowCommand[]).filter((command) =>
    TRANSITION_RULES[command].from.includes(state),
  );
}

export function canTransition(
  state: RequestState,
  command: WorkflowCommand,
): boolean {
  return TRANSITION_RULES[command].from.includes(state);
}

export function targetStateFor(
  state: RequestState,
  command: WorkflowCommand,
): RequestState | null {
  if (!canTransition(state, command)) return null;
  return TRANSITION_RULES[command].to;
}

/**
 * Resolve o estado de retorno apos uma resposta do cidadao.
 *
 * A especificacao manda registrar no pedido de complementacao qual era o estado
 * anterior valido. Retornar sempre para IN_REVIEW perderia o contexto de uma
 * etapa ja programada, entao usamos o estado registrado e o validamos.
 */
export function resolveInformationReturn(
  currentState: RequestState,
  recordedReturnState: RequestState,
): RequestState {
  if (currentState !== 'WAITING_CITIZEN') {
    throw new Error(
      `Somente WAITING_CITIZEN aceita resposta de informacao; recebido ${currentState}`,
    );
  }
  const rule = TRANSITION_RULES.REQUEST_INFORMATION;
  const allowed = rule.returnsTo ?? [];
  if (!allowed.includes(recordedReturnState)) {
    throw new Error(
      `Estado de retorno ${recordedReturnState} nao e valido para este pedido`,
    );
  }
  return recordedReturnState;
}

/** Estados terminais: nao aceitam comando de negocio sem acao explicita de reabertura. */
export const TERMINAL_STATES = ['COMPLETED', 'CANCELED'] as const;
