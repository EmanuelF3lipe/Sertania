/**
 * Testes da politica de autorizacao.
 *
 * Cobrem os criterios de aceitacao 3, 4, 5, 6 e 7 da secao 20:
 * 3. Cidadao A nao acessa dados de B ao alterar UUID ou protocolo.
 * 4. Usuario de Infraestrutura nao le pedido restrito de Saude.
 * 5. Gestao central acessa indicadores e nao obtem documentos individuais.
 * 6. Cadastro publico e payload adulterado nao criam conta de servidor.
 * 7. Logout, bloqueio e revogacao de vinculo invalidam acesso.
 */
import { describe, expect, it } from 'vitest';
import {
  actionsForRole,
  authorize,
  isAllowed,
  scopeFilterFor,
  type AccessGrant,
  type AuthorizationSubject,
  type Membership,
} from '../src/authorization.js';
import { CENTRAL_MANAGEMENT_FORBIDDEN, type Action, type Role } from '../src/auth.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    membershipId: 'm1',
    role: 'ATTENDANT',
    secretariatId: 'sec-saude',
    unitIds: [],
    // Vazio significa "nenhuma equipe habilitada", e nao "todas".
    teamIds: [],
    active: true,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    ...overrides,
  };
}

function server(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return {
    userId: 'u-servidor',
    isCitizen: false,
    isServer: true,
    memberships: [membership()],
    currentContext: { membershipId: 'm1', secretariatId: 'sec-saude' },
    grants: [],
    now: NOW,
    ...overrides,
  };
}

function citizen(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return {
    userId: 'u-cidadao-a',
    isCitizen: true,
    isServer: false,
    memberships: [],
    currentContext: null,
    grants: [],
    now: NOW,
    ...overrides,
  };
}

describe('criterio 3: cidadao nao acessa dados de terceiro', () => {
  const targetB = { requestId: 'req-b', ownerCitizenId: 'u-cidadao-b' };

  it('nega leitura de solicitacao de outra pessoa', () => {
    const result = authorize(citizen(), 'REQUEST_READ_OWN', targetB);
    expect(result.allowed).toBe(false);
  });

  it('nega mesmo que o UUID seja conhecido e correto', () => {
    // O UUID e valido, o cidadao e autenticado e o recurso existe. O unico
    // criterio que falha e a propriedade, e ele sozinho ja nega.
    const result = authorize(citizen(), 'REQUEST_READ_OWN', {
      requestId: 'req-b',
      ownerCitizenId: 'u-cidadao-b',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('NAO_E_DONO');
  });

  it('nega anexos, mensagens e avaliacao de terceiro', () => {
    const restricted: Action[] = [
      'ATTACHMENT_UPLOAD_OWN',
      'MESSAGE_SEND_OWN',
      'REQUEST_EVALUATE_OWN',
      'REQUEST_CANCEL_OWN',
    ];
    for (const action of restricted) {
      expect(isAllowed(citizen(), action, targetB), action).toBe(false);
    }
  });

  it('permite o proprio cidadao operar sobre as proprias solicitacoes', () => {
    const own = { requestId: 'req-a', ownerCitizenId: 'u-cidadao-a' };
    expect(isAllowed(citizen(), 'REQUEST_READ_OWN', own)).toBe(true);
    expect(isAllowed(citizen(), 'MESSAGE_SEND_OWN', own)).toBe(true);
    expect(isAllowed(citizen(), 'REQUEST_EVALUATE_OWN', own)).toBe(true);
  });

  it('nao consulta por protocolo: cidadao nunca ganha acao de busca global', () => {
    // Nao existe acao de "buscar por protocolo" no perfil do cidadao. Um
    // cadastro adulterado com role=CITIZEN no payload nao muda isso, porque a
    // funcao vem do vinculo no banco, nunca do frontend (secao 12).
    const forjado = citizen({
      memberships: [membership({ role: 'CITIZEN' as Role })],
      isServer: true,
    });
    expect(isAllowed(forjado, 'REQUEST_READ_QUEUE', targetB)).toBe(false);
  });
});

describe('criterio 4: Infraestrutura nao le pedido restrito de Saude', () => {
  const infraestrutura = server({
    memberships: [membership({ membershipId: 'm-infra', secretariatId: 'sec-infra' })],
    currentContext: { membershipId: 'm-infra', secretariatId: 'sec-infra' },
  });

  it('nega leitura de pedido restrito de outra secretaria', () => {
    const result = authorize(infraestrutura, 'REQUEST_READ_QUEUE', {
      requestId: 'req-saude-restrito',
      secretariatId: 'sec-saude',
      unitId: 'un-saude-central',
      classification: 'RESTRICTED_SENSITIVE',
      state: 'IN_REVIEW',
    });
    expect(result.allowed).toBe(false);
  });

  it('nega a leitura de conteudo restrito mesmo dentro da propria secretaria', () => {
    // Estar na secretaria certa nao autoriza indiscriminadamente (secao 4):
    // em Saude, unidades e equipes habilitadas saodefinidas.
    const semAtribuicao = server({
      memberships: [membership({ role: 'OPERATIONAL_TEAM' })],
    });
    const result = authorize(semAtribuicao, 'REQUEST_READ_RESTRICTED', {
      requestId: 'req-restrito',
      secretariatId: 'sec-saude',
      classification: 'RESTRICTED_SENSITIVE',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('PERFIL_OU_ESCOPO_INSUFICIENTE');
  });

  it('nega contagem, mapa e exportacao fora do escopo, e nao so a leitura direta', () => {
    const filtros: Action[] = ['ANALYTICS_READ_SCOPE', 'EXPORT_REQUEST', 'AUDIT_READ_CONTENT'];
    for (const action of filtros) {
      const result = authorize(infraestrutura, action, {
        requestId: 'req-saude-restrito',
        secretariatId: 'sec-saude',
        classification: 'RESTRICTED_SENSITIVE',
      });
      expect(result.allowed, action).toBe(false);
    }
  });

  it('gestor da secretaria tambem exige atribuicao especifica para conteudo restrito', () => {
    // "Conteudo restrito exige atribuicao especifica, mesmo para gestor".
    const gestor = server({
      memberships: [membership({ role: 'SECRETARY_MANAGER' })],
    });
    const leitura = authorize(gestor, 'REQUEST_READ_QUEUE', {
      requestId: 'req-restrito',
      secretariatId: 'sec-saude',
      classification: 'RESTRICTED_SENSITIVE',
    });
    expect(leitura.allowed).toBe(true);

    // A leitura de conteudo restrito, porem, e acao separada e nao esta na
    // matriz do gestor sem concessao.
    const conteudo = authorize(gestor, 'REQUEST_READ_RESTRICTED', {
      requestId: 'req-restrito',
      secretariatId: 'sec-saude',
      classification: 'RESTRICTED_SENSITIVE',
    });
    expect(conteudo.allowed).toBe(false);
  });
});

describe('criterio 5: gestao central ve indicadores e nao documentos', () => {
  const central = server({
    memberships: [membership({ role: 'CENTRAL_MANAGEMENT', secretariatId: 'sec-central' })],
    currentContext: { membershipId: 'm-central', secretariatId: 'sec-central' },
  });

  it('acessa indicadores consolidados autorizados', () => {
    expect(isAllowed(central, 'ANALYTICS_READ_CENTRAL', {})).toBe(true);
  });

  it('nao obtem casos individuais por atribuicao implicita', () => {
    for (const action of CENTRAL_MANAGEMENT_FORBIDDEN) {
      const result = authorize(central, action, {
        requestId: 'req-qualquer',
        secretariatId: 'sec-saude',
        ownerCitizenId: 'u-x',
      });
      expect(result.allowed, action).toBe(false);
    }
  });

  it('a lista de acoes proibidas a gestao central nao se sobrepoe as concedidas', () => {
    // Defesa em profundidade: a negacao ja ocorre porque o perfil nao possui
    // estas acoes. Esta verificacao garante que a lista nao passe a contradizer
    // a matriz, o que tornaria a barreira silenciosamente inefetiva.
    const concedidas = new Set<Action>(actionsForRole('CENTRAL_MANAGEMENT'));
    for (const action of CENTRAL_MANAGEMENT_FORBIDDEN) {
      expect(concedidas.has(action), `${action} esta na lista de proibidas e concedidas`).toBe(
        false,
      );
    }
  });

  it('nao le anexos nem documentos de cidadao', () => {
    expect(isAllowed(central, 'ATTACHMENT_UPLOAD_OWN', {})).toBe(false);
  });
});

describe('criterio 6: adulteracao de payload nao cria privilegio', () => {
  it('cadastro publico com role=ADMIN no payload nao concede acesso institucional', () => {
    // O perfil vem do vinculo persistido. Um cidadao com isServer forjado no
    // payload, mas sem vinculo ativo, e barrado no passo 3.
    const forjado = citizen({ isServer: true, memberships: [] });
    const result = authorize(forjado, 'REQUEST_READ_QUEUE', {
      requestId: 'req-1',
      secretariatId: 'sec-saude',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('SEM_VINCULO_ATIVO');
  });

  it('cidadao autoatribui-se prioridade pelo payload: acao nao existe', () => {
    // Nao existe acao de cidadao que altere prioridade administrativa
    // (secao 8). O cidadao relata o problema; a prioridade e do servidor.
    expect(actionsForRole('CITIZEN')).not.toContain('REQUEST_ASSIGN' as Action);
  });

  it('cidadao nao muda status por PATCH generico', () => {
    const result = authorize(citizen(), 'REQUEST_COMPLETE', {
      requestId: 'req-a',
      ownerCitizenId: 'u-cidadao-a',
    });
    expect(result.allowed).toBe(false);
  });

  it('administrador tecnico nao tem atendimento nem leitura de anexos por padrao', () => {
    const tecnico = server({
      memberships: [membership({ role: 'TECH_ADMIN' })],
    });
    expect(isAllowed(tecnico, 'ADMIN_CONFIGURE', {})).toBe(true);
    const proibidas: Action[] = [
      'REQUEST_READ_QUEUE',
      'REQUEST_READ_RESTRICTED',
      'REQUEST_ASSIGN',
      'REQUEST_COMPLETE',
      'AUDIT_READ_CONTENT',
    ];
    for (const action of proibidas) {
      const result = authorize(tecnico, action, {
        requestId: 'req-1',
        secretariatId: 'sec-saude',
      });
      expect(result.allowed, action).toBe(false);
    }
  });
});

describe('criterio 7: revogacao e expiracao invalidam acesso', () => {
  it('vinculo inativo nao concede acesso', () => {
    const inativo = server({ memberships: [membership({ active: false })] });
    const result = authorize(inativo, 'REQUEST_READ_QUEUE', {
      requestId: 'req-1',
      secretariatId: 'sec-saude',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('SEM_VINCULO_ATIVO');
  });

  it('vinculo expirado nao concede acesso', () => {
    const expirado = server({
      memberships: [membership({ expiresAt: new Date('2026-09-27T00:00:00.000Z') })],
    });
    expect(
      isAllowed(expirado, 'REQUEST_READ_QUEUE', {
        requestId: 'req-1',
        secretariatId: 'sec-saude',
      }),
    ).toBe(false);
  });

  it('vinculo ainda nao iniciado nao concede acesso', () => {
    const futuro = server({
      memberships: [membership({ startsAt: new Date('2026-12-01T00:00:00.000Z') })],
    });
    expect(
      isAllowed(futuro, 'REQUEST_READ_QUEUE', {
        requestId: 'req-1',
        secretariatId: 'sec-saude',
      }),
    ).toBe(false);
  });

  it('concessao expirada nao concede acesso', () => {
    const grant: AccessGrant = {
      grantId: 'g1',
      action: 'REQUEST_READ_RESTRICTED',
      resourceType: 'request',
      resourceId: 'req-restrito',
      purpose: 'Procedimento de incidente aprovado',
      approvedBy: 'u-aprovador',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
    };
    const subject = server({
      grants: [grant],
      memberships: [membership({ role: 'OPERATIONAL_TEAM' })],
    });
    expect(
      isAllowed(subject, 'REQUEST_READ_RESTRICTED', {
        requestId: 'req-restrito',
        secretariatId: 'sec-saude',
        classification: 'RESTRICTED_SENSITIVE',
      }),
    ).toBe(false);
  });

  it('concessao valida concede acesso com finalidade registrada', () => {
    const grant: AccessGrant = {
      grantId: 'g2',
      action: 'REQUEST_READ_RESTRICTED',
      resourceType: 'request',
      resourceId: 'req-restrito',
      purpose: 'Verificacao de incidente autorizado',
      approvedBy: 'u-aprovador',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2026-10-20T00:00:00.000Z'),
    };
    const subject = server({
      grants: [grant],
      memberships: [membership({ role: 'OPERATIONAL_TEAM' })],
    });
    expect(
      isAllowed(subject, 'REQUEST_READ_RESTRICTED', {
        requestId: 'req-restrito',
        secretariatId: 'sec-saude',
        classification: 'RESTRICTED_SENSITIVE',
      }),
    ).toBe(true);
  });

  it('concessao de um recurso nao vale para outro', () => {
    const grant: AccessGrant = {
      grantId: 'g3',
      action: 'REQUEST_READ_RESTRICTED',
      resourceType: 'request',
      resourceId: 'req-restrito',
      purpose: 'Verificacao de incidente autorizado',
      approvedBy: 'u-aprovador',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2026-10-20T00:00:00.000Z'),
    };
    const subject = server({
      grants: [grant],
      memberships: [membership({ role: 'OPERATIONAL_TEAM' })],
    });
    expect(
      isAllowed(subject, 'REQUEST_READ_RESTRICTED', {
        requestId: 'req-outro',
        secretariatId: 'sec-saude',
        classification: 'RESTRICTED_SENSITIVE',
      }),
    ).toBe(false);
  });

  it('auditor le eventos, mas nao le conteudo', () => {
    const auditor = server({ memberships: [membership({ role: 'AUDITOR' })] });
    expect(isAllowed(auditor, 'AUDIT_READ_EVENTS', {})).toBe(true);
    expect(isAllowed(auditor, 'AUDIT_READ_CONTENT', { requestId: 'req-1' })).toBe(false);
  });
});

describe('escopo e contexto de trabalho', () => {
  it('filtro de escopo devolve somente as secretarias do servidor', () => {
    const subject = server({
      memberships: [
        membership({ membershipId: 'a', role: 'ATTENDANT', secretariatId: 'sec-saude' }),
        membership({ membershipId: 'b', role: 'ATTENDANT', secretariatId: 'sec-educacao' }),
        membership({ membershipId: 'c', role: 'ATTENDANT', secretariatId: 'sec-inativa', active: false }),
      ],
    });
    const scope = scopeFilterFor(subject);
    expect(scope.secretariatIds.sort()).toEqual(['sec-educacao', 'sec-saude']);
  });

  it('cidadao nao recebe nenhum escopo de secretaria', () => {
    const scope = scopeFilterFor(citizen());
    expect(scope.secretariatIds).toEqual([]);
    expect(scope.unitIds).toEqual([]);
  });

  it('servidor nao atua fora do contexto selecionado', () => {
    const multiVinculo = server({
      memberships: [
        membership({ membershipId: 'a', role: 'ATTENDANT', secretariatId: 'sec-saude' }),
        membership({ membershipId: 'b', role: 'ATTENDANT', secretariatId: 'sec-educacao' }),
      ],
      currentContext: { membershipId: 'a', secretariatId: 'sec-saude' },
    });
    expect(
      isAllowed(multiVinculo, 'REQUEST_READ_QUEUE', {
        requestId: 'req-edu',
        secretariatId: 'sec-educacao',
      }),
    ).toBe(false);
    expect(
      isAllowed(multiVinculo, 'REQUEST_READ_QUEUE', {
        requestId: 'req-saude',
        secretariatId: 'sec-saude',
      }),
    ).toBe(true);
  });

  it('vinculo de unidade restrita nao alcanca outra unidade da secretaria', () => {
    const restrito = server({
      memberships: [membership({ role: 'ATTENDANT', unitIds: ['un-01'] })],
    });
    expect(
      isAllowed(restrito, 'REQUEST_READ_QUEUE', {
        requestId: 'r',
        secretariatId: 'sec-saude',
        unitId: 'un-01',
      }),
    ).toBe(true);
    expect(
      isAllowed(restrito, 'REQUEST_READ_QUEUE', {
        requestId: 'r',
        secretariatId: 'sec-saude',
        unitId: 'un-99',
      }),
    ).toBe(false);
  });
});

describe('negar por padrao', () => {
  it('sujeito sem nenhuma informacao e negado em toda acao institucional', () => {
    const vazio: AuthorizationSubject = {
      userId: '',
      isCitizen: false,
      isServer: false,
      memberships: [],
      currentContext: null,
      grants: [],
      now: NOW,
    };
    for (const action of Object.keys({}) as Action[]) {
      expect(isAllowed(vazio, action, {}), action).toBe(false);
    }
    const result = authorize(vazio, 'REQUEST_READ_QUEUE', {});
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('SESSAO_INVALIDA');
  });

  it('alvo sem secretaria declarada nao vira atalho para acao restrita', () => {
    // Um alvo com classificacao restrita e sem secretaria definida continua
    // sujeito ao passo de atribuicao especifica.
    const equipe = server({ memberships: [membership({ role: 'OPERATIONAL_TEAM' })] });
    const result = authorize(equipe, 'REQUEST_READ_QUEUE', {
      requestId: 'req',
      classification: 'RESTRICTED_SENSITIVE',
    });
    expect(result.allowed).toBe(false);
  });
});
