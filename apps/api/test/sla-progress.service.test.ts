import { describe, expect, it, jest } from '@jest/globals';
import { SlaProgressService } from '../src/requests/sla-progress.service';
import type { Database } from '../src/database/typed-query';

const POLICY_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = '00000000-0000-4000-8000-000000000002';
const STARTED_AT = new Date('2026-09-28T12:00:00.000Z');

function makeService(pauses: readonly Record<string, unknown>[] = []) {
  const run = jest.fn(async (sql: string) => {
    if (sql.includes('FROM "sla_policies"')) {
      return [
        {
          id: POLICY_ID,
          version: 1,
          first_response_minutes: 480,
          resolution_value: 1,
          resolution_unit: 'BUSINESS_DAYS',
          running_states: ['SUBMITTED', 'IN_REVIEW', 'SCHEDULED', 'IN_PROGRESS'],
          paused_states: ['WAITING_CITIZEN'],
          is_published_commitment: true,
          frozen_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ];
    }
    return pauses;
  });
  const database = { run } as unknown as Database;
  return { service: new SlaProgressService(database), run };
}

describe('SlaProgressService', () => {
  it('recupera o vencimento historico quando o pedido esta atrasado', async () => {
    const { service } = makeService();

    const result = await service.calculate(
      {
        requestId: REQUEST_ID,
        state: 'IN_REVIEW',
        policyId: POLICY_ID,
        startedAt: STARTED_AT,
        finishedAt: null,
      },
      new Date('2026-10-15T12:00:00.000Z'),
    );

    expect(result?.overdue).toBe(true);
    expect(result?.dueAt?.toISOString()).toBe('2026-09-29T12:00:00.000Z');
    expect(result?.progressPercent).toBe(100);
  });

  it('mantem o relogio pausado e remove a pausa do percentual', async () => {
    const { service } = makeService([
      {
        id: '00000000-0000-4000-8000-000000000003',
        request_id: REQUEST_ID,
        state: 'WAITING_CITIZEN',
        started_at: new Date('2026-09-28T14:00:00.000Z'),
        ended_at: null,
        reason: 'Aguardando informacao',
        approved_by: '00000000-0000-4000-8000-000000000004',
      },
    ]);

    const result = await service.calculate(
      {
        requestId: REQUEST_ID,
        state: 'WAITING_CITIZEN',
        policyId: POLICY_ID,
        startedAt: STARTED_AT,
        finishedAt: null,
      },
      new Date('2026-09-28T20:00:00.000Z'),
    );

    expect(result?.paused).toBe(true);
    expect(result?.overdue).toBe(false);
    expect(result?.elapsedMinutes).toBe(120);
    expect(result?.progressPercent).toBe(22.2);
    expect(result?.dueAt?.getTime()).toBeGreaterThan(
      new Date('2026-09-28T20:00:00.000Z').getTime(),
    );
  });
});
