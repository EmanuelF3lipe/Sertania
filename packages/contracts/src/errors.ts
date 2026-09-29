/**
 * Erros de dominio (especificacao secao 6 e 16).
 *
 * Erros de regra de negocio sao distintos de erros de infraestrutura. O worker
 * usa essa distincao para decidir entre repetir a operacao e devolver erro.
 */
export class DomainError extends Error {
  protected constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Transicao inexistente na tabela de estados. Nao e erro de transporte. */
export class IllegalTransitionError extends DomainError {
  constructor(from: string, command: string) {
    super(
      `Comando ${command} nao e valido a partir do estado ${from}`,
      'ILLEGAL_TRANSITION',
    );
  }
}

/** Conclusao sem resultado ou sem justificativa publica (secao 6). */
export class OutcomeRequiredError extends DomainError {
  constructor() {
    super(
      'Conclusao exige resultado (RESOLVED, DENIED, DUPLICATE ou OUT_OF_SCOPE) e justificativa publica',
      'OUTCOME_REQUIRED',
    );
  }
}

/**
 * Conflito de concorrencia por versao do registro (secao 6).
 *
 * Duas pessoas alterando o mesmo pedido simultaneamente devem receber conflito
 * controlado, nunca sobrescrita silenciosa.
 */
export class VersionConflictError extends DomainError {
  constructor(expected: number, actual: number) {
    super(
      `Registro alterado por outra pessoa: versao esperada ${expected}, versao atual ${actual}`,
      'VERSION_CONFLICT',
    );
  }
}

/** Negacao por padrao da politica de autorizacao (secao 4). */
export class AuthorizationError extends DomainError {
  /**
   * A mensagem e deliberadamente generica. Nao revela se o recurso existe, o
   * que impediria enumeracao de protocolos e UUIDs.
   */
  constructor() {
    super('Acesso negado', 'FORBIDDEN');
  }
}

/**
 * Recurso inexistente OU inacessivel. Resposta unica de proposito: distinguir
 * os dois casos permitiria enumeracao de dados de terceiros.
 */
export class NotFoundOrForbiddenError extends DomainError {
  constructor() {
    super('Recurso nao encontrado ou nao acessivel', 'NOT_FOUND');
  }
}

/** Reabertura fora da janela de tempo permitida (secao 6). */
export class ReopenWindowClosedError extends DomainError {
  constructor(days: number) {
    super(
      `Pedido de reabertura disponivel por ${days} dias corridos apos a conclusao`,
      'REOPEN_WINDOW_CLOSED',
    );
  }
}

/**
 * Acao do cidadao rejeitada por regra de negocio, com texto ja seguro para
 * exibicao. Nao usar para esconder erros de infraestrutura.
 */
export class BusinessRuleViolationError extends DomainError {
  constructor(message: string, code: string) {
    super(message, code);
  }
}
