import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  InformationClassification,
  Role,
  SlaUnit,
} from '@sertania/contracts';

/**
 * Vinculo institucional (especificacao secao 4 e 11).
 *
 * Uma conta de servidor pode ter MAIS DE UM vinculo autorizado. Cada vinculo
 * declara o papel, a secretaria e o conjunto de unidades. A permissao efetiva
 * e sempre reconsultada a partir desta tabela, nunca de um papel guardado
 * indefinidamente na sessao.
 */
@Entity('memberships')
@Index('idx_memberships_user', ['userId'])
@Index('idx_memberships_secretariat', ['secretariatId'])
export class MembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: Role;

  @Column({ type: 'uuid', name: 'secretariat_id' })
  secretariatId!: string;

  /**
   * Unidades do vinculo. Array vazio significa "todas as unidades desta
   * secretaria", conforme o acordo do vinculo; a politica de autorizacao
   * interpreta essa diferenca explicitamente.
   */
  @Column({ type: 'uuid', array: true, default: '{}' })
  unitIds!: string[];

  /**
   * Equipes habilitadas neste vinculo. Vazio significa "nenhuma equipe
   * especifica", o que NAO equivale a "todas": em Saude, conteudo restrito
   * exige equipe habilitada.
   */
  @Column({ type: 'uuid', array: true, default: '{}' })
  teamIds!: string[];

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  /** Explicito: nulo significa vinculo sem data de expiracao. */
  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'uuid', name: 'revoked_by', nullable: true })
  revokedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Concessao excepcional e temporaria (secao 11, `access_grants`).
 *
 * Exige recurso, acao, finalidade registrada e aprovador. Nunca substitui o
 * vinculo: serve para uma acao especifica, com validade definida.
 */
@Entity('access_grants')
@Index('idx_access_grants_user', ['userId'])
export class AccessGrantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'varchar', length: 64, name: 'resource_type' })
  resourceType!: string;

  @Column({ type: 'uuid', name: 'resource_id' })
  resourceId!: string;

  /** Finalidade registrada: obrigatoria e consultavel na auditoria. */
  @Column({ type: 'text' })
  purpose!: string;

  @Column({ type: 'uuid', name: 'approved_by' })
  approvedBy!: string;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;
}

/**
 * Servico do catalogo (secao 3 e 11).
 *
 * O catalogo e CONFIGURAVEL: mudar nome, texto de orientacao ou formulario nao
 * exige alterar codigo. Por isso o catalogo inicial vive em seed, nao em enum.
 */
@Entity('services')
@Index('idx_services_secretariat', ['secretariatId'])
export class ServiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug!: string;

  @Column({ type: 'uuid', name: 'secretariat_id' })
  secretariatId!: string;

  @Column({ type: 'uuid', name: 'default_unit_id', nullable: true })
  defaultUnitId!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Versao publicada de um servico (secao 3 e 11).
 *
 * O pedido congela a versao do formulario usada no momento da abertura, para
 * que uma mudanca futura no catalogo nao altere o registro original.
 */
@Entity('service_versions')
@Index('idx_service_versions_service', ['serviceId', 'version'], { unique: true })
export class ServiceVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'service_id' })
  serviceId!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  /** Texto de orientacao ao cidadao, em linguagem simples. */
  @Column({ type: 'text' })
  guidance!: string;

  /**
   * Formulario dinamico em JSON Schema. A lista de componentes suportados e
   * fechada (secao 3): texto, selecao, data, numero, booleano, localidade e
   * anexo. Nada de JavaScript, HTML ou expressao executavel.
   */
  @Column({ type: 'jsonb' })
  formSchema!: Record<string, unknown>;

  // O tipo de coluna e o ENUM `information_classification`, criado pela
  // migracao. O TypeORM nao reconhece ENUMs personalizados na lista de tipos
  // suportados em tempo de compilacao, entao declaramos como string e o
  // CHECK do banco garante o dominio fechado.
  @Column({ type: 'varchar', length: 32, name: 'classification' })
  classification!: InformationClassification;

  @Column({ type: 'boolean', default: false })
  requiresRepresentation!: boolean;

  @Column({ type: 'integer', name: 'max_attachments' })
  maxAttachments!: number;

  @Column({ type: 'boolean', name: 'published', default: false })
  published!: boolean;

  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Politica de prazo versionada (secao 8 e 11).
 *
 * O pedido congela a politica aplicada. Mudanca excepcional registra motivo,
 * responsavel e valores anteriores.
 */
@Entity('sla_policies')
@Index('idx_sla_policies_version', ['version'], { unique: true })
export class SlaPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'integer', unique: true })
  version!: number;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'integer', name: 'first_response_minutes' })
  firstResponseMinutes!: number;

  @Column({ type: 'integer', name: 'resolution_value' })
  resolutionValue!: number;

  // ENUM `sla_unit`, criado pela migracao. Mesma razao da classificacao: o
  // dominio e garantido pelo ENUM no banco.
  @Column({ type: 'varchar', length: 32, name: 'resolution_unit' })
  resolutionUnit!: SlaUnit;

  @Column({ type: 'text', array: true, name: 'running_states' })
  runningStates!: string[];

  @Column({ type: 'text', array: true, name: 'paused_states' })
  pausedStates!: string[];

  /**
   * `true` apenas quando o municipio validou e publicou o prazo. Sem isso, o
   * prazo aparece como demonstrativo e nao como compromisso oficial
   * (secao 8).
   */
  @Column({ type: 'boolean', name: 'is_published_commitment', default: false })
  isPublishedCommitment!: boolean;

  @Column({ type: 'timestamptz' })
  frozenAt!: Date;
}

/**
 * Registro de mudanca excepcional de prazo, com os valores anteriores
 * (secao 8). Guardar o anterior e obrigatorio: sem ele nao ha como explicar
 * por que um pedido tem um prazo diferente do catalogo atual.
 */
@Entity('sla_policy_changes')
export class SlaPolicyChangeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'policy_id' })
  policyId!: string;

  @Column({ type: 'integer', name: 'from_version' })
  fromVersion!: number;

  @Column({ type: 'integer', name: 'to_version' })
  toVersion!: number;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'uuid', name: 'changed_by' })
  changedBy!: string;

  @Column({ type: 'jsonb', name: 'previous_values' })
  previousValues!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
