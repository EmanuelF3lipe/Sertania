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

@Module({
  controllers: [RequestsController],
  providers: [OpenRequestService, WorkflowService, ProtocolService],
  exports: [OpenRequestService, WorkflowService, ProtocolService],
})
export class RequestsModule {}
