import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  IdentityVerificationMethod,
  InformationClassification,
  Priority,
  RequestChannel,
  RequestOutcome,
  RequestState,
} from '@sertania/contracts';

/**
 * Solicitacao (especificacao secao 6 e 11).
 *
 * Observacoes de projeto:
 * - `id` e UUID aleatorio e serve como identificador interno.
 * - `protocol` e a referencia para o cidadao, gerado em transacao. Nao e
 *   senha: quem souber o protocolo ainda precisa de sessao valida para ver
 *   o conteudo.
 * - `version` existe para controle de concorrencia. Duas alteracoes
 *   simultaneas devem gerar conflito controlado, nunca sobrescrita silenciosa.
 */
@Entity('requests')
@Index('idx_requests_citizen_created', ['citizenId', 'createdAt'])
@Index('idx_requests_queue', ['secretariatId', 'unitId', 'state', 'createdAt'])
@Index('idx_requests_assignee_state', ['assigneeUserId', 'state'])
@Index('idx_requests_service_created', ['serviceVersionId', 'createdAt'])
@Index('uq_requests_protocol', ['protocol'], { unique: true })
export class RequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Protocolo no formato `SER-AAAA-NNNNNN`. Nulo enquanto o pedido e rascunho:
   * o protocolo nasce no envio, em transacao.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  protocol!: string | null;

  /** Cidadao dono da solicitacao. Nunca nulo, mesmo em atendimento assistido. */
  @Column({ type: 'uuid', name: 'citizen_id' })
  citizenId!: string;

  /**
   * Usuario que criou o registro. Em atendimento assistido, o servidor que
   * registrou; no portal, o proprio cidadao. A distincao e mantida para
   * auditoria, sem expor ao cidadao quem foi o atendente.
   */
  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @Column({ type: 'varchar', length: 32 })
  channel!: RequestChannel;

  /** Versao do servico CONGELADA no momento da abertura. */
  @Column({ type: 'uuid', name: 'service_version_id' })
  serviceVersionId!: string;

  @Column({ type: 'uuid', name: 'secretariat_id' })
  secretariatId!: string;

  @Column({ type: 'uuid', name: 'unit_id' })
  unitId!: string;

  @Column({ type: 'varchar', length: 32, default: 'DRAFT' })
  state!: RequestState;

  /** Resultado obrigatorio na conclusao. Nulo enquanto o pedido esta aberto. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  outcome!: RequestOutcome | null;

  @Column({ type: 'jsonb', name: 'outcome_justification', nullable: true })
  outcomeJustification!: string | null;

  /** Motivo interno da conclusao, quando a justificativa publica nao basta. */
  @Column({ type: 'text', name: 'internal_outcome_note', nullable: true })
  internalOutcomeNote!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'NORMAL' })
  priority!: Priority;

  /**
   * Justificativa auditada de mudanca de prioridade. Sem ela, a prioridade
   * nao pode ser alterada por servidor autorizado.
   */
  @Column({ type: 'text', name: 'priority_justification', nullable: true })
  priorityJustification!: string | null;

  @Column({ type: 'uuid', name: 'priority_changed_by', nullable: true })
  priorityChangedBy!: string | null;

  @Column({ type: 'varchar', length: 32 })
  classification!: InformationClassification;

  /** Politica de prazo CONGELADA no pedido. */
  @Column({ type: 'uuid', name: 'sla_policy_id' })
  slaPolicyId!: string;

  @Column({ type: 'uuid', name: 'assignee_user_id', nullable: true })
  assigneeUserId!: string | null;

  @Column({ type: 'timestamptz', name: 'submitted_at', nullable: true })
  submittedAt!: Date | null;

  /** Primeiro ciclo: inicio da contagem de prazo. */
  @Column({ type: 'timestamptz', name: 'cycle_started_at', nullable: true })
  cycleStartedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'first_human_response_at', nullable: true })
  firstHumanResponseAt!: Date | null;

  /** Programming: ha previsao registrada. Nao e agendamento confirmado. */
  @Column({ type: 'timestamptz', name: 'scheduled_for', nullable: true })
  scheduledFor!: Date | null;

  @Column({ type: 'boolean', name: 'schedule_is_estimate', default: true })
  scheduleIsEstimate!: boolean;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'canceled_at', nullable: true })
  canceledAt!: Date | null;

  @Column({ type: 'text', name: 'cancel_reason', nullable: true })
  cancelReason!: string | null;

  /** Numero do ciclo de atendimento. Reabertura cria ciclo novo. */
  @Column({ type: 'integer', default: 1 })
  cycleNumber!: number;

  /**
   * Estado anterior ao pedido de complementacao, para devolver o pedido ao
   * estagio certo quando o cidadao responder (secao 6).
   */
  @Column({ type: 'varchar', length: 32, name: 'state_before_waiting', nullable: true })
  stateBeforeWaiting!: RequestState | null;

  /**
   * Metodo de verificacao de identidade, para atendimento assistido. Nenhum
   * destes valores e senha (secao 5).
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  identityVerificationMethod!: IdentityVerificationMethod | null;

  @Column({ type: 'varchar', length: 160, name: 'assisted_note', nullable: true })
  assistedNote!: string | null;

  /** Versao para controle de concorrencia otimo. */
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * Conteudo da solicitacao (secao 11).
 *
 * Separado de metadados operacionais: a listagem de uma fila nao precisa ler
 * descricao nem dado sensivel, e a leitura deste conteudo passa pela politica
 * do pedido.
 */
@Entity('request_content')
@Index('idx_request_content_request', ['requestId'], { unique: true })
export class RequestContentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'text' })
  description!: string;

  /** Respostas do formulario dinamico, na versao congelada do servico. */
  @Column({ type: 'jsonb', name: 'form_answers' })
  formAnswers!: Record<string, unknown>;

  /**
   * Dados complementares protegidos. O conteudo e cifrado em aplicacao quando
   * a classificacao exigir (secao 13); aqui guardamos o texto cifrado e a
   * versao da chave, nunca o segredo.
   */
  @Column({ type: 'text', name: 'protected_data_ciphertext', nullable: true })
  protectedDataCiphertext!: string | null;

  @Column({ type: 'integer', name: 'protected_key_version', nullable: true })
  protectedKeyVersion!: number | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * Local da ocorrencia (secao 11 e 14).
 *
 * NAO e a residencia do cidadao. Guardar a localizacao do problema e
 * necessario para Infraestrutura; guardar onde a pessoa mora seria coleta
 * sem necessidade para aquele servico.
 */
@Entity('request_locations')
@Index('idx_request_locations_request', ['requestId'], { unique: true })
export class RequestLocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  /** Endereco escrito, quando informado. */
  @Column({ type: 'text', name: 'address_text' })
  addressText!: string;

  /** Referencia rural ou pontos de referencia. */
  @Column({ type: 'varchar', length: 240, nullable: true })
  reference!: string | null;

  @Column({ type: 'varchar', length: 140, nullable: true })
  locality!: string | null;

  /**
   * Ponto opcional, em `geography(Point,4326)`. Nao inventar poligonos oficiais
   * de bairros ou comunidades (secao 14).
   */
  // Tipo espacial do PostGIS. O indice GiST e criado na migracao; aqui a
  // coluna e apenas declarada para leitura e escrita do ponto.
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  point!: string | null;

  /** Origem do ponto: escolhido no mapa, informado, ou geocodificado. */
  @Column({ type: 'varchar', length: 32 })
  precisionSource!: 'MAP_PICK' | 'TYPED' | 'GEOCODED' | 'UNKNOWN';

  @Column({ type: 'integer', name: 'precision_meters', nullable: true })
  precisionMeters!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
