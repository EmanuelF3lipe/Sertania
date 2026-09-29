/**
 * Modulo de solicitacoes (especificacao secao 10).
 *
 * Controllers recebem DTOs e chamam casos de uso. Regras de negocio e
 * autorizacao ficam em servicos testaveis; os repositorios aplicam os filtros
 * de escopo.
 */
import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { OpenRequestService } from './open-request.service';
import { WorkflowService } from './workflow.service';
import { ProtocolService } from './protocol.service';
import { Database } from '../database/typed-query';
import { AuthorizationService } from '../authorization/authorization.service';

/**
 * Modulo de solicitacoes.
 *
 * `Database` e `AuthorizationService` sao providos AQUI e nao no modulo global:
 * pertencem ao dominio e dependem do `DataSource`, que o modulo global
 * configura. Disponibiliza-los como provider separado mantem o modulo de
 * autorizacao reutilizavel por outros modulos de dominio.
 */
@Module({
  controllers: [RequestsController],
  providers: [
    OpenRequestService,
    WorkflowService,
    ProtocolService,
    Database,
    AuthorizationService,
  ],
  exports: [
    OpenRequestService,
    WorkflowService,
    ProtocolService,
    Database,
    AuthorizationService,
  ],
})
export class RequestsModule {}
