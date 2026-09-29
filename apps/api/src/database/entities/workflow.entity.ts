import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  EventVisibility,
  RequestEventType,
  RequestState,
} from '@sertania/contracts';

/**
 * Eventos de negocio (especificacao secao 6 e 11).
 *
 * Campo separado para informacao ao cidadao e informacao interna. Uma mensagem
 * interna NUNCA aparece na API publica, em e-mail ou na linha do tempo do
 * cidadao, e a separacao no armazenamento e o que torna isso verificavel.
 */
@Entity('request_events')
@Index('idx_request_events_request_created', ['requestId', 'createdAt'])
export class RequestEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'uuid', name: 'actor_user_id' })
  actorUserId!: string;

  @Column({ type: 'varchar', length: 40 })
  type!: RequestEventType;

  @Column({ type: 'varchar', length: 24 })
  visibility!: EventVisibility;

  @Column({ type: 'varchar', length: 32, name: 'state_before', nullable: true })
  stateBefore!: RequestState | null;

  @Column({ type: 'varchar', length: 32, name: 'state_after', nullable: true })
  stateAfter!: RequestState | null;

  /** Texto que o cidadao le. Nao contem jargao interno. */
  @Column({ type: 'text', name: 'public_text' })
  publicText!: string;

  /** Detalhe interno, nunca serializado para o cidadao. */
  @Column({ type: 'text', name: 'internal_note', nullable: true })
  internalNote!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'integer', name: 'cycle_number' })
  cycleNumber!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Mensagens e notas internas (secao 6 e 11).
 *
 * `visibility` decide quem le. A nota interna fica no mesmo registro para
 * preservar a ordem da conversa, mas e excluida na serializacao publica.
 */
@Entity('messages')
@Index('idx_messages_request_created', ['requestId', 'createdAt'])
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'uuid', name: 'author_user_id' })
  authorUserId!: string;

  @Column({ type: 'varchar', length: 24 })
  visibility!: EventVisibility;

  /**
   * Texto protegido. Cifrado em aplicacao quando o pedido for restrito, para
   * que uma leitura indevida do banco nao exponha conteudo de terceiro.
   */
  @Column({ type: 'text', name: 'body_ciphertext' })
  bodyCiphertext!: string;

  @Column({ type: 'integer', name: 'key_version', nullable: true })
  keyVersion!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Complementacao pedida ao cidadao (secao 6 e 11).
 *
 * Guarda o estado anterior valido para devolver o pedido ao estagio certo, e a
 * resposta esperada, para que a interface explique o que falta.
 */
@Entity('information_requests')
@Index('idx_information_requests_request', ['requestId'])
export class InformationRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy!: string;

  @Column({ type: 'varchar', length: 32, name: 'return_state' })
  returnState!: RequestState;

  /** Pergunta especifica e visivel ao cidadao. */
  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'text', name: 'expected_response', nullable: true })
  expectedResponse!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status!: 'PENDING' | 'ANSWERED' | 'CANCELLED';

  @Column({ type: 'timestamptz', name: 'answered_at', nullable: true })
  answeredAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Pausa de prazo (secao 8 e 11).
 *
 * `started_at` e `ended_at` sao gravados: pausa sem registro de inicio e fim
 * nao permite reconstruir o tempo contabilizado.
 */
@Entity('sla_pauses')
@Index('idx_sla_pauses_request', ['requestId'])
export class SlaPauseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'varchar', length: 32 })
  state!: RequestState;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'ended_at', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'uuid', name: 'approved_by' })
  approvedBy!: string;
}

/**
 * Atribuicao e transferencia (secao 7 e 11).
 *
 * Transferencia preserva o protocolo e o prazo: o cidadao continua com a
 * mesma referencia e a mesma data informada.
 */
@Entity('transfers')
@Index('idx_transfers_request', ['requestId'])
export class TransferEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'uuid', name: 'from_secretariat_id', nullable: true })
  fromSecretariatId!: string | null;

  @Column({ type: 'uuid', name: 'from_unit_id', nullable: true })
  fromUnitId!: string | null;

  @Column({ type: 'uuid', name: 'to_secretariat_id' })
  toSecretariatId!: string;

  @Column({ type: 'uuid', name: 'to_unit_id' })
  toUnitId!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'uuid', name: 'transferred_by' })
  transferredBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Tarefa de colaboracao (secao 7 e 11).
 *
 * Uma tarefa NAO concede acesso ao pedido completo: carrega apenas o resumo
 * aprovado e os anexos explicitamente selecionados. Educacao pedir vistoria a
 * Infraestrutura nao leva junto documento do aluno.
 */
@Entity('tasks')
@Index('idx_tasks_assignee', ['assigneeUserId', 'status'])
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @Column({ type: 'uuid', name: 'assignee_user_id' })
  assigneeUserId!: string;

  @Column({ type: 'uuid', name: 'to_secretariat_id' })
  toSecretariatId!: string;

  /** Resumo minimo aprovado para este destinatario. */
  @Column({ type: 'text' })
  summary!: string;

  /** Local, quando necessario a execucao. */
  @Column({ type: 'text', name: 'location_summary', nullable: true })
  locationSummary!: string | null;

  /** Anexos aprovados individualmente, nunca a lista inteira. */
  @Column({ type: 'uuid', array: true, name: 'attachment_ids', default: '{}' })
  attachmentIds!: string[];

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status!: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'DONE';

  @Column({ type: 'timestamptz', name: 'accepted_at', nullable: true })
  acceptedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Pedido de reabertura (secao 6 e 11).
 *
 * O cidadao pede; a equipe decide. Reabertura aprovada cria novo ciclo de
 * atendimento, e o tempo de atendimento anterior permanece medido.
 */
@Entity('reopen_requests')
@Index('idx_reopen_requests_request', ['requestId'])
export class ReopenRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status!: 'PENDING' | 'APPROVED' | 'DENIED';

  @Column({ type: 'uuid', name: 'decided_by', nullable: true })
  decidedBy!: string | null;

  @Column({ type: 'text', name: 'decision_reason', nullable: true })
  decisionReason!: string | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Ciclo de atendimento (secao 11).
 *
 * Um registro por ciclo. Permite medir reabertura por coorte de conclusao e
 * manter o tempo do ciclo anterior, que nao deve ser sobrescrito.
 */
@Entity('request_cycles')
@Index('idx_request_cycles_request', ['requestId', 'cycleNumber'], { unique: true })
export class RequestCycleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'integer', name: 'cycle_number' })
  cycleNumber!: number;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'integer', name: 'elapsed_business_minutes' })
  elapsedBusinessMinutes!: number;

  /** true se o ciclo foi aberto por reabertura. */
  @Column({ type: 'boolean', name: 'from_reopen', default: false })
  fromReopen!: boolean;
}

/**
 * Relacao entre solicitacoes (secao 6 e 11).
 *
 * Recorrencia e agrupamento analitico e NAO equivale a duplicidade
 * administrativa. A distincao fica no tipo da relacao.
 */
@Entity('request_relations')
@Index('uq_request_relations', ['requestId', 'relatedRequestId', 'type'], { unique: true })
export class RequestRelationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'uuid', name: 'related_request_id' })
  relatedRequestId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: 'DUPLICATE_OF' | 'RECURRENCE_OF';

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Avaliacao do titular (secao 11).
 *
 * Uma avaliacao por ciclo e por autor. Vincular ao ciclo, e nao apenas ao
 * pedido, evita que a reabertura apague a satisfacao medida antes.
 */
@Entity('evaluations')
@Index('uq_evaluations_cycle_author', ['requestId', 'cycleNumber', 'authorUserId'], {
  unique: true,
})
export class EvaluationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'integer', name: 'cycle_number' })
  cycleNumber!: number;

  @Column({ type: 'uuid', name: 'author_user_id' })
  authorUserId!: string;

  /** Nota entre 1 e 5, garantida por restricao no banco. */
  @Column({ type: 'integer' })
  rating!: number;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
