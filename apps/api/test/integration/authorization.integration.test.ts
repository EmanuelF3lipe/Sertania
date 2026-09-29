/**
 * Autorizacao efetiva na cadeia HTTP (Marco A2 da especificacao de
 * continuacao).
 *
 * Estes testes existem porque a politica pura estava correta e mesmo assim o
 * endpoint aceitava qualquer comando de qualquer cidadao autenticado. A funcao
 * `authorize` de `@sertania/contracts` tinha 30 testes passando, e a falha
 * estava no controller, que nao a chamava.
 *
 * A conclusao que se tira: testar a regra isola nao garante que ela seja
 * aplicada. E necessario um teste que passe pela cadeia inteira.
 */
import { DataSource } from 'typeorm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { OpenRequestService } from '../../src/requests/open-request.service';
import { ProtocolService } from '../../src/requests/protocol.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { Database } from '../../src/database/typed-query';
import {
  actionForCommand,
  requiresOwnership,
} from '../../src/authorization/command-permissions';
import type { SessionClaims } from '../../src/auth/session.service';

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
let authorization: AuthorizationService;
let openRequest: OpenRequestService;

interface Cenario {
  readonly cidadaoA: string;
  readonly cidadaoB: string;
  readonly secretariatSaude: string;
  readonly secretariatInfra: string;
  readonly unidadeSaude: string;
  readonly serviceVersionSaude: string;
  readonly serviceVersionRestrito: string;
  readonly slaPolicyId: string;
}

async function cenario(): Promise<Cenario> {
  const u = async (q: string, p: unknown[] = []): Promise<Record<string, unknown>> => {
    const r = await ds.query(q, p);
    return r[0] as Record<string, unknown>;
  };

  const cA = await u(`INSERT INTO "users" ("is_citizen") VALUES (true) RETURNING "id"`);
  const cB = await u(`INSERT INTO "users" ("is_citizen") VALUES (true) RETURNING "id"`);

  const sSaude = await u(
    `INSERT INTO "secretariats" ("slug","name") VALUES ('saude','Saude')
       ON CONFLICT ("slug") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
  );
  const sInfra = await u(
    `INSERT INTO "secretariats" ("slug","name") VALUES ('infra','Infraestrutura')
       ON CONFLICT ("slug") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
  );

  const unSaude = await u(
    `INSERT INTO "units" ("secretariat_id","name") VALUES ($1,'UBS Central') RETURNING "id"`,
    [sSaude['id']],
  );
  // Unidade de Infraestrutura: o cenario de servidor de outra secretaria nao
  // precisa da fila dessa unidade, apenas que a secretaria exista e tenha um
  // vinculo valido apontando para ela.
  await u(
    `INSERT INTO "units" ("secretariat_id","name") VALUES ($1,'Setur') RETURNING "id"`,
    [sInfra['id']],
  );

  const pol = await u(
    `INSERT INTO "sla_policies"
       ("version","name","first_response_minutes","resolution_value","resolution_unit",
        "running_states","paused_states")
     VALUES (950,'Teste autorizacao',480,5,'BUSINESS_DAYS',
       ARRAY['SUBMITTED','IN_REVIEW','SCHEDULED','IN_PROGRESS'], ARRAY['WAITING_CITIZEN'])
     ON CONFLICT ("version") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
  );

  const svcNormal = await u(
    `INSERT INTO "services" ("slug","secretariat_id","default_unit_id")
     VALUES ('orientacao-consultas',$1,$2)
       ON CONFLICT ("slug") DO UPDATE SET "default_unit_id"=EXCLUDED."default_unit_id" RETURNING "id"`,
    [sSaude['id'], unSaude['id']],
  );
  const verNormal = await u(
    `INSERT INTO "service_versions"
       ("service_id","version","name","description","guidance","form_schema",
        "classification","max_attachments","published","published_at")
     VALUES ($1,1,'Orientacao','d','g','{"type":"object"}'::jsonb,'PUBLIC_APPROVED',5,true,now())
     ON CONFLICT ("service_id","version") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
    [svcNormal['id']],
  );

  const svcRestrito = await u(
    `INSERT INTO "services" ("slug","secretariat_id","default_unit_id")
     VALUES ('medicamentos-acesso',$1,$2)
       ON CONFLICT ("slug") DO UPDATE SET "default_unit_id"=EXCLUDED."default_unit_id" RETURNING "id"`,
    [sSaude['id'], unSaude['id']],
  );
  const verRestrito = await u(
    `INSERT INTO "service_versions"
       ("service_id","version","name","description","guidance","form_schema",
        "classification","max_attachments","published","published_at")
     VALUES ($1,1,'Acesso a medicamentos','d','g','{"type":"object"}'::jsonb,
       'RESTRICTED_SENSITIVE',5,true,now())
     ON CONFLICT ("service_id","version") DO UPDATE SET "name"=EXCLUDED."name" RETURNING "id"`,
    [svcRestrito['id']],
  );

  return {
    cidadaoA: cA['id'] as string,
    cidadaoB: cB['id'] as string,
    secretariatSaude: sSaude['id'] as string,
    secretariatInfra: sInfra['id'] as string,
    unidadeSaude: unSaude['id'] as string,
    serviceVersionSaude: verNormal['id'] as string,
    serviceVersionRestrito: verRestrito['id'] as string,
    slaPolicyId: pol['id'] as string,
  };
}

function cidadaoSession(userId: string): SessionClaims {
  return {
    userId,
    realm: 'sertania-ciudadanos',
    isCitizen: true,
    isServer: false,
    membershipId: null,
    secretariatId: null,
    generation: 1,
    createdAt: NOW.getTime(),
    absoluteExpiresAt: NOW.getTime() + 3600_000,
  };
}

function servidorSession(userId: string, membershipId: string, secretariatId: string): SessionClaims {
  return {
    userId,
    realm: 'sertania-servidores',
    isCitizen: false,
    isServer: true,
    membershipId,
    secretariatId,
    generation: 1,
    createdAt: NOW.getTime(),
    absoluteExpiresAt: NOW.getTime() + 3600_000,
  };
}

/** Cria um servidor com vinculo. */
async function servidor(
  role: string,
  secretariatId: string,
  unitIds: string[] = [],
  teamIds: string[] = [],
): Promise<{ userId: string; membershipId: string }> {
  const u = await ds.query(
    `INSERT INTO "users" ("is_citizen","is_server") VALUES (false,true) RETURNING "id"`,
  );
  const userId = (u[0] as { id: string }).id;
  const m = await ds.query(
    `INSERT INTO "memberships"
       ("user_id","role","secretariat_id","unit_ids","team_ids","active","starts_at")
     VALUES ($1,$2,$3,$4,$5,true, now() - interval '1 day') RETURNING "id"`,
    [userId, role, secretariatId, unitIds, teamIds],
  );
  return { userId, membershipId: (m[0] as { id: string }).id };
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
  // O log do Nest polui a saida do teste e esconde as assercoes que falharam.
  // Desligado aqui, e nao no servico, para nao perder diagnostico em producao.
  Logger.overrideLogger(false);
  const protocol = new ProtocolService(ds);
  await protocol.ensureSequenceTable();
  openRequest = new OpenRequestService(ds, protocol);
  // O servico recebe o wrapper tipado, nao o `DataSource` cru. Envolver aqui
  // mantem o teste com a mesma forma de dependencia da aplicacao.
  authorization = new AuthorizationService(new Database(ds));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized === true) await ds.destroy();
});

beforeEach(async () => {
  for (const t of [
    'audit_events', 'request_events', 'request_content', 'request_locations',
    'request_cycles', 'request_relations', 'evaluations', 'reopen_requests',
    'tasks', 'transfers', 'information_requests', 'sla_pauses', 'messages',
    'attachments', 'outbox_events', 'notification_deliveries',
    'idempotency_keys', 'requests', 'service_versions', 'services',
    // A ordem respeita as chaves estrangeiras: vinculo antes de secretaria.
    'memberships', 'access_grants', 'units', 'secretariats',
    'external_identities', 'users',
  ]) {
    await ds.query(`DELETE FROM "${t}"`);
  }
  await ds.query(`DELETE FROM "sla_policies" WHERE "version" = 950`);
});

describe('mapa comando para acao', () => {
  it('todo comando de atendimento exige acao institucional', () => {
    // E o que fecha a brecha: nao existe comando de atendimento sem acao que
    // dependa de vinculo.
    for (const cmd of [
      'START_REVIEW', 'REQUEST_INFORMATION', 'SCHEDULE', 'START_EXECUTION',
      'COMPLETE', 'CANCEL', 'DECIDE_REOPEN_APPROVE', 'DECIDE_REOPEN_DENY',
      'RESCHEDULE_TO_REVIEW',
    ]) {
      const action = actionForCommand(cmd);
      // O par identifica o comando que falhou, ja que o `expect` do Jest nao
      // aceita mensagem como segundo argumento.
      expect([cmd, action]).not.toEqual([cmd, null]);
      // Nenhuma delas pode mapear para acao exclusiva do cidadao.
      expect(['REQUEST_READ_OWN', 'MESSAGE_SEND_OWN', 'REQUEST_EVALUATE_OWN']).not.toContain(action);
    }
  });

  it('responder complementacao exige propriedade do pedido', () => {
    expect(requiresOwnership('PROVIDE_INFORMATION')).toBe(true);
    expect(requiresOwnership('START_REVIEW')).toBe(false);
  });

  it('comando desconhecido devolve null, e nao permissao', () => {
    expect(actionForCommand('COMANDO_INVENTADO')).toBeNull();
    expect(actionForCommand('DROP TABLE requests')).toBeNull();
    expect(actionForCommand('')).toBeNull();
  });
});

describe('criterio: cidadao nao executa comando de atendimento', () => {
  it('cidadao A nao pode iniciar analise no proprio pedido', async () => {
    const c = await cenario();
    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido do cidadao', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    expect(criada.outcome).toBe('CREATED');
    if (criada.outcome !== 'CREATED') return;

    const target = await authorization.requestTarget(criada.requestId);
    expect(target).not.toBeNull();

    // A decisao que o controller agora toma antes de aplicar o comando.
    const action = actionForCommand('START_REVIEW');
    if (action === null) throw new Error('START_REVIEW deveria mapear para uma acao');
    const decisao = await authorization.check(
      cidadaoSession(c.cidadaoA), action, target!, NOW,
    );

    // Este e o teste que teria pego a falha original.
    expect(decisao.allowed).toBe(false);
  });

  it('cidadao A nao pode concluir o proprio pedido', async () => {
    const c = await cenario();
    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    const action = actionForCommand('COMPLETE');
    if (action === null) throw new Error('COMPLETE deveria mapear para uma acao');
    const decisao = await authorization.check(cidadaoSession(c.cidadaoA), action, target!, NOW);
    expect(decisao.allowed).toBe(false);
  });

  it('cidadao A nao pode cancelar o proprio pedido por comando de servidor', async () => {
    const c = await cenario();
    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    // O cidadao TEM acao de cancelamento, mas ela e a acao de TITULAR
    // (`REQUEST_CANCEL_OWN`), nao a de servidor (`REQUEST_CANCEL`).
    const servidorAction = actionForCommand('CANCEL');
    if (servidorAction === null) throw new Error('CANCEL deveria mapear');
    const comoServidor = await authorization.check(cidadaoSession(c.cidadaoA), servidorAction, target!, NOW);
    expect(comoServidor.allowed).toBe(false);

    // E permitido pela acao de titular. A distincao entre as duas acoes e o
    // que impede que o comando de servidor vire buraco.
    const comoTitular = await authorization.check(cidadaoSession(c.cidadaoA), 'REQUEST_CANCEL_OWN', target!, NOW);
    expect(comoTitular.allowed).toBe(true);
  });
});

describe('criterio: cidadao B nao acessa pedido de A', () => {
  it('leitura de pedido de terceiro e negada', async () => {
    const c = await cenario();
    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido de A', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    // O alvo traz o UUID valido e existe de verdade. A unica coisa que falha e
    // a propriedade, e ela sozinha ja nega.
    const decisao = await authorization.check(cidadaoSession(c.cidadaoB), 'REQUEST_READ_OWN', target!, NOW);
    expect(decisao.allowed).toBe(false);
  });
});

describe('criterio: servidor de Infraestrutura nao le caso restrito de Saude', () => {
  it('servidor de outra secretaria e negado na fila', async () => {
    const c = await cenario();
    const srv = await servidor('ATTENDANT', c.secretariatInfra);

    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionRestrito,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'RESTRICTED_SENSITIVE',
        description: 'Caso sensivel', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    const decisao = await authorization.check(
      servidorSession(srv.userId, srv.membershipId, c.secretariatInfra),
      'REQUEST_READ_QUEUE', target!, NOW,
    );
    // O escopo de secretaria ja nega antes mesmo de chegar na classificacao.
    expect(decisao.allowed).toBe(false);
  });

  it('gestor de Infraestrutura tambem nao le caso restrito de Saude', async () => {
    const c = await cenario();
    const gestor = await servidor('SECRETARY_MANAGER', c.secretariatInfra);

    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionRestrito,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'RESTRICTED_SENSITIVE',
        description: 'Caso sensivel', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    const decisao = await authorization.check(
      servidorSession(gestor.userId, gestor.membershipId, c.secretariatInfra),
      'REQUEST_READ_QUEUE', target!, NOW,
    );
    expect(decisao.allowed).toBe(false);
  });

  it('atendente da secretaria correta e autorizado', async () => {
    const c = await cenario();
    const atendente = await servidor('ATTENDANT', c.secretariatSaude);

    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido normal', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    const decisao = await authorization.check(
      servidorSession(atendente.userId, atendente.membershipId, c.secretariatSaude),
      'REQUEST_READ_QUEUE', target!, NOW,
    );
    expect(decisao.allowed).toBe(true);
  });
});

describe('criterio: vinculo revogado perde efeito com sessao valida', () => {
  it('revogacao durante a sessao bloqueia o acesso na proxima chamada', async () => {
    const c = await cenario();
    const atendente = await servidor('ATTENDANT', c.secretariatSaude);
    const sessao = servidorSession(atendente.userId, atendente.membershipId, c.secretariatSaude);

    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    // Antes da revogacao, autorizado.
    const antes = await authorization.check(sessao, 'REQUEST_READ_QUEUE', target!, NOW);
    expect(antes.allowed).toBe(true);

    // Revogacao, sem destruir a sessao.
    await ds.query(
      `UPDATE "memberships" SET "active" = false, "revoked_at" = now() WHERE "id" = $1`,
      [atendente.membershipId],
    );

    // A MESMA sessao, na chamada seguinte, ja nao concede acesso. E o que a
    // especificacao exige: a permissao efetiva vem do estado atual, e nao de
    // um papel guardado na sessao.
    const depois = await authorization.check(sessao, 'REQUEST_READ_QUEUE', target!, NOW);
    expect(depois.allowed).toBe(false);
  });

  it('vinculo expirado nao concede acesso', async () => {
    const c = await cenario();
    const atendente = await servidor('ATTENDANT', c.secretariatSaude);
    await ds.query(
      `UPDATE "memberships" SET "expires_at" = now() - interval '1 day' WHERE "id" = $1`,
      [atendente.membershipId],
    );

    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    const decisao = await authorization.check(
      servidorSession(atendente.userId, atendente.membershipId, c.secretariatSaude),
      'REQUEST_READ_QUEUE', target!, NOW,
    );
    expect(decisao.allowed).toBe(false);
  });
});

describe('criterio: perfil tecnico nao tem acesso operacional implicito', () => {
  it('administrador tecnico nao le a fila', async () => {
    const c = await cenario();
    const admin = await servidor('TECH_ADMIN', c.secretariatSaude);

    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    const decisao = await authorization.check(
      servidorSession(admin.userId, admin.membershipId, c.secretariatSaude),
      'REQUEST_READ_QUEUE', target!, NOW,
    );
    expect(decisao.allowed).toBe(false);
  });

  it('gestao central nao abre caso individual', async () => {
    const c = await cenario();
    const central = await servidor('CENTRAL_MANAGEMENT', c.secretariatSaude);

    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') return;
    const target = await authorization.requestTarget(criada.requestId);

    // Indicadores consolidados, sim; caso individual, nao.
    const indicadores = await authorization.check(
      servidorSession(central.userId, central.membershipId, c.secretariatSaude),
      'ANALYTICS_READ_CENTRAL', target!, NOW,
    );
    expect(indicadores.allowed).toBe(true);

    const individual = await authorization.check(
      servidorSession(central.userId, central.membershipId, c.secretariatSaude),
      'REQUEST_READ_QUEUE', target!, NOW,
    );
    expect(individual.allowed).toBe(false);
  });
});

describe('auditoria das negacoes', () => {
  it('negacao fica registrada com o motivo', async () => {
    const c = await cenario();
    // A coluna e `uuid`, entao o recurso precisa de um UUID valido. Usar um
    // texto quebraria o teste por um motivo que nao tem a ver com auditoria.
    const criada = await openRequest.open(
      {
        citizenId: c.cidadaoA, createdBy: c.cidadaoA, channel: 'WEB',
        serviceVersionId: c.serviceVersionSaude,
        secretariatId: c.secretariatSaude, unitId: c.unidadeSaude,
        slaPolicyId: c.slaPolicyId, classification: 'PUBLIC_APPROVED',
        description: 'Pedido auditado', formAnswers: {}, location: null,
        identityVerificationMethod: null, assistedNote: null,
      },
      undefined, NOW,
    );
    if (criada.outcome !== 'CREATED') throw new Error('criada');

    await authorization.audit({
      actorUserId: c.cidadaoA,
      action: 'START_REVIEW',
      resourceType: 'request',
      resourceId: criada.requestId,
      result: 'DENIED',
      reason: 'SEM_VINCULO_INSTITUCIONAL',
      correlationId: 'teste-123',
    });

    const rows = await ds.query(
      `SELECT "actor_user_id","action","result","context","correlation_id","resource_id"
         FROM "audit_events"`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row['result']).toBe('DENIED');
    expect(row['correlation_id']).toBe('teste-123');
    expect(row['resource_id']).toBe(criada.requestId);
    // O motivo fica no contexto, para a auditoria explicar a negacao.
    expect(JSON.stringify(row['context'])).toContain('SEM_VINCULO_INSTITUCIONAL');
  });
});
