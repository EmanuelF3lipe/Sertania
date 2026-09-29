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
import { AuthorizationService } from '../authorization/authorization.service';

/**
 * Modulo de solicitacoes.
 *
 * `AuthorizationService` e provido AQUI e nao no modulo global porque ele le
 * `DataSource` e pertence ao dominio. Disponibiliza-lo como provider separado
 * mantem o modulo de autorizacao reutilizavel por outros modulos de dominio.
 */
@Module({
  controllers: [RequestsController],
  providers: [OpenRequestService, WorkflowService, ProtocolService, AuthorizationService],
  exports: [OpenRequestService, WorkflowService, ProtocolService, AuthorizationService],
})
export class RequestsModule {}
