/**
 * Teste de integracao: persistencia real (criterios 1, 2 e 8 da secao 20).
 *
 * Estes testes rodam contra o PostgreSQL da stack local, nao contra mock. E por
 * isso que eles valem como evidencia: o protocolo e gerado em transacao de
 * verdade, com restricao de unicidade real, e a concorrencia e real.
 *
 * Requisitos: a stack de `infra/docker/docker-compose.yml` no ar.
 */
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { PROTOCOL_SEQUENCE_TABLE, VersionConflictError } from '@sertania/contracts';
import { OpenRequestService } from '../../src/requests/open-request.service';
import { ProtocolService } from '../../src/requests/protocol.service';
import { WorkflowService } from '../../src/requests/workflow.service';
import { carregarAmbienteDeTeste } from '../support/carregar-env';

// Recusa o banco de demonstracao antes de abrir qualquer conexao. Ver o modulo.
carregarAmbienteDeTeste();

const NOW = new Date('2026-09-28T12:00:00.000Z');

let dataSource: DataSource;
let openRequest: OpenRequestService;
let workflow: WorkflowService;

async function freshDataSource(): Promise<DataSource> {
  return new DataSource({
    type: 'postgres',
    host: process.env['POSTGRES_HOST'] ?? 'localhost',
    port: Number(process.env['POSTGRES_PORT'] ?? 5432),
    // Os testes usam a conta da APLICACAO, e nao a de migracao. A aplicacao e
    // quem executa os casos de uso em producao; testar com outra conta
    // esconderia falta de concessao.
    username: process.env['POSTGRES_USER'] ?? 'sertania_app',
    password: process.env['POSTGRES_PASSWORD'] ?? 'app-local-apenas',
    database: process.env['POSTGRES_DB'] ?? 'sertania',
    logging: false,
  });
}

/** Cenario base: um cidadao e os ids de catalogo necessarios. */
async function seedBase(): Promise<{
  citizenId: string;
  serviceVersionId: string;
  secretariatId: string;
  unitId: string;
  slaPolicyId: string;
}> {
  await dataSource.query(`DELETE FROM "request_events"`);
  await dataSource.query(`DELETE FROM "request_content"`);
  await dataSource.query(`DELETE FROM "request_locations"`);
  await dataSource.query(`DELETE FROM "request_cycles"`);
  await dataSource.query(`DELETE FROM "sla_pauses"`);
  await dataSource.query(`DELETE FROM "outbox_events"`);
  await dataSource.query(`DELETE FROM "idempotency_keys"`);
  await dataSource.query(`DELETE FROM "requests"`);

  const users = await dataSource.query(
    `INSERT INTO "users" ("is_citizen","is_server") VALUES (true,false) RETURNING "id"`,
  );
  const citizenId = (users[0] as { id: string }).id;

  const secretariats = await dataSource.query(
    `INSERT INTO "secretariats" ("slug","name") VALUES ('saude','Saude') RETURNING "id"`,
  );
  const secretariatId = (secretariats[0] as { id: string }).id;

  const units = await dataSource.query(
    `INSERT INTO "units" ("secretariat_id","name") VALUES ($1,'UBS Central') RETURNING "id"`,
    [secretariatId],
  );
  const unitId = (units[0] as { id: string }).id;

  const policies = await dataSource.query(
    `INSERT INTO "sla_policies"
       ("version","name","first_response_minutes","resolution_value","resolution_unit",
        "running_states","paused_states")
     VALUES (900,'Teste', 480, 5, 'BUSINESS_DAYS',
       ARRAY['SUBMITTED','IN_REVIEW','SCHEDULED','IN_PROGRESS'],
       ARRAY['WAITING_CITIZEN'])
     ON CONFLICT ("version") DO UPDATE SET "name" = EXCLUDED."name"
     RETURNING "id"`,
  );
  const slaPolicyId = (policies[0] as { id: string }).id;

  const services = await dataSource.query(
    `INSERT INTO "services" ("slug","secretariat_id","default_unit_id")
     VALUES ('orientacao-acesso-consultas',$1,$2) RETURNING "id"`,
    [secretariatId, unitId],
  );
  const serviceId = (services[0] as { id: string }).id;

  const versions = await dataSource.query(
    `INSERT INTO "service_versions"
       ("service_id","version","name","description","guidance","form_schema",
        "classification","max_attachments","published","published_at")
     VALUES ($1, 1, 'Orientacao sobre consultas',
       'Informacao sobre acesso a consultas e exames',
       'Descreva o que voce precisa',
       '{"type":"object"}'::jsonb, 'PUBLIC_APPROVED', 5, true, now())
     RETURNING "id"`,
    [serviceId],
  );
  const serviceVersionId = (versions[0] as { id: string }).id;

  return { citizenId, serviceVersionId, secretariatId, unitId, slaPolicyId };
}

function inputFor(base: Awaited<ReturnType<typeof seedBase>>, description: string) {
  return {
    citizenId: base.citizenId,
    createdBy: base.citizenId,
    channel: 'WEB' as const,
    serviceVersionId: base.serviceVersionId,
    secretariatId: base.secretariatId,
    unitId: base.unitId,
    slaPolicyId: base.slaPolicyId,
    classification: 'PUBLIC_APPROVED' as const,
    description,
    formAnswers: {},
    location: null,
    identityVerificationMethod: null,
    assistedNote: null,
  };
}

beforeAll(async () => {
  dataSource = await freshDataSource();
  await dataSource.initialize();
  const protocol = new ProtocolService(dataSource);
  await protocol.ensureSequenceTable();
  openRequest = new OpenRequestService(dataSource, protocol);
  workflow = new WorkflowService(dataSource);
}, 60_000);

afterAll(async () => {
  if (dataSource?.isInitialized === true) await dataSource.destroy();
});

/**
 * Limpa o banco entre os testes.
 *
 * A ordem respeita as chaves estrangeiras. Nenhuma FK tem ON DELETE CASCADE
 * de proposito (secao 11: historico administrativo nao e apagado em cascata),
 * entao a limpeza e explicita e em ordem. Isso e proposito: se um dia alguem
 * adicionar CASCADE para simplificar a limpeza, os testes de historico
 * deixam de proteger o que protegem.
 */
beforeEach(async () => {
  await dataSource.query(`DELETE FROM "request_events"`);
  await dataSource.query(`DELETE FROM "request_content"`);
  await dataSource.query(`DELETE FROM "request_locations"`);
  await dataSource.query(`DELETE FROM "request_cycles"`);
  await dataSource.query(`DELETE FROM "request_relations"`);
  await dataSource.query(`DELETE FROM "evaluations"`);
  await dataSource.query(`DELETE FROM "reopen_requests"`);
  await dataSource.query(`DELETE FROM "tasks"`);
  await dataSource.query(`DELETE FROM "transfers"`);
  await dataSource.query(`DELETE FROM "information_requests"`);
  await dataSource.query(`DELETE FROM "sla_pauses"`);
  await dataSource.query(`DELETE FROM "messages"`);
  await dataSource.query(`DELETE FROM "attachments"`);
  await dataSource.query(`DELETE FROM "outbox_events"`);
  await dataSource.query(`DELETE FROM "notification_deliveries"`);
  await dataSource.query(`DELETE FROM "idempotency_keys"`);
  await dataSource.query(`DELETE FROM "requests"`);
  await dataSource.query(`DELETE FROM "service_versions"`);
  await dataSource.query(`DELETE FROM "services"`);
  await dataSource.query(`DELETE FROM "units"`);
  await dataSource.query(`DELETE FROM "secretariats"`);
  await dataSource.query(`DELETE FROM "sla_policies" WHERE "version" = 900`);
  await dataSource.query(`DELETE FROM "memberships"`);
  await dataSource.query(`DELETE FROM "access_grants"`);
  await dataSource.query(`DELETE FROM "external_identities"`);
  await dataSource.query(`DELETE FROM "users"`);
});

describe('criterio 1: protocolo unico e persistencia real', () => {
  it('gera protocolo no formato SER-AAAA-NNNNNN', async () => {
    const base = await seedBase();
    const result = await openRequest.open(inputFor(base, 'Preciso de informacao sobre consultas'), undefined, NOW);
    expect(result.outcome).toBe('CREATED');
    if (result.outcome !== 'CREATED') return;
    expect(result.protocol).toMatch(/^SER-\d{4}-\d{6}$/);
    expect(result.state).toBe('SUBMITTED');
  }, 30_000);

  it('persiste o pedido: reiniciar a aplicacao nao apaga', async () => {
    const base = await seedBase();
    const result = await openRequest.open(inputFor(base, 'Duracao da consulta'), undefined, NOW);
    if (result.outcome !== 'CREATED') throw new Error('deveria ter criado');

    // Simula reinicio: nova conexao le o que foi gravado.
    const outra = await freshDataSource();
    await outra.initialize();
    const rows = await outra.query(
      `SELECT "protocol","state" FROM "requests" WHERE "id" = $1`,
      [result.requestId],
    );
    await outra.destroy();

    expect(rows).toHaveLength(1);
    expect((rows[0] as { protocol: string }).protocol).toBe(result.protocol);
  }, 30_000);

  it('grava conteudo, ciclo e evento visivel ao cidadao', async () => {
    const base = await seedBase();
    const result = await openRequest.open(inputFor(base, 'Onde fazer exame'), undefined, NOW);
    if (result.outcome !== 'CREATED') throw new Error('deveria ter criado');

    const content = await dataSource.query(
      `SELECT "description" FROM "request_content" WHERE "request_id" = $1`,
      [result.requestId],
    );
    expect((content[0] as { description: string }).description).toBe('Onde fazer exame');

    const cycles = await dataSource.query(
      `SELECT "cycle_number" FROM "request_cycles" WHERE "request_id" = $1`,
      [result.requestId],
    );
    expect((cycles[0] as { cycle_number: number }).cycle_number).toBe(1);

    const events = await dataSource.query(
      `SELECT "public_text","visibility" FROM "request_events" WHERE "request_id" = $1`,
      [result.requestId],
    );
    expect(events).toHaveLength(1);
    expect((events[0] as { visibility: string }).visibility).toBe('CITIZEN_VISIBLE');
    expect((events[0] as { public_text: string }).public_text).toContain(result.protocol);
  }, 30_000);

  it('grava o evento na outbox na mesma transacao', async () => {
    const base = await seedBase();
    await openRequest.open(inputFor(base, 'Teste de outbox'), undefined, NOW);
    const rows = await dataSource.query(`SELECT "type","idempotency_key" FROM "outbox_events"`);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { type: string }).type).toBe('REQUEST_RECEIVED');
  }, 30_000);
});

describe('criterio 2: idempotencia e ausencia de duplicata', () => {
  it('repetir a mesma abertura devolve o mesmo protocolo', async () => {
    const base = await seedBase();
    const key = 'chave-de-teste-0000000001';

    const primeiro = await openRequest.open(inputFor(base, 'Mesma solicitacao'), key, NOW);
    const segundo = await openRequest.open(inputFor(base, 'Mesma solicitacao'), key, NOW);

    expect(primeiro.outcome).toBe('CREATED');
    // O criterio 2 exige que a retentativa por falha de rede nao crie
    // duplicata: o segundo retorno e a MESMA solicitacao.
    expect(segundo.outcome).toBe('REPLAYED');
    if (primeiro.outcome !== 'CREATED' || segundo.outcome !== 'REPLAYED') return;
    expect(segundo.requestId).toBe(primeiro.requestId);
    expect(segundo.protocol).toBe(primeiro.protocol);

    const total = await dataSource.query(`SELECT count(*)::int AS n FROM "requests"`);
    expect((total[0] as { n: number }).n).toBe(1);
  }, 30_000);

  it('reutilizar a chave com corpo diferente e recusado', async () => {
    const base = await seedBase();
    const key = 'chave-de-teste-0000000002';
    await openRequest.open(inputFor(base, 'Primeira descricao'), key, NOW);
    const outro = await openRequest.open(inputFor(base, 'Descricao totalmente diferente'), key, NOW);
    // Reuso de chave com corpo diferente e erro do cliente, para que ele
    // gere uma chave nova e nao sobrescreva a solicitacao anterior.
    expect(outro.outcome).toBe('IDEMPOTENCY_MISMATCH');
  }, 30_000);

  it('solicitacoes diferentes recebem protocolos diferentes', async () => {
    const base = await seedBase();
    const a = await openRequest.open(inputFor(base, 'Pedido A'), undefined, NOW);
    const b = await openRequest.open(inputFor(base, 'Pedido B'), undefined, NOW);
    if (a.outcome !== 'CREATED' || b.outcome !== 'CREATED') throw new Error('ambos deveriam ser criados');
    expect(a.protocol).not.toBe(b.protocol);
  }, 30_000);

  it('envio concorrente nao repete protocolo', async () => {
    // Este e o teste que a sequencia do banco resolve. Dez envios em paralelo
    // com chaves de idempotencia diferentes precisam receber numeros distintos.
    const base = await seedBase();
    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        openRequest.open(inputFor(base, `Concorrente ${i}`), `chave-concorrente-${String(i).padStart(20, '0')}`, NOW),
      ),
    );

    const protocolos = resultados
      .filter((r: { outcome: string }) => r.outcome === 'CREATED')
      .map((r: { outcome: string; protocol?: string }) => (r.outcome === 'CREATED' ? r.protocol : ''));
    expect(protocolos).toHaveLength(10);
    // Se usassemos `MAX + 1`, varias transacoes leriam o mesmo maximo e a
    // unicidade faria algumas falharem.
    expect(new Set(protocolos).size).toBe(10);
  }, 60_000);
});

describe('sequencia de protocolo', () => {
  it('numera de forma crescente e sem lacuna dentro da mesma transacao', async () => {
    const base = await seedBase();
    const primeiro = await openRequest.open(inputFor(base, 'Primeira'), undefined, NOW);
    const segundo = await openRequest.open(inputFor(base, 'Segunda'), undefined, NOW);
    if (primeiro.outcome !== 'CREATED' || segundo.outcome !== 'CREATED') throw new Error('criados');

    const n1 = Number(primeiro.protocol.split('-')[2]);
    const n2 = Number(segundo.protocol.split('-')[2]);
    expect(n2).toBe(n1 + 1);
  }, 30_000);

  it('a tabela de sequencia existe e guarda o contador', async () => {
    const base = await seedBase();
    await openRequest.open(inputFor(base, 'Contagem'), undefined, NOW);
    const rows = await dataSource.query(
      `SELECT "year","last_value" FROM ${PROTOCOL_SEQUENCE_TABLE} WHERE "year" = $1`,
      [2026],
    );
    expect(rows).toHaveLength(1);
    expect(Number((rows[0] as { last_value: string }).last_value)).toBeGreaterThan(0);
  }, 30_000);
});

describe('criterio 8: conflito de versao sem perda silenciosa', () => {
  it('duas atualizacoes simultaneas geram conflito controlado', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Concorrencia de versao'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    // Duas pessoas leem a MESMA versao e tentam alterar.
    const rows = await dataSource.query(`SELECT "version" FROM "requests" WHERE "id" = $1`, [criada.requestId]);
    const versaoLida = (rows[0] as { version: number }).version;

    const primeiro = await workflow.apply('START_REVIEW', {
      requestId: criada.requestId,
      expectedVersion: versaoLida,
      actorUserId: base.citizenId,
      now: NOW,
      publicText: 'Em analise',
    });
    expect(primeiro.ok).toBe(true);

    // A segunda pessoa ainda tem a versao antiga em maos.
    // O conflito e um ERRO DE DOMINIO lancado, nao um retorno: a camada HTTP
    // traduz `VersionConflictError` em 409. Nao ha sobrescrita silenciosa.
    await expect(
      workflow.apply('REQUEST_INFORMATION', {
        requestId: criada.requestId,
        expectedVersion: versaoLida,
        actorUserId: base.citizenId,
        now: NOW,
        publicText: 'Precisamos de uma informacao',
      }),
    ).rejects.toThrow(VersionConflictError);

    // A primeira alteracao permanece intacta: nada foi sobrescrito.
    const estado = await dataSource.query(`SELECT "state","version" FROM "requests" WHERE "id" = $1`, [
      criada.requestId,
    ]);
    expect((estado[0] as { state: string }).state).toBe('IN_REVIEW');
    expect((estado[0] as { version: number }).version).toBe(versaoLida + 1);
  }, 30_000);

  it('a versao correta nao gera conflito', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Sequencia sem conflito'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    await advanceToReview(criada.requestId, base.citizenId);
    // Com a versao atual, a transicao passa normalmente.
    const segunda = await workflow.apply('REQUEST_INFORMATION', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: NOW,
      publicText: 'Precisamos de uma informacao',
    });
    expect(segunda.ok).toBe(true);
    // `ok` ja foi verificado acima; o estreitamento explicito impede que o
    // compilador trate `state` como possivelmente indefinido.
    if (!segunda.ok) throw new Error('a transicao deveria ter sido aplicada');
    expect(segunda.state).toBe('WAITING_CITIZEN');
  }, 30_000);

  it('resposta do cidadao retorna ao estado anterior e encerra a pausa', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Complementacao persistida'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    await advanceToReview(criada.requestId, base.citizenId);
    const pedido = await workflow.apply('REQUEST_INFORMATION', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: NOW,
      publicText: 'Envie o numero da unidade de atendimento',
    });
    expect(pedido.ok).toBe(true);

    const resposta = await workflow.apply('PROVIDE_INFORMATION', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: new Date(NOW.getTime() + 60 * 60_000),
      publicText: 'Informacao enviada pelo cidadao',
    });
    expect(resposta.ok).toBe(true);
    if (!resposta.ok) throw new Error('resposta deveria ser aceita');
    expect(resposta.state).toBe('IN_REVIEW');

    const estado = await dataSource.query(
      `SELECT "state_before_waiting" FROM "requests" WHERE "id" = $1`,
      [criada.requestId],
    );
    const informacoes = await dataSource.query(
      `SELECT "status","answered_at" FROM "information_requests" WHERE "request_id" = $1`,
      [criada.requestId],
    );
    const pausas = await dataSource.query(
      `SELECT "ended_at" FROM "sla_pauses" WHERE "request_id" = $1`,
      [criada.requestId],
    );
    expect((estado[0] as { state_before_waiting: string | null }).state_before_waiting).toBeNull();
    expect((informacoes[0] as { status: string; answered_at: Date | null }).status).toBe('ANSWERED');
    expect((informacoes[0] as { status: string; answered_at: Date | null }).answered_at).not.toBeNull();
    expect((pausas[0] as { ended_at: Date | null }).ended_at).not.toBeNull();
  }, 30_000);

  it('cancelamento durante a espera encerra a pausa e a solicitacao pendente', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Cancelamento durante complementacao'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    await advanceToReview(criada.requestId, base.citizenId);
    const pedido = await workflow.apply('REQUEST_INFORMATION', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: NOW,
      publicText: 'Envie uma informacao adicional',
    });
    expect(pedido.ok).toBe(true);

    const cancelamento = await workflow.apply('CANCEL', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: new Date(NOW.getTime() + 30 * 60_000),
      publicText: 'O cidadao pediu o cancelamento da solicitacao.',
      reason: 'Cancelamento solicitado pelo cidadao',
    });
    expect(cancelamento.ok).toBe(true);

    const estado = await dataSource.query(
      `SELECT "state","state_before_waiting" FROM "requests" WHERE "id" = $1`,
      [criada.requestId],
    );
    const informacoes = await dataSource.query(
      `SELECT "status" FROM "information_requests" WHERE "request_id" = $1`,
      [criada.requestId],
    );
    const pausas = await dataSource.query(
      `SELECT "ended_at" FROM "sla_pauses" WHERE "request_id" = $1`,
      [criada.requestId],
    );
    expect((estado[0] as { state: string; state_before_waiting: string | null }).state).toBe('CANCELED');
    expect((estado[0] as { state: string; state_before_waiting: string | null }).state_before_waiting).toBeNull();
    expect((informacoes[0] as { status: string }).status).toBe('CANCELLED');
    expect((pausas[0] as { ended_at: Date | null }).ended_at).not.toBeNull();
  }, 30_000);
});

/** Le a versao atual de um pedido. */
async function currentVersion(requestId: string): Promise<number> {
  const rows = await dataSource.query(`SELECT "version" FROM "requests" WHERE "id" = $1`, [requestId]);
  return (rows[0] as { version: number }).version;
}

/**
 * Leva o pedido de SUBMITTED ate IN_REVIEW, que e de onde a conclusao e
 * valida. O caminho SUBMITTED -> IN_REVIEW e o inicial exigido pela secao 6.
 */
async function advanceToReview(requestId: string, actorUserId: string): Promise<void> {
  const primeira = await workflow.apply('START_REVIEW', {
    requestId,
    expectedVersion: await currentVersion(requestId),
    actorUserId,
    now: NOW,
    publicText: 'Sua solicitacao esta em analise',
  });
  if (!primeira.ok) {
    throw new Error(`START_REVIEW falhou: ${String(primeira.error)}`);
  }
}

describe('transicoes e conclusao (criterio 12)', () => {
  it('concluir sem resultado e recusado pelo banco', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Conclusao invalida'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    // A restricao do banco e a ultima linha de defesa: mesmo que a aplicacao
    // falhasse, o CHECK impede conclusao sem resultado.
    await expect(
      dataSource.query(`UPDATE "requests" SET "state" = 'COMPLETED', "completed_at" = $1 WHERE "id" = $2`, [
        NOW,
        criada.requestId,
      ]),
    ).rejects.toBeDefined();
  }, 30_000);

  it('conclusao com resultado e justificativa e aceita', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Conclusao valida'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');
    await advanceToReview(criada.requestId, base.citizenId);

    const resultado = await workflow.apply(
      'COMPLETE',
      {
        requestId: criada.requestId,
        expectedVersion: await currentVersion(criada.requestId),
        actorUserId: base.citizenId,
        now: NOW,
        publicText: 'Orientacao enviada',
        justification: 'Enviamos a lista de unidades com consulta naificacao',
        outcome: 'RESOLVED',
      } as never,
    );
    expect(resultado.ok).toBe(true);

    const final = await dataSource.query(`SELECT "state","outcome" FROM "requests" WHERE "id" = $1`, [
      criada.requestId,
    ]);
    expect((final[0] as { state: string }).state).toBe('COMPLETED');
    expect((final[0] as { outcome: string }).outcome).toBe('RESOLVED');
  }, 30_000);

  it('negativa fica registrada com o resultado correto', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Fora de competencia'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');
    await advanceToReview(criada.requestId, base.citizenId);

    const resultado = await workflow.apply(
      'COMPLETE',
      {
        requestId: criada.requestId,
        expectedVersion: await currentVersion(criada.requestId),
        actorUserId: base.citizenId,
        now: NOW,
        publicText: 'Este assunto e de outro orgao',
        justification: 'O assunto e de competencia da unidade estadual',
        outcome: 'OUT_OF_SCOPE',
      } as never,
    );
    expect(resultado.ok).toBe(true);

    // Negativa e resultado DISTINTO de resolucao: nao pode alimentar o
    // indicador de resolucoes.
    const final = await dataSource.query(`SELECT "outcome" FROM "requests" WHERE "id" = $1`, [criada.requestId]);
    expect((final[0] as { outcome: string }).outcome).toBe('OUT_OF_SCOPE');
  }, 30_000);

  it('conclusao direto de SUBMITTED e recusado pela tabela de transicoes', async () => {
    // A tabela de regras e a fonte de verdade: de SUBMITTED so se avanca para
    // IN_REVIEW. Concluir direto pularia a etapa de analise.
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Pulo de etapa'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    const resultado = await workflow.apply(
      'COMPLETE',
      {
        requestId: criada.requestId,
        expectedVersion: await currentVersion(criada.requestId),
        actorUserId: base.citizenId,
        now: NOW,
        publicText: 'Concluido',
        justification: 'Tentativa de pular a analise',
        outcome: 'RESOLVED',
      } as never,
    );
    expect(resultado.ok).toBe(false);
    if (resultado.ok === false) expect(resultado.error).toBe('ILLEGAL_TRANSITION');
  }, 30_000);

  it('o ciclo fecha e o tempo fica registrado', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Ciclo completo'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');
    await advanceToReview(criada.requestId, base.citizenId);
    await workflow.apply(
      'COMPLETE',
      {
        requestId: criada.requestId,
        expectedVersion: await currentVersion(criada.requestId),
        actorUserId: base.citizenId,
        now: NOW,
        publicText: 'Concluida',
        justification: 'Atendimento realizado',
        outcome: 'RESOLVED',
      } as never,
    );

    const ciclos = await dataSource.query(
      `SELECT "cycle_number","closed_at" FROM "request_cycles" WHERE "request_id" = $1`,
      [criada.requestId],
    );
    expect(ciclos).toHaveLength(1);
    // O ciclo encerrado preserva o tempo medido, em vez de sumir.
    expect((ciclos[0] as { closed_at: Date | null }).closed_at).not.toBeNull();
  }, 30_000);

  it('reabertura cria um novo ciclo e reinicia o relogio do ciclo', async () => {
    const base = await seedBase();
    const criada = await openRequest.open(inputFor(base, 'Pedido que sera reaberto'), undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');
    await advanceToReview(criada.requestId, base.citizenId);
    const conclusao = await workflow.apply('COMPLETE', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: NOW,
      publicText: 'Pedido concluido inicialmente',
      justification: 'A primeira analise foi concluida.',
      outcome: 'RESOLVED',
     } as never);
    expect(conclusao.ok).toBe(true);

    const negativa = await workflow.apply('DECIDE_REOPEN_DENY', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: new Date(NOW.getTime() + 30 * 60_000),
      publicText: 'A solicitacao de reabertura nao foi aprovada.',
      reason: 'Nao foram apresentados elementos novos.',
    });
    expect(negativa.ok).toBe(true);
    if (!negativa.ok) throw new Error('negativa deveria ser aceita');
    expect(negativa.state).toBe('COMPLETED');

    const reabertura = await workflow.apply('REOPEN', {
      requestId: criada.requestId,
      expectedVersion: await currentVersion(criada.requestId),
      actorUserId: base.citizenId,
      now: new Date(NOW.getTime() + 60 * 60_000),
      publicText: 'O cidadao apresentou nova informacao para reanalise.',
      reason: 'Nova informacao apresentada',
    });
    expect(reabertura.ok).toBe(true);
    if (!reabertura.ok) throw new Error('reabertura deveria ser aceita');
    expect(reabertura.state).toBe('IN_REVIEW');

    const estado = await dataSource.query(
      `SELECT "state","cycle_number","cycle_started_at","completed_at","outcome"
         FROM "requests" WHERE "id" = $1`,
      [criada.requestId],
    );
    const ciclos = await dataSource.query(
      `SELECT "cycle_number","started_at","closed_at","from_reopen"
         FROM "request_cycles" WHERE "request_id" = $1 ORDER BY "cycle_number"`,
      [criada.requestId],
    );
    expect((estado[0] as { state: string; cycle_number: number }).state).toBe('IN_REVIEW');
    expect(Number((estado[0] as { cycle_number: number }).cycle_number)).toBe(2);
    expect((estado[0] as { completed_at: Date | null }).completed_at).toBeNull();
    expect((estado[0] as { outcome: string | null }).outcome).toBeNull();
    expect(ciclos).toHaveLength(2);
    expect((ciclos[0] as { closed_at: Date | null }).closed_at).not.toBeNull();
    expect((ciclos[1] as { from_reopen: boolean; closed_at: Date | null }).from_reopen).toBe(true);
    expect((ciclos[1] as { from_reopen: boolean; closed_at: Date | null }).closed_at).toBeNull();
  }, 30_000);
});

describe('localizacao espacial', () => {
  it('grava ponto geography e aceita consulta por distancia', async () => {
    const base = await seedBase();
    const input = {
      ...inputFor(base, 'Lampada apagada na rua principal'),
      location: {
        addressText: 'Rua Principal, centro',
        locality: 'Centro',
        latitude: -8.5861,
        longitude: -34.7925,
        precisionSource: 'MAP_PICK' as const,
        precisionMeters: 20,
      },
    };
    const criada = await openRequest.open(input, undefined, NOW);
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    // Consulta por distancia real do PostGIS, usando o indice GiST.
    const perto = await dataSource.query(
      `SELECT "id", ST_Distance("point", ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS metros
         FROM "request_locations"
        WHERE "request_id" = $3
          AND ST_DWithin("point", ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 1000)`,
      [-34.7925, -8.5861, criada.requestId],
    );
    expect(perto).toHaveLength(1);
    expect(Number((perto[0] as { metros: string }).metros)).toBeLessThan(10);
  }, 30_000);
});
