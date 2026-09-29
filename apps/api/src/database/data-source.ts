import { DataSource, type DataSourceOptions } from 'typeorm';
import { entities } from './entities';
import { migrations } from './migrations';

/**
 * Fonte de dados usada pelas migrations (especificacao secao 11 e 18).
 *
 * Migrations rodam com conta SEPARADA da aplicacao. A conta da aplicacao nao
 * tem privilegio de superusuario nem direito de alterar estrutura, e por isso
 * nao consegue rodar migracao.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  const isTest = process.env['NODE_ENV'] === 'test';
  return {
    type: 'postgres',
    host: process.env['POSTGRES_HOST'] ?? 'localhost',
    port: Number(process.env['POSTGRES_PORT'] ?? '5432'),
    username: process.env['POSTGRES_MIGRATOR_USER'] ?? process.env['POSTGRES_USER'] ?? 'sertania_app',
    password:
      process.env['POSTGRES_MIGRATOR_PASSWORD'] ?? process.env['POSTGRES_PASSWORD'] ?? '',
    database: process.env['POSTGRES_DB'] ?? 'sertania',
    entities,
    migrations,
    // Nunca sincronizar: o esquema vem de migrations versionadas.
    synchronize: false,
    migrationsRun: false,
    logging: isTest ? false : ['error'],
    ssl: false,
  };
}

/** DataSource para uso da CLI do TypeORM. */
export default new DataSource(buildDataSourceOptions());
