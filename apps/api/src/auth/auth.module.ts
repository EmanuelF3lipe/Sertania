/**
 * Modulo de autenticacao (especificacao secao 12).
 *
 * Concentra o cliente OIDC, o guarda de `state` e as rotas de login. O
 * `SessionService` vem do modulo de infraestrutura, que ja le o Redis.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthorizationStateStore } from './authorization-state.store';
import { OidcService, type OidcSettings } from './oidc.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { MailService } from './mail.service';
import { ServerOnboardingController } from './server-onboarding.controller';
import { ServerOnboardingService } from './server-onboarding.service';

@Module({
  imports: [ConfigModule],
  controllers: [AuthController, ServerOnboardingController],
  providers: [
    AuthorizationStateStore,
    KeycloakAdminService,
    MailService,
    ServerOnboardingService,
    {
      provide: OidcService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OidcService({
          // A URL do Keycloak precisa ser a que o NAVEGADOR acessa. Dentro de
          // um container seria outra, e o redirect voltaria para o lugar errado.
          issuer: config.get<string>('KEYCLOAK_URL', 'http://localhost:8080'),
          clientId: config.get<string>('KEYCLOAK_CLIENT_ID', 'sertania-api'),
          clientSecret: config.get<string>('KEYCLOAK_CLIENT_SECRET', ''),
          redirectUri: config.get<string>(
            'KEYCLOAK_REDIRECT_URI',
            'http://localhost:3000/api/v1/auth/callback',
          ),
          postLogoutRedirectUri: config.get<string>(
            'KEYCLOAK_POST_LOGOUT_REDIRECT_URI',
            'http://localhost:5173/',
          ),
          citizenRealm: config.get<string>('KEYCLOAK_REALM_CITIZENS', 'sertania-ciudadanos'),
          serverRealm: config.get<string>('KEYCLOAK_REALM_SERVERS', 'sertania-servidores'),
          // A biblioteca OIDC recusa HTTP, e com razao. A excecao existe
          // porque o Keycloak local nao tem certificado, e e derivada do
          // ambiente JA VALIDADO: em `production` o validador exige HTTPS e
          // rejeita as credenciais de demonstracao, entao o valor nunca chega
          // a ser ligado la. Ler `NODE_ENV` direto, e nao uma variavel nova,
          // evita que a excecao seja habilitada por engano.
          allowInsecureRequests: config.get<string>('NODE_ENV', 'production') !== 'production',
        } satisfies OidcSettings),
    },
  ],
  exports: [OidcService, AuthorizationStateStore],
})
export class AuthModule {}
