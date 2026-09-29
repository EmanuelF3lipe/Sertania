/**
 * Uma entidade concreta do registro abaixo.
 *
 * O TypeORM aceita classe de entidade ou `EntitySchema`. Usamos a classe, e o
 * tipo abaixo evita repetir a uniao do tipo em cada anotacao.
 */
type AnyEntity = new (...args: never[]) => object;
import {
  ExternalIdentityEntity,
  UserEntity,
} from './identity.entity';
import {
  SecretariatEntity,
  TeamEntity,
  UnitEntity,
} from './organization.entity';
import {
  AccessGrantEntity,
  MembershipEntity,
  ServiceEntity,
  ServiceVersionEntity,
  SlaPolicyChangeEntity,
  SlaPolicyEntity,
} from './catalog.entity';
import {
  RequestContentEntity,
  RequestEntity,
  RequestLocationEntity,
} from './request.entity';
import {
  EvaluationEntity,
  InformationRequestEntity,
  MessageEntity,
  ReopenRequestEntity,
  RequestCycleEntity,
  RequestEventEntity,
  RequestRelationEntity,
  SlaPauseEntity,
  TaskEntity,
  TransferEntity,
} from './workflow.entity';
import {
  AttachmentAccessEventEntity,
  AttachmentEntity,
  AuditEventEntity,
  ExportJobEntity,
  IdempotencyKeyEntity,
  NotificationDeliveryEntity,
  OutboxEventEntity,
  PrivacyRequestEntity,
} from './operations.entity';

/**
 * Registro unico de entidades.
 *
 * `synchronize: false` na configuracao do TypeORM e a regra que garante que o
 * esquema vem de migracoes versionadas e nunca de um reflexo do codigo.
 */
export const entities: AnyEntity[] = [
  // Identidade
  UserEntity,
  ExternalIdentityEntity,
  // Organizacao
  SecretariatEntity,
  UnitEntity,
  TeamEntity,
  // Catalogo e vinculos
  MembershipEntity,
  AccessGrantEntity,
  ServiceEntity,
  ServiceVersionEntity,
  SlaPolicyEntity,
  SlaPolicyChangeEntity,
  // Solicitacoes
  RequestEntity,
  RequestContentEntity,
  RequestLocationEntity,
  // Ciclo de atendimento
  RequestEventEntity,
  MessageEntity,
  InformationRequestEntity,
  SlaPauseEntity,
  TransferEntity,
  TaskEntity,
  ReopenRequestEntity,
  RequestCycleEntity,
  RequestRelationEntity,
  EvaluationEntity,
  // Operacao
  AttachmentEntity,
  AttachmentAccessEventEntity,
  OutboxEventEntity,
  NotificationDeliveryEntity,
  AuditEventEntity,
  IdempotencyKeyEntity,
  PrivacyRequestEntity,
  ExportJobEntity,
];

export {
  ExternalIdentityEntity,
  UserEntity,
  SecretariatEntity,
  TeamEntity,
  UnitEntity,
  MembershipEntity,
  AccessGrantEntity,
  ServiceEntity,
  ServiceVersionEntity,
  SlaPolicyEntity,
  SlaPolicyChangeEntity,
  RequestEntity,
  RequestContentEntity,
  RequestLocationEntity,
  RequestEventEntity,
  MessageEntity,
  InformationRequestEntity,
  SlaPauseEntity,
  TransferEntity,
  TaskEntity,
  ReopenRequestEntity,
  RequestCycleEntity,
  RequestRelationEntity,
  EvaluationEntity,
  AttachmentEntity,
  AttachmentAccessEventEntity,
  OutboxEventEntity,
  NotificationDeliveryEntity,
  AuditEventEntity,
  IdempotencyKeyEntity,
  PrivacyRequestEntity,
  ExportJobEntity,
};
