import { describe, expect, it, jest } from '@jest/globals';
import { RequestsController } from '../src/requests/requests.controller';
import type { Database } from '../src/database/typed-query';
import type { SessionClaims } from '../src/auth/session.service';
import type { SlaProgress } from '../src/requests/sla-progress.service';

const REQUEST_ID = '00000000-0000-4000-8000-000000000002';
const POLICY_ID = '00000000-0000-4000-8000-000000000001';
const DUE_AT = new Date('2026-10-09T20:00:00.000Z');
const AS_OF = new Date('2026-10-03T20:00:00.000Z');

describe('RequestsController', () => {
  it('devolve o SLA server-side em cada item da lista do cidadao', async () => {
    const run = jest.fn(async () => [
      {
        id: REQUEST_ID,
        protocol: 'SER-2026-000001',
        state: 'IN_REVIEW',
        submitted_at: new Date('2026-10-03T12:00:00.000Z'),
        completed_at: null,
        canceled_at: null,
        priority: 'NORMAL',
        cycle_number: 1,
        outcome: null,
        sla_policy_id: POLICY_ID,
        cycle_started_at: new Date('2026-10-03T12:00:00.000Z'),
        created_at: new Date('2026-10-03T12:00:00.000Z'),
        secretariat_name: 'Secretaria de Saude',
        service_name: 'Orientacao sobre consultas',
      },
    ]);
    const count = jest.fn(async () => 1);
    const calculateMany = jest.fn(async () =>
      new Map([
        [
          REQUEST_ID,
          {
            progressPercent: 12.5,
            elapsedMinutes: 375,
            targetMinutes: 3_000,
            remainingMinutes: 2_625,
            businessUnit: true,
            dueAt: DUE_AT,
            overdue: false,
            paused: false,
            publishedCommitment: true,
            asOf: AS_OF,
          } satisfies SlaProgress,
        ],
      ]),
    );
    const database = { run, count } as unknown as Database;
    const controller = new RequestsController(
      {} as never,
      {} as never,
      database,
      {} as never,
      { calculateMany } as never,
    );

    const result = await controller.mine({ userId: 'citizen-1' } as SessionClaims);
    const item = result.items[0] as Record<string, unknown>;

    expect(calculateMany).toHaveBeenCalledTimes(1);
    expect(item['sla']).toMatchObject({
      progressPercent: 12.5,
      remainingMinutes: 2_625,
      dueAt: DUE_AT.toISOString(),
      publishedCommitment: true,
      asOf: AS_OF.toISOString(),
    });
    expect(item['dueAt']).toBe(DUE_AT.toISOString());
    expect(item['dueAtText']).toContain('Vence em');
  });
});
