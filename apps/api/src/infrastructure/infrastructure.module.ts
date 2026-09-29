/**
 * Modulo de infraestrutura: banco, sessao, armazenamento e antivírus.
 *
 * As configuracoes vem do ConfigModule, ja validado na inicializacao. Nenhum
 * segredo tem valor padrao em codigo: se faltar, a aplicacao nao sobe.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { entities } from '../database/entities';
import { ProtocolService } from '../requests/protocol.service';
import { Database } from '../database/typed-query';
import { AuthorizationService } from '../authorization/authorization.service';
import { RedisSessionStore, createRedisClient } from '../auth/redis-session.store';
import { SessionService, CsrfService } from '../auth/session.service';
import { S3StorageClient, type StorageConfig } from '../storage/s3-storage.client';
import { ClamAvClient, type ClamAvConfig } from '../storage/clamav.client';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get<string>('POSTGRES_USER') ?? '',
        password: config.get<string>('POSTGRES_PASSWORD') ?? '',
        database: config.get<string>('POSTGRES_DB', 'sertania'),
        entities,
        // Regra dura: o esquema vem de migracoes versionadas.
        synchronize: false,
        migrationsRun: false,
        logging: config.get<string>('LOG_LEVEL') === 'debug' ? (['error', 'warn'] as const) : (['error'] as const),
        extra: { max: 10 },
      }),
    }),
  ],
  providers: [
    {
      provide: 'REDIS_SESSION',
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        createRedisClient(config.get<string>('REDIS_SESSION_URL', 'redis://localhost:6379/0')),
    },
    {
      provide: RedisSessionStore,
      inject: ['REDIS_SESSION'],
      useFactory: (redis: Redis) => new RedisSessionStore(redis),
    },
    {
      provide: SessionService,
      inject: [RedisSessionStore, ConfigService, Database],
      useFactory: (store: RedisSessionStore, config: ConfigService, database: Database) =>
        new SessionService(
          store,
          config.get<string>('SESSION_SECRET') ?? '',
          config.get<number>('SESSION_IDLE_TTL_SECONDS', 1200),
          config.get<number>('SESSION_ABSOLUTE_TTL_SECONDS', 28800),
          async () => {
            const rows = await database.run<{ value: string }>(
              `SELECT "value" FROM "system_settings" WHERE "key" = 'server_session_absolute_ttl_seconds'`,
            );
            const value = Number(rows[0]?.value);
            return Number.isInteger(value) && value > 0
              ? value
              : config.get<number>('SESSION_ABSOLUTE_TTL_SECONDS', 28800);
          },
        ),
    },
    {
      provide: CsrfService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new CsrfService(config.get<string>('SESSION_SECRET') ?? ''),
    },
    {
      provide: S3StorageClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3StorageClient({
          endpoint: config.get<string>('S3_ENDPOINT', 'http://localhost:9000'),
          region: config.get<string>('S3_REGION', 'us-east-1'),
          accessKey: config.get<string>('S3_ACCESS_KEY', ''),
          secretKey: config.get<string>('S3_SECRET_KEY', ''),
          forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true',
          quarantineBucket: config.get<string>('S3_BUCKET_QUARANTINE', 'sertania-quarantine'),
          documentsBucket: config.get<string>('S3_BUCKET_DOCUMENTS', 'sertania-documents'),
        } satisfies StorageConfig),
    },
    {
      provide: ClamAvClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ClamAvClient({
          host: config.get<string>('CLAMAV_HOST', 'localhost'),
          port: config.get<number>('CLAMAV_PORT', 3310),
          timeoutMs: config.get<number>('CLAMAV_TIMEOUT_MS', 30000),
          maxBytes: 10 * 1024 * 1024,
        } satisfies ClamAvConfig),
    },
    ProtocolService,
    // `Database` e `AuthorizationService` ficam AQUI, e nao em cada modulo de
    // dominio, porque sao `@Injectable` com estado: cada registro de provider
    // cria uma instancia nova, ou seja, um segundo pool de conexoes e uma
    // segunda leitura de vinculos. Este modulo e global e configura o
    // `DataSource`, entao e o lugar natural para as duas.
    Database,
    AuthorizationService,
  ],
  exports: [
    TypeOrmModule,
    'REDIS_SESSION',
    RedisSessionStore,
    SessionService,
    CsrfService,
    S3StorageClient,
    ClamAvClient,
    ProtocolService,
    Database,
    AuthorizationService,
  ],
})
export class InfrastructureModule {}
