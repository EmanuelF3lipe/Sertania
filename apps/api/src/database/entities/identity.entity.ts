import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Identidade interna da aplicacao (especificacao secao 11).
 *
 * Nao existe senha local: a autenticacao e do Keycloak. Esta tabela guarda o
 * estado do usuario na aplicacao, e `external_identities` guarda o vinculo com
 * o provedor.
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Estado do usuario na aplicacao. Um usuario desativado nao autentic nem
   * recebe permissao, mesmo com vinculo ativo no banco.
   */
  @Column({ type: 'varchar', length: 32, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';

  /**
   * `true` quando existe conta de cidadao associada. A mesma pessoa pode ter
   * conta de cidadao e de servidor, sem association automatica por e-mail ou
   * CPF (secao 4).
   */
  @Column({ type: 'boolean', default: false })
  isCitizen!: boolean;

  @Column({ type: 'boolean', default: false })
  isServer!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * Vinculo com o provedor de identidade (secao 11).
 *
 * A unicidade em `issuer` + `subject` garante que um mesmo emissor nao mapeie
 * dois usuarios internos para a mesma identidade externa. Nao confiar apenas em
 * e-mail: dois provedores podem afirmar o mesmo endereco.
 */
@Entity('external_identities')
@Index('uq_external_identities_issuer_subject', ['issuer', 'subject'], { unique: true })
export class ExternalIdentityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  issuer!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  /** Realm do Keycloak que autenticou: distingue cidadao de servidor. */
  @Column({ type: 'varchar', length: 128, name: 'realm' })
  realm!: string;

  /**
   * E-mail, se o provedor o fornecer. Guardado para contato, nunca como
   * identidade nem como credencial.
   */
  @Column({ type: 'varchar', length: 320, nullable: true })
  email!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
