import { describe, expect, it, jest } from '@jest/globals';
import type { SessionClaims } from '../src/auth/session.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { Database } from '../src/database/typed-query';
import { EvaluationsService } from '../src/evaluations/evaluations.service';

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
  state: 'COMPLETED' as const,
};

function makeService(options: { readonly duplicate?: boolean; readonly state?: string } = {}) {
  const db = {
    run: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT "state","cycle_number"')) {
        return [{ state: options.state ?? 'COMPLETED', cycle_number: 2 }];
      }
      if (sql.includes('INSERT INTO "evaluations"')) {
        if (options.duplicate) throw Object.assign(new Error('duplicate'), { code: '23505' });
        return [
          {
            id: 'evaluation-1',
            request_id: TARGET.requestId,
            cycle_number: 2,
            author_user_id: SESSION.userId,
            rating: 5,
            comment: 'Atendimento excelente',
            created_at: '2026-09-29T16:00:00.000Z',
          },
        ];
      }
      return [];
    }),
  } as unknown as Database;
  const authorization = {
    requestTarget: jest.fn(async () => TARGET),
    check: jest.fn(async () => ({ allowed: true as const, reason: 'AUTORIZADO' as const })),
    audit: jest.fn(async () => undefined),
  } as unknown as AuthorizationService;
  return {
    service: new EvaluationsService(db, authorization),
    audit: (authorization as unknown as { audit: jest.Mock }).audit,
  };
}

describe('EvaluationsService', () => {
  it('registra uma nota vinculada ao ciclo atual', async () => {
    const fixture = makeService();

    const result = await fixture.service.create({
      requestId: TARGET.requestId,
      rating: 5,
      comment: '  Atendimento excelente  ',
      session: SESSION,
      correlationId: 'corr-1',
    });

    expect(result).toMatchObject({ cycleNumber: 2, rating: 5, comment: 'Atendimento excelente' });
    expect(fixture.audit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'evaluation' }),
    );
  });

  it('recusa avaliacao antes da conclusao', async () => {
    const fixture = makeService({ state: 'IN_REVIEW' });

    await expect(
      fixture.service.create({
        requestId: TARGET.requestId,
        rating: 4,
        comment: null,
        session: SESSION,
        correlationId: 'corr-2',
      }),
    ).rejects.toThrow(/conclusao/);
  });

  it('transforma duplicidade concorrente em conflito compreensivel', async () => {
    const fixture = makeService({ duplicate: true });

    await expect(
      fixture.service.create({
        requestId: TARGET.requestId,
        rating: 3,
        comment: null,
        session: SESSION,
        correlationId: 'corr-3',
      }),
    ).rejects.toThrow(/ja foi avaliado/);
  });
});
