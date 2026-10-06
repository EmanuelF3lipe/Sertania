import { describe, expect, it, jest } from '@jest/globals';
import { NotificationsService } from '../src/notifications/notifications.service';
import type { MailService } from '../src/auth/mail.service';
import type { Database, Transaction } from '../src/database/typed-query';

function makeService(email: string | null, sendFails = false) {
  const mail = {
    sendNotification: jest.fn(async () => {
      if (sendFails) throw new Error('SMTP indisponivel');
    }),
  } as unknown as MailService;
  const sendNotification = (mail as unknown as { sendNotification: jest.Mock }).sendNotification;
  const tx = {
    run: jest.fn(async (sql: string) => {
      if (sql.includes('FROM "outbox_events"')) {
        return [
          {
            id: 'event-1',
            type: 'REQUEST_RECEIVED',
            payload: { citizenId: 'citizen-1', protocol: 'SER-2026-000001' },
            attempts: 0,
          },
        ];
      }
      if (sql.includes('UPDATE "outbox_events"')) {
        return [
          {
            id: 'event-1',
            type: 'REQUEST_RECEIVED',
            payload: { citizenId: 'citizen-1', protocol: 'SER-2026-000001' },
            attempts: 1,
          },
        ];
      }
      if (sql.includes('FROM "external_identities"')) return email === null ? [] : [{ email }];
      if (sql.includes('FROM "notification_deliveries"')) return [];
      if (sql.includes('INSERT INTO "notification_deliveries"'))
        return [{ id: 'delivery-1', status: 'PENDING' }];
      return [];
    }),
  } as unknown as Transaction;
  const db = {
    transaction: jest.fn(async (work: (transaction: Transaction) => Promise<unknown>) => work(tx)),
    run: jest.fn(async () => []),
  } as unknown as Database;
  const dbRun = (db as unknown as { run: jest.Mock }).run;
  return {
    service: new NotificationsService(db, mail),
    sendNotification,
    dbRun,
  };
}

describe('NotificationsService', () => {
  it('reserva o evento, envia e marca a entrega como concluida', async () => {
    const fixture = makeService('cidadao@exemplo.invalid');

    await expect(fixture.service.processOne()).resolves.toBe(true);

    expect(fixture.sendNotification).toHaveBeenCalledWith({
      to: 'cidadao@exemplo.invalid',
      subject: 'Solicitacao SER-2026-000001 recebida',
      text: expect.stringContaining('SER-2026-000001'),
    });
    expect(fixture.dbRun).toHaveBeenCalledWith(expect.stringContaining("'SENT'"), ['delivery-1']);
  });

  it('nao tenta SMTP quando o usuario nao possui e-mail', async () => {
    const fixture = makeService(null);

    await expect(fixture.service.processOne()).resolves.toBe(true);

    expect(fixture.sendNotification).not.toHaveBeenCalled();
    expect(fixture.dbRun).toHaveBeenCalledWith(expect.stringContaining("'SKIPPED'"), [
      'USUARIO_SEM_EMAIL',
      'delivery-1',
    ]);
  });

  it('registra falha de SMTP para retentativa posterior', async () => {
    const fixture = makeService('cidadao@exemplo.invalid', true);

    await expect(fixture.service.processOne()).resolves.toBe(true);

    expect(fixture.dbRun).toHaveBeenCalledWith(expect.stringContaining("'FAILED'"), [
      'SMTP indisponivel',
      'delivery-1',
    ]);
  });
});
