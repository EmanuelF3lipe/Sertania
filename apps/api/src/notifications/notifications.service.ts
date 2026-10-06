import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../auth/mail.service';
import { Database, type Row, type Transaction } from '../database/typed-query';

const MAX_ATTEMPTS = 5;

interface OutboxRow extends Row {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly attempts: number | string;
}

interface DeliveryRow extends Row {
  readonly id: string;
  readonly status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
}

interface NotificationJob {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly deliveryId: string;
  readonly recipient: string | null;
}

/**
 * Consumidor da outbox transacional.
 *
 * O evento e reservado em uma transacao curta com `FOR UPDATE SKIP LOCKED`.
 * O SMTP fica FORA da transacao: uma indisponibilidade de e-mail nao prende a
 * conexao nem desfaz o protocolo ja confirmado.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: Database,
    private readonly mail: MailService,
  ) {}

  /** Processa no maximo um evento pronto. Retorna `false` quando a fila esta vazia. */
  async processOne(): Promise<boolean> {
    const job = await this.claimOne();
    if (job === null) return false;

    if (job.recipient === null) {
      await this.finishSkipped(job, 'USUARIO_SEM_EMAIL');
      return true;
    }

    try {
      const message = this.messageFor(job);
      await this.mail.sendNotification({
        to: job.recipient,
        subject: message.subject,
        text: message.text,
      });
      await this.finishSent(job);
    } catch (error) {
      await this.finishFailed(job, error instanceof Error ? error.message : 'Falha de envio');
    }
    return true;
  }

  private async claimOne(): Promise<NotificationJob | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.run<OutboxRow>(
        `SELECT "id","type","payload","attempts"
           FROM "outbox_events"
          WHERE "processed_at" IS NULL
            AND "available_at" <= now()
            AND "attempts" < $1
          ORDER BY "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        [MAX_ATTEMPTS],
      );
      const event = rows[0];
      if (event === undefined) return null;

      const updated = await tx.run<OutboxRow>(
        `UPDATE "outbox_events"
            SET "attempts" = "attempts" + 1,
                "available_at" = now() + interval '1 minute'
          WHERE "id" = $1
        RETURNING "id","type","payload","attempts"`,
        [event.id],
      );
      const claimed = updated[0] ?? event;
      const payload = asPayload(claimed.payload);
      const recipient = await this.recipientFor(tx, payload['citizenId']);

      const existing = await tx.run<DeliveryRow>(
        `SELECT "id","status" FROM "notification_deliveries"
          WHERE "outbox_event_id" = $1 AND "channel" = 'EMAIL'
          ORDER BY "created_at" DESC LIMIT 1`,
        [claimed.id],
      );
      const previous = existing[0];
      if (previous?.status === 'SENT') {
        await tx.run(`UPDATE "outbox_events" SET "processed_at" = now() WHERE "id" = $1`, [
          claimed.id,
        ]);
        return null;
      }

      const delivery = previous ?? (await this.createDelivery(tx, claimed.id));
      return {
        id: claimed.id,
        type: claimed.type,
        payload,
        attempts: Number(claimed.attempts),
        deliveryId: delivery.id,
        recipient,
      };
    });
  }

  private async recipientFor(tx: Transaction, citizenId: unknown): Promise<string | null> {
    if (typeof citizenId !== 'string') return null;
    const rows = await tx.run<{ email: string | null }>(
      `SELECT "email" FROM "external_identities"
        WHERE "user_id" = $1 AND "email" IS NOT NULL
        ORDER BY "created_at" ASC LIMIT 1`,
      [citizenId],
    );
    const email = rows[0]?.email;
    return typeof email === 'string' && email.trim() !== '' ? email : null;
  }

  private async createDelivery(tx: Transaction, eventId: string): Promise<DeliveryRow> {
    const rows = await tx.run<DeliveryRow>(
      `INSERT INTO "notification_deliveries" ("outbox_event_id","channel","status")
       VALUES ($1,'EMAIL','PENDING') RETURNING "id","status"`,
      [eventId],
    );
    const delivery = rows[0];
    if (delivery === undefined) throw new Error('Entrega de notificacao nao foi registrada');
    return delivery;
  }

  private messageFor(job: NotificationJob): { subject: string; text: string } {
    if (job.type === 'REQUEST_RECEIVED') {
      const protocol =
        typeof job.payload['protocol'] === 'string' ? job.payload['protocol'] : 'seu protocolo';
      return {
        subject: `Solicitacao ${protocol} recebida`,
        text: `A Prefeitura de Sertania recebeu sua solicitacao ${protocol}. Acompanhe o andamento pela plataforma.`,
      };
    }
    throw new Error(`Tipo de notificacao nao suportado: ${job.type}`);
  }

  private async finishSent(job: NotificationJob): Promise<void> {
    await this.db.run(
      `UPDATE "notification_deliveries"
          SET "status" = 'SENT', "sent_at" = now(), "error" = NULL
        WHERE "id" = $1`,
      [job.deliveryId],
    );
    await this.db.run(
      `UPDATE "outbox_events"
          SET "processed_at" = now(), "last_error" = NULL
        WHERE "id" = $1`,
      [job.id],
    );
  }

  private async finishSkipped(job: NotificationJob, reason: string): Promise<void> {
    await this.db.run(
      `UPDATE "notification_deliveries" SET "status" = 'SKIPPED', "error" = $1 WHERE "id" = $2`,
      [reason, job.deliveryId],
    );
    await this.db.run(
      `UPDATE "outbox_events" SET "processed_at" = now(), "last_error" = $1 WHERE "id" = $2`,
      [reason, job.id],
    );
  }

  private async finishFailed(job: NotificationJob, reason: string): Promise<void> {
    const terminal = job.attempts >= MAX_ATTEMPTS;
    await this.db.run(
      `UPDATE "notification_deliveries" SET "status" = 'FAILED', "error" = $1 WHERE "id" = $2`,
      [reason.slice(0, 1000), job.deliveryId],
    );
    await this.db.run(
      `UPDATE "outbox_events"
          SET "processed_at" = CASE WHEN $2::boolean THEN now() ELSE NULL END,
              "last_error" = $1,
              "available_at" = CASE WHEN $2::boolean THEN "available_at" ELSE now() + interval '5 minutes' END
        WHERE "id" = $3`,
      [reason.slice(0, 1000), terminal, job.id],
    );
    this.logger.warn(`Falha na notificacao ${job.id}; tentativa ${job.attempts}/${MAX_ATTEMPTS}`);
  }
}

function asPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
