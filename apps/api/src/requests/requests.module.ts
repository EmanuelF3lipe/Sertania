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

/**
 * Modulo de solicitacoes.
 *
 * `Database` e `AuthorizationService` vem do modulo global de infraestrutura,
 * que ja os registra. Declara-los aqui criaria uma segunda instancia de cada
 * um, com um segundo pool de conexoes e uma segunda leitura de vinculos.
 */
@Module({
  controllers: [RequestsController],
  providers: [
    OpenRequestService,
    WorkflowService,
    ProtocolService,
  ],
  exports: [
    OpenRequestService,
    WorkflowService,
    ProtocolService,
  ],
})
export class RequestsModule {}
