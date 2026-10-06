import { describe, expect, it, jest } from '@jest/globals';
import { AttachmentsService } from '../src/attachments/attachments.service';
import type { SessionClaims } from '../src/auth/session.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { Database, Transaction } from '../src/database/typed-query';
import type { ClamAvClient, ScanResult } from '../src/storage/clamav.client';
import type { S3StorageClient } from '../src/storage/s3-storage.client';

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
  classification: 'RESTRICTED_PERSONAL' as const,
  state: 'SUBMITTED' as const,
};

function jpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function makeService(verdict: ScanResult['verdict']) {
  const calls: Array<{ bucket: string; key: string }> = [];
  const storage = {
    buckets: ['quarantine', 'documents'],
    putObject: jest.fn(async (input: { bucket: string; key: string }) => {
      calls.push(input);
    }),
    deleteObject: jest.fn(async () => undefined),
  } as unknown as S3StorageClient;
  const deleteObject = (storage as unknown as { deleteObject: jest.Mock }).deleteObject;
  const clamav = {
    scan: jest.fn(
      async (): Promise<ScanResult> => ({
        verdict,
        signature: verdict === 'INFECTED' ? 'Eicar-Test-Signature' : null,
        detail: verdict,
      }),
    ),
  } as unknown as ClamAvClient;
  const insertedId = '00000000-0000-0000-0000-000000000099';
  const transaction = jest.fn(async (work: (tx: Transaction) => Promise<string>) => {
    const tx = {
      run: jest.fn(async (sql: string) => (sql.includes('RETURNING') ? [{ id: insertedId }] : [])),
    } as unknown as Transaction;
    return work(tx);
  });
  const db = {
    count: jest.fn(async () => 0),
    run: jest.fn(async () => [{ max_attachments: 5 }]),
    transaction,
  } as unknown as Database;
  const authorization = {
    requestTarget: jest.fn(async () => TARGET),
    check: jest.fn(async () => ({ allowed: true as const, reason: 'AUTORIZADO' as const })),
    audit: jest.fn(async () => undefined),
  } as unknown as AuthorizationService;
  const audit = (authorization as unknown as { audit: jest.Mock }).audit;

  return {
    service: new AttachmentsService(db, authorization, storage, clamav),
    storage,
    clamav,
    authorization,
    audit,
    deleteObject,
    calls,
    insertedId,
  };
}

describe('AttachmentsService', () => {
  it('libera somente arquivo limpo e move da quarentena para documentos', async () => {
    const fixture = makeService('CLEAN');

    const result = await fixture.service.upload({
      requestId: TARGET.requestId,
      file: { buffer: jpeg(), originalname: 'foto.jpg' },
      session: SESSION,
      correlationId: 'corr-1',
    });

    expect(result.attachmentId).toBe(fixture.insertedId);
    expect(result.inspectionState).toBe('RELEASED');
    expect(fixture.calls.map((call) => call.bucket)).toEqual(['quarantine', 'documents']);
    expect(fixture.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'quarantine' }),
    );
    expect(fixture.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: fixture.insertedId,
        reason: 'RELEASED',
      }),
    );
  });

  it('mantem arquivo infectado bloqueado na quarentena', async () => {
    const fixture = makeService('INFECTED');

    const result = await fixture.service.upload({
      requestId: TARGET.requestId,
      file: { buffer: jpeg(), originalname: 'foto.jpg' },
      session: SESSION,
      correlationId: 'corr-2',
    });

    expect(result.inspectionState).toBe('REJECTED');
    expect(fixture.calls.map((call) => call.bucket)).toEqual(['quarantine']);
    expect(fixture.deleteObject).not.toHaveBeenCalled();
  });

  it('registra erro de inspecao sem liberar o arquivo', async () => {
    const fixture = makeService('ERROR');

    const result = await fixture.service.upload({
      requestId: TARGET.requestId,
      file: { buffer: jpeg(), originalname: 'foto.jpg' },
      session: SESSION,
      correlationId: 'corr-3',
    });

    expect(result.inspectionState).toBe('ERROR');
    expect(fixture.calls.map((call) => call.bucket)).toEqual(['quarantine']);
    expect(fixture.audit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ERROR' }));
  });
});
