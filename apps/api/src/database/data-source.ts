import { DataSource, type DataSourceOptions } from 'typeorm';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { entities } from './entities';
import { migrations } from './migrations';

/**
 * A CLI do TypeORM nao passa pelo ConfigModule do NestJS. Carregar o arquivo
 * aqui deixa `pnpm db:migrate` e `pnpm db:revert` usarem a mesma configuracao
 * do `iniciar-app.bat`, sem sobrescrever variaveis ja fornecidas pelo shell.
 */
function carregarAmbienteLocal(): void {
  const candidatos = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../../../.env'),
  ];
  const arquivo = candidatos.find((candidato) => existsSync(candidato));
  if (arquivo !== undefined) process.loadEnvFile(arquivo);
}

carregarAmbienteLocal();

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
