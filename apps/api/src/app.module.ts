/**
 * Modulo raiz da API (especificacao secao 10).
 *
 * O backend e UMA aplicacao organizada em modulos, nao um microsservico por
 * secretaria. Os modulos de dominio sao registrados aqui conforme forem
 * implementados; `integrations` e `ai` entram so quando a funcionalidade
 * existir de fato.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { resolve } from 'node:path';
import { validateEnvironment } from './config/environment';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { RequestsModule } from './requests/requests.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagesModule } from './messages/messages.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { SessionGuard } from './auth/session.guard';
import { SessionService, CsrfService } from './auth/session.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // O `.env` e lido aqui. A validacao falha cedo se faltar segredo ou se
      // um valor de demonstracao escapar para um ambiente real.
      // O script do pnpm roda com `apps/api` como cwd, enquanto o ambiente
      // compartilhado fica na raiz do monorepo. Resolver pelo arquivo compilado
      // mantém `pnpm start`, `node dist/main.js` e o modo local consistentes.
      envFilePath: [resolve(__dirname, '../../../.env'), '.env'],
      validate: validateEnvironment,
    }),
    InfrastructureModule,
    RequestsModule,
    AuthModule,
    CatalogModule,
    AttachmentsModule,
    NotificationsModule,
    MessagesModule,
    EvaluationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      inject: [Reflector, SessionService, CsrfService, ConfigService],
      useFactory: (
        reflector: Reflector,
        sessions: SessionService,
        csrf: CsrfService,
        config: ConfigService,
      ) => {
        const publicOrigin = config.get<string>('PUBLIC_ORIGIN', 'http://localhost:5173');
        return new SessionGuard(reflector, sessions, csrf, [publicOrigin]);
      },
    },
  ],
})
export class AppModule {}
