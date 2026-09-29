/**
 * Mapeamento de comando de negocio para acao de autorizacao.
 *
 * Sem este mapa, um endpoint que aceita `START_REVIEW` nao tem como saber se o
 * ator pode inicia-lo. Foi exatamente o que aconteceu: o endpoint acceptava
 * qualquer comando de qualquer cidadao autenticado.
 *
 * A separacao importa para manutencao: o comando descreve O QUE acontece com
 * o pedido; a acao descreve QUEM pode fazer. Misturar as duas coisas num unico
 * `switch` invites o mesmo tipo de bug.
 */
import type { Action, WorkflowCommand } from '@sertania/contracts';

/**
 * Acao exigida por comando de workflow.
 *
 * Um comando ausente deste mapa e NEGADO. A lista e fechada de proposito: um
 * comando novo no dominio precisa de uma decisao explicita sobre quem pode
 * executa-lo, e nao herda permissao por padrao.
 */
const COMMAND_ACTION: Readonly<Partial<Record<WorkflowCommand, Action>>> = {
  // Acoes de atendimento, que dependem de vinculo institucional.
  START_REVIEW: 'REQUEST_REVIEW',
  REQUEST_INFORMATION: 'REQUEST_REQUEST_INFO',
  SCHEDULE: 'REQUEST_SCHEDULE',
  START_EXECUTION: 'REQUEST_EXECUTE',
  COMPLETE: 'REQUEST_COMPLETE',
  CANCEL: 'REQUEST_CANCEL',
  REOPEN: 'REQUEST_REOPEN_REQUEST_OWN',
  DECIDE_REOPEN_APPROVE: 'REQUEST_DECIDE_REOPEN',
  DECIDE_REOPEN_DENY: 'REQUEST_DECIDE_REOPEN',
  RESCHEDULE_TO_REVIEW: 'REQUEST_SCHEDULE',

  // Acao do titular. `PROVIDE_INFORMATION` responde a uma complementacao, o
  // que o cidadao pode fazer sem vinculo institucional.
  PROVIDE_INFORMATION: 'MESSAGE_SEND_OWN',
};

/**
 * Acao exigida por comando.
 *
 * Devolve `null` para comando desconhecido, e o chamador trata `null` como
 * negacao.
 */
export function actionForCommand(command: string): Action | null {
  const mapped = COMMAND_ACTION[command as WorkflowCommand];
  return mapped ?? null;
}

/**
 * Comandos que exigem que o pedido seja do proprio cidadao.
 *
 * `PROVIDE_INFORMATION` entra aqui porque responder a uma complementacao so faz
 * sentido para quem abriu o pedido.
 */
export function requiresOwnership(command: string): boolean {
  return command === 'PROVIDE_INFORMATION';
}
