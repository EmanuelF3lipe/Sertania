import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { InformationClassification } from '@sertania/contracts';

/**
 * Anexo (especificacao secao 11 e 13).
 *
 * O arquivo vive em armazenamento privado; aqui guardamos apenas metadados e
 * a chave interna. A existencia de um identificador de arquivo NAO concede
 * acesso: o download revalida o vinculo com pedido ou tarefa.
 */
@Entity('attachments')
@Index('idx_attachments_request', ['requestId'])
@Index('idx_attachments_owner', ['ownerUserId'])
export class AttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cidadao ou servidor que fez o upload. */
  @Column({ type: 'uuid', name: 'owner_user_id' })
  ownerUserId!: string;

  @Column({ type: 'uuid', name: 'request_id', nullable: true })
  requestId!: string | null;

  @Column({ type: 'uuid', name: 'task_id', nullable: true })
  taskId!: string | null;

  /**
   * Chave privada do objeto. NUNCA uma URL publica: o bucket nao tem leitura
   * anonima em momento algum.
   */
  @Column({ type: 'varchar', length: 512, name: 'storage_key' })
  storageKey!: string;

  /**
   * Nome interno aleatorio. O nome original do arquivo pode conter dado
   * pessoal e nao precisa serarmazenado.
   */
  @Column({ type: 'varchar', length: 255, name: 'internal_name' })
  internalName!: string;

  @Column({ type: 'bigint', name: 'size_bytes' })
  sizeBytes!: string;

  /** MIME DETECTADO, e nao o declarado pelo cliente. */
  @Column({ type: 'varchar', length: 120, name: 'detected_media_type' })
  detectedMediaType!: string;

  @Column({ type: 'varchar', length: 64, name: 'sha256' })
  sha256!: string;

  /**
   * Estado da inspecao. `RELEASED` e o unico que permite download. Falha ou
 * indisponibilidade do antivirus mantem o arquivo bloqueado.
   */
  @Column({ type: 'varchar', length: 32, name: 'inspection_state', default: 'QUARANTINED' })
  inspectionState!: 'QUARANTINED' | 'SCANNING' | 'RELEASED' | 'REJECTED' | 'ERROR';

  @Column({ type: 'text', name: 'inspection_detail', nullable: true })
  inspectionDetail!: string | null;

  @Column({ type: 'varchar', length: 32 })
  classification!: InformationClassification;

  @Column({ type: 'varchar', length: 32, default: 'CITIZEN_OWN' })
  visibility!: 'CITIZEN_OWN' | 'TEAM' | 'INTERNAL_ONLY';

  @Column({ type: 'varchar', length: 64, name: 'retention_policy' })
  retentionPolicy!: string;

  @Column({ type: 'timestamptz', name: 'inspected_at', nullable: true })
  inspectedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Acesso e tentativa de acesso a anexo (secao 11).
 *
 * Guarda quem tentou acessar e o resultado, sem conteudo nem URL assinada.
 */
@Entity('attachment_access_events')
@Index('idx_attachment_access_attachment', ['attachmentId', 'createdAt'])
export class AttachmentAccessEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'attachment_id' })
  attachmentId!: string;

  @Column({ type: 'uuid', name: 'actor_user_id' })
  actorUserId!: string;

  @Column({ type: 'varchar', length: 32 })
  action!: 'DOWNLOAD' | 'UPLOAD' | 'REMOVE_REQUEST';

  @Column({ type: 'varchar', length: 32 })
  result!: 'ALLOWED' | 'DENIED' | 'NOT_AVAILABLE';

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Outbox transacional (secao 8 e 11).
 *
 * A solicitacao e o evento de notificacao sao gravados na MESMA transacao. O
 * envio de e-mail falha depois, nunca desfaz o protocolo ja confirmado.
 */
@Entity('outbox_events')
@Index('idx_outbox_pending', ['processedAt', 'attempts'])
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: string;

  /**
   * Carga minima, preferencialmente IDs. Nao guardamos aqui o texto da
   * mensagem: ele e montado no momento do envio, o que reduz a superficie de
   * dado sensivel em repouso na fila.
   */
  @Column({ type: 'jsonb' })
  payload!: Record<string, string | number | boolean | null>;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', name: 'available_at', default: () => 'now()' })
  availableAt!: Date;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  /**
   * Chave de idempotencia do trabalho. Reprocessar o mesmo evento nao pode
   * gerar dois efeitos administrativos.
   */
  @Column({ type: 'varchar', length: 160, unique: true })
  idempotencyKey!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Entrega de notificacao (secao 11).
 */
@Entity('notification_deliveries')
@Index('idx_notification_deliveries_event', ['outboxEventId'])
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'outbox_event_id' })
  outboxEventId!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: 'APP' | 'EMAIL';

  @Column({ type: 'varchar', length: 32 })
  status!: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Auditoria (especificacao secao 11 e 13).
 *
 * Sem senha, token, anexo ou conteudo clinico nos registros. O usuario da
 * aplicacao nao pode editar nem apagar esta tabela.
 */
@Entity('audit_events')
@Index('idx_audit_actor', ['actorUserId', 'createdAt'])
@Index('idx_audit_resource', ['resourceType', 'resourceId', 'createdAt'])
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'varchar', length: 64, name: 'resource_type' })
  resourceType!: string;

  @Column({ type: 'uuid', name: 'resource_id', nullable: true })
  resourceId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  result!: 'ALLOWED' | 'DENIED' | 'ERROR';

  /** Contexto tecnico: escopo, motivo da negacao, correlacao. */
  @Column({ type: 'jsonb', nullable: true })
  context!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, name: 'correlation_id' })
  correlationId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Chave de idempotencia (secao 11 e 16).
 *
 * Repetir a mesma abertura com a mesma chave nao cria outro protocolo, o que
 * atende ao criterio 2 da secao 20.
 */
@Entity('idempotency_keys')
@Index('uq_idempotency_scope', ['userId', 'operation', 'key'], { unique: true })
export class IdempotencyKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 64 })
  operation!: string;

  @Column({ type: 'varchar', length: 160 })
  key!: string;

  /** Hash da entrada: detecta reuso de chave com corpo diferente. */
  @Column({ type: 'varchar', length: 64, name: 'request_hash' })
  requestHash!: string;

  @Column({ type: 'uuid', name: 'result_entity_id', nullable: true })
  resultEntityId!: string | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Solicitacao do titular sobre dados pessoais (secao 11 e 13).
 *
 * Pedido de exclusao nao apaga automaticamente registro publico obrigatorio: a
 * decisao passa por analise e fica registrada.
 */
@Entity('privacy_requests')
@Index('idx_privacy_requests_subject', ['subjectUserId'])
export class PrivacyRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'subject_user_id' })
  subjectUserId!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: 'ACCESS' | 'DELETION' | 'RECTIFICATION' | 'PORTABILITY';

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status!: 'PENDING' | 'IN_ANALYSIS' | 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'DENIED';

  @Column({ type: 'text', nullable: true })
  decisionReason!: string | null;

  @Column({ type: 'uuid', name: 'decided_by', nullable: true })
  decidedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 *Execucao de exportacao (secao 11 e 16).
 *
 * Exportacao e trabalho assincrono, com finalidade registrada, expiracao e
 * nova validacao de escopo tanto na execucao quanto no download.
 */
@Entity('export_jobs')
@Index('idx_export_jobs_requester', ['requestedBy', 'createdAt'])
export class ExportJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy!: string;

  /** Finalidade registrada: uma exportacao sem justificativa nao e aceitavel. */
  @Column({ type: 'text' })
  purpose!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: 'QUEUED' | 'RUNNING' | 'READY' | 'EXPIRED' | 'FAILED';

  @Column({ type: 'varchar', length: 64, name: 'storage_key', nullable: true })
  storageKey!: string | null;

  @Column({ type: 'integer', name: 'row_count' })
  rowCount!: number;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
