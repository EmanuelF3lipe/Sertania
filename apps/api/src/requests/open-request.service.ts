/**
 * Caso de uso: abrir uma solicitacao (especificacao secao 6 e 16).
 *
 * Decisoes que sustentam este arquivo:
 *
 * 1. O protocolo e reservado NA MESMA TRANSACAO que grava a solicitacao. Se o
 *    commit falhar, o numero fica reservado e a sequencia pula um valor. E
 *    melhor que duplicar protocolo: ninguem recebe dois numeros iguais.
 *
 * 2. A chave de idempotencia e gravada na mesma transacao. Uma retentativa
 *    devolve o protocolo ja criado em vez de abrir um segundo pedido.
 *
 * 3. Nao existe `PATCH /requests/{id}` que aceite status. As transicoes passam
 *    pelo caso de uso de workflow, que valida contra a tabela de regras.
 *
 * 4. A versao do servico e CONGELADA no pedido. Mudanca futura no catalogo nao
 *    altera o registro original.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  classifyIdempotencyLookup,
  hashRequestPayload,
  idempotencyExpiry,
  isValidIdempotencyKey,
  newRequestId,
  type InformationClassification,
  type RequestChannel,
  type WorkflowCommand,
  canTransition,
  targetStateFor,
  type RequestState,
  TRANSITION_RULES,
} from '@sertania/contracts';
import { ProtocolService } from './protocol.service';
import { Transaction } from '../database/typed-query';

export interface OpenRequestInput {
  readonly citizenId: string;
  readonly createdBy: string;
  readonly channel: RequestChannel;
  readonly serviceVersionId: string;
  readonly secretariatId: string;
  readonly unitId: string;
  readonly slaPolicyId: string;
  readonly classification: InformationClassification;
  readonly description: string;
  readonly formAnswers: Record<string, unknown>;
  readonly location?: {
    readonly addressText: string;
    readonly reference?: string;
    readonly locality?: string;
    readonly latitude?: number;
    readonly longitude?: number;
    readonly precisionSource: 'MAP_PICK' | 'TYPED' | 'GEOCODED' | 'UNKNOWN';
    readonly precisionMeters?: number;
  } | null;
  readonly identityVerificationMethod?: string | null;
  readonly assistedNote?: string | null;
}

export type OpenRequestResult =
  | {
      readonly outcome: 'CREATED';
      readonly requestId: string;
      readonly protocol: string;
      readonly state: RequestState;
      readonly submittedAt: Date;
    }
  | {
      readonly outcome: 'REPLAYED';
      readonly requestId: string;
      readonly protocol: string;
      readonly state: RequestState;
      readonly submittedAt: Date;
    }
  | { readonly outcome: 'IN_FLIGHT' }
  | { readonly outcome: 'IDEMPOTENCY_MISMATCH' };

@Injectable()
export class OpenRequestService {
  private readonly logger = new Logger(OpenRequestService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly protocol: ProtocolService,
  ) {}

  /**
   * Abre a solicitacao. Tudo numa transacao: chave, protocolo, pedido,
   * conteudo, local e evento de criacao.
   */
  async open(input: OpenRequestInput, idempotencyKey: string | undefined, now: Date): Promise<OpenRequestResult> {
    const operation = 'REQUEST_OPEN';
    const requestHash = hashRequestPayload(input);

    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
      throw new Error('Chave de idempotencia invalida');
    }

    return this.dataSource.transaction(async (manager) => {
      // A transacao usa o mesmo wrapper tipado do resto da aplicacao, para que
      // o compilador continue protegendo o codigo depois do banco.
      const tx = new Transaction(manager);

      // 1. Chave de idempotencia.
      //
      //    A reserva acontece ANTES de qualquer leitura, e de forma atomica.
      //    A versao anterior consultava com `SELECT ... FOR UPDATE` e so
      //    depois gravava: `FOR UPDATE` nao trava nada quando a linha AINDA
      //    NAO EXISTE, entao N envios simultaneos com a mesma chave passavam
      //    todos pela consulta vazia e criavam N pedidos. O teste de
      //    concorrencia pegou isso: 8 envios produziram 7 pedidos.
      //
      //    `ON CONFLICT DO NOTHING` faz o banco decidir quem cria a linha. O
      //    perdedor recebe `false` e pode entao ler a linha ja reservada.
      if (idempotencyKey !== undefined) {
        const reserva = await tx.run(
          `INSERT INTO "idempotency_keys"
             ("user_id","operation","key","request_hash","expires_at","created_at")
           VALUES ($1,$2,$3,$4,$5, now())
           ON CONFLICT ("user_id","operation","key") DO NOTHING
           RETURNING "key"`,
          [input.citizenId, operation, idempotencyKey, requestHash, idempotencyExpiry(now)],
        );

        if (reserva.length === 0) {
          // A chave ja existia. `SELECT ... FOR UPDATE` agora segura a linha
          // de verdade, porque ela existe.
          const existing = await tx.run(
            `SELECT "key", "request_hash", "result_entity_id", "expires_at"
               FROM "idempotency_keys"
              WHERE "user_id" = $1 AND "operation" = $2 AND "key" = $3
              FOR UPDATE`,
            [input.citizenId, operation, idempotencyKey],
          );

          const row = existing[0];
          if (row === undefined) {
            throw new Error('Reserva de idempotencia falhou sem linha de conflito');
          }

          const classification = classifyIdempotencyLookup({
            found: true,
            storedHash: row['request_hash'] as string,
            requestHash,
            resultEntityId: (row['result_entity_id'] as string | null) ?? null,
            // O driver devolve `timestamptz` como texto, e nao como `Date`.
            expiresAt: new Date(String(row['expires_at'])),
            now,
          });

          if (classification.kind === 'MISMATCH') {
            // Reuso de chave com corpo diferente e erro do cliente, e nao
            // falha de infraestrutura. O cliente precisa gerar chave nova.
            this.logger.warn('Chave de idempotencia reusada com corpo diferente');
            return { outcome: 'IDEMPOTENCY_MISMATCH' };
          }
          if (classification.kind === 'IN_FLIGHT') {
            return { outcome: 'IN_FLIGHT' };
          }
          if (classification.kind === 'REPLAY') {
            const previous = await this.loadRequest(tx, classification.resultEntityId);
            if (previous !== null) {
              this.logger.log(`Retentativa devolve o protocolo ${previous.protocol}`);
              return {
                outcome: 'REPLAYED',
                requestId: previous.id,
                protocol: previous.protocol,
                state: previous.state,
                submittedAt: previous.submitted_at,
              };
            }
          }
          // NEW com chave existente significa chave expirada: a linha e
          // reescrita abaixo, sob o lock que a leitura com `FOR UPDATE`
          // acabou de obter.
          const reescrita = await tx.run(
            `UPDATE "idempotency_keys"
                SET "request_hash" = $4, "result_entity_id" = NULL, "expires_at" = $5
              WHERE "user_id" = $1 AND "operation" = $2 AND "key" = $3`,
            [input.citizenId, operation, idempotencyKey, requestHash, idempotencyExpiry(now)],
          );
          if (reescrita.length === 0) {
            throw new Error('Chave expirada nao pode ser reaproveitada');
          }
        }
        // Se a reserva foi feita acima, a linha ja existe com o hash certo e
        // nao precisa de nenhuma escrita.
      }

      // 2. Protocolo, na mesma transacao do pedido.
      const protocol = await this.protocol.nextProtocol(tx, now);
      const requestId = newRequestId();

      // 3. Pedido. O estado inicial e SUBMITTED: o protocolo ja nasce no
      //    envio, e um rascunho nao recebe protocolo.
      const inserted = await tx.run(
        `INSERT INTO "requests"
           ("id","protocol","citizen_id","created_by","channel","service_version_id",
            "secretariat_id","unit_id","state","classification","sla_policy_id",
            "submitted_at","cycle_started_at","version",
            "identity_verification_method","assisted_note","created_at","updated_at")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SUBMITTED',$9,$10, $11,$11, 1, $12,$13, $11,$11)
         RETURNING "id","protocol","state","submitted_at"`,
        [
          requestId,
          protocol,
          input.citizenId,
          input.createdBy,
          input.channel,
          input.serviceVersionId,
          input.secretariatId,
          input.unitId,
          input.classification,
          input.slaPolicyId,
          now,
          input.identityVerificationMethod ?? null,
          input.assistedNote ?? null,
        ],
      );

      // 4. Conteudo. Descricao e respostas do formulario na versao congelada.
      await tx.run(
        `INSERT INTO "request_content" ("request_id","description","form_answers")
         VALUES ($1,$2,$3)`,
        [requestId, input.description, JSON.stringify(input.formAnswers)],
      );

      // 5. Local, quando informado. A coordenada e opcional e validada antes
      //    de chegar aqui.
      if (input.location !== null && input.location !== undefined) {
        const point =
          input.location.latitude !== undefined && input.location.longitude !== undefined
            ? `SRID=4326;POINT(${input.location.longitude} ${input.location.latitude})`
            : null;
        await tx.run(
          `INSERT INTO "request_locations"
             ("request_id","address_text","reference","locality","point",
              "precision_source","precision_meters")
           VALUES ($1,$2,$3,$4, $5::geography, $6, $7)`,
          [
            requestId,
            input.location.addressText,
            input.location.reference ?? null,
            input.location.locality ?? null,
            point,
            input.location.precisionSource,
            input.location.precisionMeters ?? null,
          ],
        );
      }

      // 6. Ciclo de atendimento, para medir o tempo por ciclo.
      await tx.run(
        `INSERT INTO "request_cycles" ("request_id","cycle_number","started_at","from_reopen")
         VALUES ($1, 1, $2, false)`,
        [requestId, now],
      );

      // 7. Evento visivel ao cidadao. O primeiro texto precisa explicar o
      //    proximo passo, nao apenas dizer que o sistema recebeu.
      await tx.run(
        `INSERT INTO "request_events"
           ("request_id","actor_user_id","type","visibility","state_before","state_after",
            "public_text","cycle_number","created_at")
         VALUES ($1,$2,'SUBMITTED','CITIZEN_VISIBLE', NULL, 'SUBMITTED', $3, 1, $4)`,
        [
          requestId,
          input.createdBy,
          `Solicitacao registrada com o protocolo ${protocol}. Voce pode acompanhar o andamento por aqui.`,
          now,
        ],
      );

      // 8. Outbox, na MESMA transacao. A falha de e-mail depois nao desfaz o
      //    protocolo ja confirmado.
      await tx.run(
        `INSERT INTO "outbox_events" ("type","payload","idempotency_key","created_at")
         VALUES ('REQUEST_RECEIVED', $1, $2, $3)`,
        [
          JSON.stringify({ requestId, protocol, citizenId: input.citizenId }),
          `REQUEST_RECEIVED:${requestId}`,
          now,
        ],
      );

      // 9. Liga o resultado a chave, para a retentativa futura.
      if (idempotencyKey !== undefined) {
        await tx.run(
          `UPDATE "idempotency_keys" SET "result_entity_id" = $1
            WHERE "user_id" = $2 AND "operation" = $3 AND "key" = $4`,
          [requestId, input.citizenId, operation, idempotencyKey],
        );
      }

      const row = inserted[0];
      if (row === undefined) throw new Error('Insercao de solicitacao nao devolveu linha');
      this.logger.log(`Solicitacao ${protocol} aberta para o cidadao ${input.citizenId}`);

      return {
        outcome: 'CREATED',
        requestId: row['id'] as string,
        protocol: row['protocol'] as string,
        state: row['state'] as RequestState,
        submittedAt: now,
      };
    });
  }

  private async loadRequest(
    tx: Transaction,
    requestId: string,
  ): Promise<{ id: string; protocol: string; state: RequestState; submitted_at: Date } | null> {
    const rows = await tx.run(
      `SELECT "id","protocol","state","submitted_at" FROM "requests" WHERE "id" = $1`,
      [requestId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row['id'] as string,
      protocol: row['protocol'] as string,
      state: row['state'] as RequestState,
      // `timestamptz` volta como texto do driver.
      submitted_at: new Date(String(row['submitted_at'])),
    };
  }
}

/**
 * Validador de transicoes, exposto para os casos de uso de workflow.
 *
 * Existe como funcao separada para que a regra possa ser testada sem banco e
 * para deixar explicito que a tabela de `@sertania/contracts` e a unica fonte
 * de verdade sobre transicoes possiveis.
 */
export function assertTransitionAllowed(state: RequestState, command: WorkflowCommand): RequestState {
  if (!canTransition(state, command)) {
    throw new Error(`Comando ${command} nao e valido a partir do estado ${state}`);
  }
  const target = targetStateFor(state, command);
  if (target === null) {
    throw new Error(`Destino indefinido para ${command} em ${state}`);
  }
  return target;
}

export { TRANSITION_RULES };
