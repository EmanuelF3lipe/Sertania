/**
 * Concorrencia real (Marco A3 da especificacao de continuacao).
 *
 * A distincao que estes testes sustentam: CONFLITO DE VERSAO OBSOLETA e
 * CONCORRENCIA. O primeiro e um cliente com dado velho; o segundo sao dois
 * clientes ao mesmo tempo, e por isso exige transacoes sobrepostas de verdade.
 *
 * Por que o PostgreSQL de verdade e obrigatorio aqui: simular concorrencia com
 * temporizador em JavaScript nao reproduz bloqueio de linha, `FOR UPDATE` nem
 * `ON CONFLICT DO UPDATE`. Um teste que passa com mock pode falhar em
 * producao, e foi o que aconteceu com `MAX + 1` no protocolo.
 */
import { DataSource } from 'typeorm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { VersionConflictError } from '@sertania/contracts';
import { OpenRequestService } from '../../src/requests/open-request.service';
import { ProtocolService } from '../../src/requests/protocol.service';
import { WorkflowService } from '../../src/requests/workflow.service';
import { Database } from '../../src/database/typed-query';

function loadEnv(): void {
  const raw = readFileSync(resolve(__dirname, '../../../../.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1);
    if (v !== '' && process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();

const NOW = new Date('2026-09-29T12:00:00.000Z');

let ds: DataSource;
let db: Database;
let openRequest: OpenRequestService;
let workflow: WorkflowService;

interface Base {
  readonly cidadao: string;
  readonly outroCidadao: string;
  readonly serviceVersionId: string;
  readonly secretariatId: string;
  readonly unitId: string;
  readonly slaPolicyId: string;
}

async function base(): Promise<Base> {
  const one = async (q: string, p: unknown[] = []): Promise<Record<string, unknown>> =>
    (await db.run(q, p))[0] as Record<string, unknown>;

  const c1 = await one(`INSERT INTO "users" ("is_citizen") VALUES (true) RETURNING "id"`);
  const c2 = await one(`INSERT INTO "users" ("is_citizen") VALUES (true) RETURNING "id"`);
  const s = await one(
    `INSERT INTO "secretariats" ("slug","name") VALUES ('saude','Saude')
       ON CONFLICT ("slug") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
  );
  const u = await one(
    `INSERT INTO "units" ("secretariat_id","name") VALUES ($1,'UBS') RETURNING "id"`,
    [s['id']],
  );
  const p = await one(
    `INSERT INTO "sla_policies"
       ("version","name","first_response_minutes","resolution_value","resolution_unit",
        "running_states","paused_states")
     VALUES (960,'Concorrencia',480,5,'BUSINESS_DAYS',
       ARRAY['SUBMITTED','IN_REVIEW','SCHEDULED','IN_PROGRESS'], ARRAY['WAITING_CITIZEN'])
     ON CONFLICT ("version") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
  );
  const sv = await one(
    `INSERT INTO "services" ("slug","secretariat_id","default_unit_id")
     VALUES ('servico-concorrencia',$1,$2)
       ON CONFLICT ("slug") DO UPDATE SET "default_unit_id"=EXCLUDED."default_unit_id" RETURNING "id"`,
    [s['id'], u['id']],
  );
  const ver = await one(
    `INSERT INTO "service_versions"
       ("service_id","version","name","description","guidance","form_schema",
        "classification","max_attachments","published","published_at")
     VALUES ($1,1,'Concorrencia','d','g','{"type":"object"}'::jsonb,'PUBLIC_APPROVED',5,true,now())
     ON CONFLICT ("service_id","version") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
    [sv['id']],
  );

  return {
    cidadao: c1['id'] as string,
    outroCidadao: c2['id'] as string,
    serviceVersionId: ver['id'] as string,
    secretariatId: s['id'] as string,
    unitId: u['id'] as string,
    slaPolicyId: p['id'] as string,
  };
}

function inputFor(b: Base, description: string, citizenId?: string) {
  return {
    citizenId: citizenId ?? b.cidadao,
    createdBy: citizenId ?? b.cidadao,
    channel: 'WEB' as const,
    serviceVersionId: b.serviceVersionId,
    secretariatId: b.secretariatId,
    unitId: b.unitId,
    slaPolicyId: b.slaPolicyId,
    classification: 'PUBLIC_APPROVED' as const,
    description,
    formAnswers: {},
    location: null,
    identityVerificationMethod: null,
    assistedNote: null,
  };
}

async function currentVersion(requestId: string): Promise<number> {
  return db.count(`SELECT "version" FROM "requests" WHERE "id" = $1`, [requestId]);
}

async function criar(b: Base, description = 'Pedido'): Promise<string> {
  const r = await openRequest.open(inputFor(b, description), undefined, NOW);
  if (r.outcome !== 'CREATED') throw new Error(`criacao falhou: ${r.outcome}`);
  return r.requestId;
}

beforeAll(async () => {
  ds = new DataSource({
    type: 'postgres',
    host: process.env['POSTGRES_HOST'] ?? 'localhost',
    port: Number(process.env['POSTGRES_PORT'] ?? 5432),
    username: process.env['POSTGRES_USER'] ?? 'sertania_app',
    password: process.env['POSTGRES_PASSWORD'] ?? 'app-local-apenas',
    database: process.env['POSTGRES_DB'] ?? 'sertania',
    logging: false,
  });
  await ds.initialize();
  Logger.overrideLogger(false);
  db = new Database(ds);
  const protocol = new ProtocolService(ds);
  await protocol.ensureSequenceTable();
  openRequest = new OpenRequestService(ds, protocol);
  workflow = new WorkflowService(ds);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized === true) await ds.destroy();
});

beforeEach(async () => {
  for (const t of [
    'audit_events', 'request_events', 'request_content', 'request_locations',
    'request_cycles', 'request_relations', 'evaluations', 'reopen_requests',
    'tasks', 'transfers', 'information_requests', 'sla_pauses', 'messages',
    'attachments', 'outbox_events', 'notification_deliveries', 'idempotency_keys',
    'requests', 'service_versions', 'services', 'memberships', 'access_grants',
    'units', 'secretariats', 'external_identities', 'users',
  ]) {
    await ds.query(`DELETE FROM "${t}"`);
  }
  await ds.query(`DELETE FROM "sla_policies" WHERE "version" = 960`);
});

describe('A3: repeticao e concorrencia na abertura', () => {
  it('mesma conta, mesma chave, mesmo conteudo em paralelo: um pedido e um protocolo', async () => {
    const b = await base();
    const key = `concorrente-${'a'.repeat(20)}`;

    // Oito envios NA MESMA transacao de tempo, todos com a mesma chave. O
    // `FOR UPDATE` na chave de idempencia e o `ON CONFLICT` da sequencia
    // precisam serializar isso no banco, nao na aplicacao.
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => openRequest.open(inputFor(b, 'Mesmo pedido'), key, NOW)),
    );

    const criados = resultados.filter((r) => r.outcome === 'CREATED');
    const repetidos = resultados.filter((r) => r.outcome === 'REPLAYED');

    // Exatamente um cria. Os demais ou repetem o resultado ou sao recusados
    // por `IN_FLIGHT`, que e o comportamento honesto enquanto a primeira
    // transacao nao terminou.
    expect(criados.length).toBe(1);
    expect(criados.length + repetidos.length).toBeGreaterThan(0);

    const pedidos = await db.count(`SELECT count(*)::int FROM "requests"`);
    expect(pedidos).toBe(1);

    // Um unico conjunto de efeitos de abertura: um evento, um ciclo, uma
    // linha de outbox.
    expect(await db.count(`SELECT count(*)::int FROM "request_events"`)).toBe(1);
    expect(await db.count(`SELECT count(*)::int FROM "request_cycles"`)).toBe(1);
    expect(await db.count(`SELECT count(*)::int FROM "outbox_events"`)).toBe(1);
  }, 60_000);

  it('mesma chave com conteudo diferente: conflito explicito, sem devolver o resultado alheio', async () => {
    const b = await base();
    const key = `divergente-${'b'.repeat(20)}`;

    const primeiro = await openRequest.open(inputFor(b, 'Conteudo original'), key, NOW);
    const segundo = await openRequest.open(inputFor(b, 'Conteudo totalmente diferente'), key, NOW);

    expect(primeiro.outcome).toBe('CREATED');
    // Devolver o pedido do primeiro conteudo seria pior que um erro: o cidadao
    // acharia que seu novo pedido foi registrado.
    expect(segundo.outcome).toBe('IDEMPOTENCY_MISMATCH');
    expect(await db.count(`SELECT count(*)::int FROM "requests"`)).toBe(1);
  }, 30_000);

  it('contas diferentes com a mesma chave ficam isoladas', async () => {
    const b = await base();
    const key = `compartilhada-${'c'.repeat(20)}`;

    // A chave e escopada por usuario. Sem isso, um cidadao receberia o
    // protocolo de outro ao adivinhar a chave.
    const a = await openRequest.open(inputFor(b, 'Pedido do primeiro', b.cidadao), key, NOW);
    const c = await openRequest.open(inputFor(b, 'Pedido do segundo', b.outroCidadao), key, NOW);

    expect(a.outcome).toBe('CREATED');
    expect(c.outcome).toBe('CREATED');
    if (a.outcome !== 'CREATED' || c.outcome !== 'CREATED') return;
    expect(a.requestId).not.toBe(c.requestId);
    expect(a.protocol).not.toBe(c.protocol);
    expect(await db.count(`SELECT count(*)::int FROM "requests"`)).toBe(2);
  }, 30_000);

  it('aberturas diferentes simultaneas: protocolos unicos e persistidos', async () => {
    const b = await base();
    const total = 15;

    const resultados = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        openRequest.open(inputFor(b, `Concorrente numero ${i}`), `chave-${String(i).padStart(20, '0')}`, NOW),
      ),
    );

    const protocolos = resultados
      .map((r) => (r.outcome === 'CREATED' ? r.protocol : null))
      .filter((p): p is string => p !== null);

    // Com `MAX + 1`, varias transacoes leriam o mesmo maximo e a unicidade
    // faria algumas falharem. Com sequencia do banco, todas passam.
    expect(protocolos).toHaveLength(total);
    expect(new Set(protocolos).size).toBe(total);

    const salvos = await db.count(`SELECT count(DISTINCT "protocol")::int FROM "requests"`);
    expect(salvos).toBe(total);
  }, 90_000);
});

describe('A3: concorrencia em comando de estado', () => {
  it('dois comandos com a mesma versao esperada: um vence e o outro recebe conflito', async () => {
    const b = await base();
    const requestId = await criar(b);
    const versao = await currentVersion(requestId);

    // Dois servidores leem a MESMA versao e tentam agir ao mesmo tempo. O
    // `SELECT ... FOR UPDATE` serializa as duas transacoes. A primeira a obter
    // o lock aplica; a segunda acorda com a versao ja incrementada.
    const [um, dois] = await Promise.allSettled([
      workflow.apply('START_REVIEW', {
        requestId, expectedVersion: versao, actorUserId: b.cidadao,
        now: NOW, publicText: 'Em analise',
      }),
      workflow.apply('REQUEST_INFORMATION', {
        requestId, expectedVersion: versao, actorUserId: b.cidadao,
        now: NOW, publicText: 'Precisamos de uma informacao',
      }),
    ]);

    // Exatamente um aplica; o outro e impedido.
    //
    // "Aplicou" nao e "a promessa foi cumprida". Um comando recusado por estado
    // responde `ok: false` e a promessa cumpre normalmente: classificar por
    // `status` trataria a recusa como sucesso, e o teste passaria a falhar
    // conforme a ordem das transacoes. Quem aplicou tem `ok: true`.
    const aplicados = [um, dois].filter(
      (r) => r.status === 'fulfilled' && r.value.ok === true,
    );
    const impedidos = [um, dois].filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.ok === false),
    );
    expect(aplicados).toHaveLength(1);
    expect(impedidos).toHaveLength(1);

    // A recusa do perdedor tem duas formas legitimas, e o teste nao presume
    // qual delas vai acontecer:
    //
    // - `VersionConflictError`, quando a segunda transacao acorda do lock e ve
    //   a versao ja incrementada;
    // - `ILLEGAL_TRANSITION`, quando ela acorda e le o estado NOVO, onde o
    //   comando ja nao faz sentido. Isso e correto: `START_REVIEW` duas vezes
    //   seguidas e uma transicao invalida de verdade.
    //
    // O que nao pode acontecer e o perdedor ter aplicado por cima da versao
    // nova, e isso e verificado pelos dois asserts abaixo: a versao subiu uma
    // vez, e existe um evento.
    // Percorre em vez de indexar: `expect(...).toHaveLength(1)` nao estreita o
    // tipo do array para o TypeScript, e `impedidos[0]` continuaria
    // possivelmente indefinido para o compilador.
    for (const perdedor of impedidos) {
      if (perdedor.status === 'rejected') {
        expect(perdedor.reason).toBeInstanceOf(VersionConflictError);
      } else {
        expect(perdedor.value).toEqual({ ok: false, error: 'ILLEGAL_TRANSITION' });
      }
    }

    // A versao subiu UMA vez. Este e o assert que distingue concorrencia de
    // sobrescrita silenciosa.
    const final = await currentVersion(requestId);
    expect(final).toBe(versao + 1);

    // O comando perdedor nao deixou efeito: um evento, nao dois.
    const eventos = await db.count(
      `SELECT count(*)::int FROM "request_events" WHERE "request_id" = $1 AND "type" <> 'SUBMITTED'`,
      [requestId],
    );
    expect(eventos).toBe(1);
  }, 30_000);

  it('comandos sequenciais com versao atualizada: ambos aplicam', async () => {
    const b = await base();
    const requestId = await criar(b);

    const um = await workflow.apply('START_REVIEW', {
      requestId, expectedVersion: await currentVersion(requestId), actorUserId: b.cidadao,
      now: NOW, publicText: 'Em analise',
    });
    expect(um.ok).toBe(true);

    // Lendo a versao nova, o segundo comando passa: o controle de versao
    // existe para alteracao simultanea, e nao para proibir sequencia.
    const dois = await workflow.apply('REQUEST_INFORMATION', {
      requestId, expectedVersion: await currentVersion(requestId), actorUserId: b.cidadao,
      now: NOW, publicText: 'Precisamos de uma informacao',
    });
    expect(dois.ok).toBe(true);
    if (um.ok && dois.ok) expect(dois.state).toBe('WAITING_CITIZEN');
  }, 30_000);
});

describe('A3: falha no meio da transacao', () => {
  it('erro apos gravar o pedido nao deixa estado parcial', async () => {
    const b = await base();
    const key = `falha-${'d'.repeat(20)}`;

    // Forcar falha depois do INSERT do pedido: a localizacao recebe um
    // `secretariat_id` invalido, o que viola a chave estrangeira. Tudo o que
    // veio antes na transacao precisa voltar.
    const entradaQuebrada = {
      ...inputFor(b, 'Pedido com falha no meio'),
      location: {
        addressText: 'Rua sem secretaria',
        latitude: -8.5,
        longitude: -34.7,
        precisionSource: 'MAP_PICK' as const,
      },
      secretariatId: '00000000-0000-0000-0000-000000000000',
    };

    await expect(openRequest.open(entradaQuebrada, key, NOW)).rejects.toBeDefined();

    // Nada permanece: nem pedido, nem evento, nem chave, nem outbox.
    expect(await db.count(`SELECT count(*)::int FROM "requests"`)).toBe(0);
    expect(await db.count(`SELECT count(*)::int FROM "request_events"`)).toBe(0);
    expect(await db.count(`SELECT count(*)::int FROM "request_content"`)).toBe(0);
    expect(await db.count(`SELECT count(*)::int FROM "outbox_events"`)).toBe(0);
    // A chave de idempotencia tambem some: sem isso, uma retentativa ficaria
    // presa em IN_FLIGHT para sempre.
    expect(await db.count(`SELECT count(*)::int FROM "idempotency_keys"`)).toBe(0);
  }, 30_000);
});
