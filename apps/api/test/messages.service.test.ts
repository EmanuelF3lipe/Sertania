import { describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { SessionClaims } from '../src/auth/session.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { Database } from '../src/database/typed-query';
import { MessagesService } from '../src/messages/messages.service';

const SESSION: SessionClaims = {
  userId: '00000000-0000-0000-0000-000000000001',
  realm: 'sertania-ciudadanos',
  isCitizen: true,
  isServer: false,
  membershipId: null,
  secretariatId: null,
  absoluteExpiresAt: Date.now() + 60_000,
  createdAt: Date.now(),
  generation: 1,
};

const TARGET = {
  requestId: '00000000-0000-0000-0000-000000000010',
  ownerCitizenId: SESSION.userId,
  assigneeUserId: undefined,
  secretariatId: '00000000-0000-0000-0000-000000000020',
  unitId: '00000000-0000-0000-0000-000000000030',
  classification: 'PUBLIC_APPROVED' as const,
  state: 'WAITING_CITIZEN' as const,
};

function makeService() {
  let stored: Record<string, unknown> | null = null;
  const db = {
    run: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO "messages"')) {
        stored = {
          id: 'message-1',
          author_user_id: params[1],
          visibility: params[2],
          body_ciphertext: params[3],
          key_version: params[4],
          created_at: '2026-09-29T16:00:00.000Z',
        };
        return [stored];
      }
      if (sql.includes('FROM "messages"')) return stored === null ? [] : [stored];
      return [];
    }),
  } as unknown as Database;
  const requestTarget = jest.fn(async () => TARGET);
  const check = jest.fn(async () => ({ allowed: true as const, reason: 'AUTORIZADO' as const }));
  const audit = jest.fn(async () => undefined);
  const authorization = { requestTarget, check, audit } as unknown as AuthorizationService;
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'SESSION_SECRET' ? 's'.repeat(32) : fallback,
    ),
  } as unknown as ConfigService;
  return {
    service: new MessagesService(db, authorization, config),
    audit: (authorization as unknown as { audit: jest.Mock }).audit,
  };
}

describe('MessagesService', () => {
  it('cifra ao gravar e devolve o texto descriptografado ao listar', async () => {
    const fixture = makeService();

    const sent = await fixture.service.send({
      requestId: TARGET.requestId,
      body: '  Encontrei o documento solicitado.  ',
      visibility: undefined,
      session: SESSION,
      correlationId: 'corr-1',
    });
    const listed = await fixture.service.list({
      requestId: TARGET.requestId,
      session: SESSION,
      correlationId: 'corr-2',
    });

    expect(sent.body).toBe('Encontrei o documento solicitado.');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.body).toBe('Encontrei o documento solicitado.');
    expect(fixture.audit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'message' }),
    );
  });

  it('nao permite que cidadao envie mensagem interna', async () => {
    const fixture = makeService();

    await expect(
      fixture.service.send({
        requestId: TARGET.requestId,
        body: 'tentativa',
        visibility: 'INTERNAL_ONLY',
        session: SESSION,
        correlationId: 'corr-3',
      }),
    ).rejects.toThrow(/Cidadao/);
  });

  it('rejeita mensagem vazia e texto acima do limite', async () => {
    const fixture = makeService();

    await expect(
      fixture.service.send({
        requestId: TARGET.requestId,
        body: '   ',
        visibility: undefined,
        session: SESSION,
        correlationId: 'corr-4',
      }),
    ).rejects.toThrow(/Escreva/);
    await expect(
      fixture.service.send({
        requestId: TARGET.requestId,
        body: 'x'.repeat(5_001),
        visibility: undefined,
        session: SESSION,
        correlationId: 'corr-5',
      }),
    ).rejects.toThrow(/5000/);
  });
});
