import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Estrutura organizacional (especificacao secao 11).
 *
 * Secretarias sao REGISTROS, nao tabelas separadas. Uma prefeitura com
 * quatro secretarias tem quatro linhas, nao quatro schemas.
 */
@Entity('secretariats')
export class SecretariatEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Unidade de trabalho. Sempre pertence a uma secretaria: a restricao
 * `unit_belongs_to_secretariat` e garantida por chave estrangeira composta
 * (secao 11).
 */
@Entity('units')
@Index('idx_units_secretariat', ['secretariatId'])
export class UnitEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'secretariat_id' })
  secretariatId!: string;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  locality!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Equipe habilitada a tratar um servico.
 *
 * A especificacao (secao 4) determina que, em Saude, o nome da secretaria nao
 * autoriza acesso indiscriminado: equipes e unidades sao habilitadas
 * explicitamente. Esta tabela e essa habilitacao.
 */
@Entity('teams')
@Index('idx_teams_unit', ['unitId'])
export class TeamEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'unit_id' })
  unitId!: string;

  @Column({ type: 'uuid', name: 'secretariat_id' })
  secretariatId!: string;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  /**
   * Servicos que esta equipe pode tratar. Equipe habilitada em um servico
   * nao ganha acesso automatico aos demais.
   */
  @Column({ type: 'text', array: true, default: '{}' })
  enabledServiceSlugs!: string[];

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
