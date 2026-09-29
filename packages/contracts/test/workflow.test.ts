import { describe, expect, it } from 'vitest';
import {
  TRANSITION_RULES,
  WORKFLOW_COMMANDS,
  allowedCommandsFrom,
  canTransition,
  resolveInformationReturn,
  targetStateFor,
  type WorkflowCommand,
} from '../src/workflow.js';
import { REQUEST_STATES, type RequestState } from '../src/request.js';

describe('tabela de transicoes (secao 6)', () => {
  it('caminho inicial e DRAFT -> SUBMITTED -> IN_REVIEW', () => {
    expect(targetStateFor('DRAFT', 'SUBMIT')).toBe('SUBMITTED');
    expect(targetStateFor('SUBMITTED', 'START_REVIEW')).toBe('IN_REVIEW');
  });

  it('de IN_REVIEW aceita complementacao, programacao, execucao e conclusao', () => {
    const fromReview = allowedCommandsFrom('IN_REVIEW').sort();
    expect(fromReview).toEqual(
      [
        'CANCEL',
        'COMPLETE',
        'REQUEST_INFORMATION',
        'SCHEDULE',
        'START_EXECUTION',
      ].sort(),
    );
  });

  it('de SCHEDULED permite IN_PROGRESS, IN_REVIEW e WAITING_CITIZEN', () => {
    expect(targetStateFor('SCHEDULED', 'START_EXECUTION')).toBe('IN_PROGRESS');
    expect(targetStateFor('SCHEDULED', 'RESCHEDULE_TO_REVIEW')).toBe('IN_REVIEW');
    expect(targetStateFor('SCHEDULED', 'REQUEST_INFORMATION')).toBe('WAITING_CITIZEN');
  });

  it('de IN_PROGRESS permite complementacao, proxima etapa e conclusao', () => {
    expect(targetStateFor('IN_PROGRESS', 'REQUEST_INFORMATION')).toBe('WAITING_CITIZEN');
    expect(targetStateFor('IN_PROGRESS', 'SCHEDULE')).toBe('SCHEDULED');
    expect(targetStateFor('IN_PROGRESS', 'COMPLETE')).toBe('COMPLETED');
  });

  it('conclusao exige resultado e justificativa publica', () => {
    expect(TRANSITION_RULES.COMPLETE.requiresOutcome).toBe(true);
    expect(TRANSITION_RULES.COMPLETE.requiresPublicReason).toBe(true);
  });

  it('reabertura retorna a IN_REVIEW e cria novo ciclo', () => {
    expect(TRANSITION_RULES.REOPEN.to).toBe('IN_REVIEW');
    expect(TRANSITION_RULES.REOPEN.startsNewCycle).toBe(true);
    expect(TRANSITION_RULES.REOPEN.from).toEqual(['COMPLETED', 'CANCELED']);
  });

  it('cancelamento nao e permitido em DRAFT nem em estados ja encerrados', () => {
    expect(canTransition('DRAFT', 'CANCEL')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCEL')).toBe(false);
    expect(canTransition('CANCELED', 'CANCEL')).toBe(false);
  });

  it('todo comando tem origem e destino declarados', () => {
    for (const command of WORKFLOW_COMMANDS) {
      const rule = TRANSITION_RULES[command];
      expect(rule, `regra ausente para ${command}`).toBeDefined();
      expect(rule.from.length, `${command} sem estado de origem`).toBeGreaterThan(0);
      expect(rule.to, `${command} sem estado de destino`).toBeTruthy();
    }
  });

  it('todo estado tem ao menos um comando de saida, exceto se for terminal puro', () => {
    for (const state of REQUEST_STATES) {
      const commands = allowedCommandsFrom(state);
      // COMPLETED e CANCELED so saem por reabertura/decisao, que sao de fato comandos.
      expect(commands.length, `estado ${state} sem nenhum comando`).toBeGreaterThan(0);
    }
  });
});

describe('retorno apos pedido de complementacao', () => {
  it('volta ao estado anterior valido registrado no pedido', () => {
    expect(resolveInformationReturn('WAITING_CITIZEN', 'SCHEDULED')).toBe('SCHEDULED');
    expect(resolveInformationReturn('WAITING_CITIZEN', 'IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(resolveInformationReturn('WAITING_CITIZEN', 'IN_REVIEW')).toBe('IN_REVIEW');
  });

  it('recusa estado de retorno que nao e valido para este pedido', () => {
    expect(() => resolveInformationReturn('WAITING_CITIZEN', 'COMPLETED')).toThrow(
      /nao e valido/i,
    );
    expect(() => resolveInformationReturn('WAITING_CITIZEN', 'DRAFT')).toThrow(
      /nao e valido/i,
    );
  });

  it('recusa resposta de informacao fora de WAITING_CITIZEN', () => {
    expect(() => resolveInformationReturn('IN_REVIEW', 'IN_REVIEW')).toThrow(
      /Somente WAITING_CITIZEN/i,
    );
  });
});

describe('integridade da tabela', () => {
  it('nenhum comando aponta para DRAFT apos o envio', () => {
    for (const command of WORKFLOW_COMMANDS) {
      expect(TRANSITION_RULES[command].to, `${command} volta para DRAFT`).not.toBe(
        'DRAFT',
      );
    }
  });

  it('so comandos de reabertura saem de estados terminais', () => {
    const fromTerminal: WorkflowCommand[] = ['REOPEN', 'DECIDE_REOPEN_APPROVE', 'DECIDE_REOPEN_DENY'];
    for (const command of WORKFLOW_COMMANDS) {
      const from = TRANSITION_RULES[command].from as readonly RequestState[];
      const touchesTerminal = from.includes('COMPLETED') || from.includes('CANCELED');
      if (touchesTerminal) {
        expect(fromTerminal, `${command} sai de estado terminal`).toContain(command);
      }
    }
  });

  it('estados de retorno nunca sao terminais', () => {
    for (const command of WORKFLOW_COMMANDS) {
      const returns = TRANSITION_RULES[command].returnsTo ?? [];
      for (const state of returns) {
        expect(['COMPLETED', 'CANCELED'], `${command} retorna a ${state}`).not.toContain(
          state,
        );
      }
    }
  });
});
