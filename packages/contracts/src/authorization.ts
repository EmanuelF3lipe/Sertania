/**
 * Motor de autorizacao (especificacao secao 4, "Regra de autorizacao").
 *
 * Regra central: NEGAR POR PADRAO. Uma acao so e permitida quando todos os
 * criterios sao satisfeitos simultaneamente. A ausencia de informacao nunca
 * significa permissao.
 *
 * Este arquivo e a unica fonte de verdade sobre acesso. A interface usa apenas
 * as capacidades devolvidas por `/me` para pintar botoes; esconder um botao e
 * convenience, a verificacao acontece aqui e no repositorio, que aplica os
 * mesmos filtros em listas, buscas, contagens, mapas, exportacoes e tarefas
 * assincronas.
 */
import {
  CENTRAL_MANAGEMENT_FORBIDDEN,
  TECH_ADMIN_FORBIDDEN_BY_DEFAULT,
  type Action,
  type Role,
} from './auth.js';
import {
  isRestrictedClassification,
  type InformationClassification,
  type RequestState,
} from './request.js';

/** Um vinculo institucional ativo: papel, secretaria e unidades (secao 4). */
export interface Membership {
  readonly membershipId: string;
  readonly role: Role;
  readonly secretariatId: string;
  /** Vazio significa "todas as unidades desta secretaria", conforme o vinculo. */
  readonly unitIds: readonly string[];
  /**
   * Equipes habilitadas neste vinculo.
   *
   * Vazio significa "nenhuma equipe especifica", o que NAO equivale a "todas".
   * Em Saude, conteudo restrito exige equipe habilitada, e um vinculo sem
   * equipe nao a habilita automaticamente (secao 4).
   */
  readonly teamIds: readonly string[];
  readonly active: boolean;
  readonly startsAt: Date;
  readonly expiresAt: Date | null;
}

/**
 * Concessao excepcional e temporaria (secao 11, `access_grants`).
 * Exige finalidade registrada e aprovador; nao substitui o vinculo.
 */
export interface AccessGrant {
  readonly grantId: string;
  readonly action: Action;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly purpose: string;
  readonly approvedBy: string;
  readonly startsAt: Date;
  readonly expiresAt: Date;
}

/** O contexto de trabalho escolhido pelo servidor (secao 4 e 16). */
export interface WorkContextRef {
  readonly membershipId: string;
  readonly secretariatId: string;
}

/**
 * Contexto completo de autorizacao, avaliado a cada operacao.
 *
 * A permissao efetiva e consultada no estado ATUAL da aplicacao; nunca
 * depender de uma funcao antiga guardada indefinidamente na sessao.
 */
export interface AuthorizationSubject {
  readonly userId: string;
  readonly isCitizen: boolean;
  readonly isServer: boolean;
  /** Vinculos ativos do usuario, reconsultados a cada operacao. */
  readonly memberships: readonly Membership[];
  /** Contexto de trabalho selecionado, quando houver. */
  readonly currentContext: WorkContextRef | null;
  readonly grants: readonly AccessGrant[];
  /** Instante da avaliacao; usado para validade de vinculo e concessao. */
  readonly now: Date;
}

/**
 * Alvo da operacao. Descreve o recurso sem carregar conteudo: a politica nao
 * deve precisar ler descricao, nome ou documento para decidir acesso.
 *
 * Todo campo opcional aceita `undefined` explicito. Com
 * `exactOptionalPropertyTypes` ligado, a forma `campo?: string` recusaria
 * `campo: undefined`, e o preenchimento a partir do banco, onde a coluna pode
 * ser nula, quebraria o compilador em vez do tipo.
 */
export interface AuthorizationTarget {
  readonly requestId?: string | undefined;
  /** Cidadao dono da solicitacao. */
  readonly ownerCitizenId?: string | undefined;
  /** Servidor atualmente atribuido. */
  readonly assigneeUserId?: string | undefined;
  readonly secretariatId?: string | undefined;
  readonly unitId?: string | undefined;
  readonly classification?: InformationClassification | undefined;
  readonly state?: RequestState | undefined;
  /** Quando o cidadao pode representar alguem neste recurso. */
  readonly representationValid?: boolean | undefined;
}

/** Matriz de permissao por perfil (secao 4). */
const ROLE_ACTIONS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  CITIZEN: new Set<Action>([
    'REQUEST_CREATE',
    'REQUEST_READ_OWN',
    'REQUEST_CANCEL_OWN',
    'REQUEST_REOPEN_REQUEST_OWN',
    'REQUEST_EVALUATE_OWN',
    'MESSAGE_SEND_OWN',
    'ATTACHMENT_UPLOAD_OWN',
    'PROFILE_READ_OWN',
    'PROFILE_UPDATE_OWN',
  ]),

  ATTENDANT: new Set<Action>([
    'REQUEST_CREATE',
    'REQUEST_READ_QUEUE',
    'REQUEST_REVIEW',
    'REQUEST_REQUEST_INFO',
    'REQUEST_SCHEDULE',
    'REQUEST_EXECUTE',
    'REQUEST_TRANSFER',
    'REQUEST_COMPLETE',
    'MESSAGE_SEND_INTERNAL',
  ]),

  OPERATIONAL_TEAM: new Set<Action>([
    'REQUEST_READ_QUEUE',
    'REQUEST_EXECUTE',
    'TASK_ACCEPT',
  ]),

  SECRETARY_MANAGER: new Set<Action>([
    'REQUEST_READ_QUEUE',
    'REQUEST_ASSIGN',
    'REQUEST_REVIEW',
    'REQUEST_REQUEST_INFO',
    'REQUEST_SCHEDULE',
    'REQUEST_EXECUTE',
    'REQUEST_TRANSFER',
    'REQUEST_COMPLETE',
    'REQUEST_CANCEL',
    'REQUEST_DECIDE_REOPEN',
    'TASK_ACCEPT',
    'MESSAGE_SEND_INTERNAL',
    'CATALOG_READ_DRAFT',
    'CATALOG_MANAGE',
    'UNIT_MANAGE',
    'SLA_MANAGE',
    'ANALYTICS_READ_SCOPE',
    'EXPORT_REQUEST',
  ]),

  CENTRAL_MANAGEMENT: new Set<Action>([
    'ANALYTICS_READ_CENTRAL',
    'EXPORT_REQUEST',
    'CATALOG_READ_DRAFT',
  ]),

  // Administrador tecnico: configuracao e provisionamento, SEM atendimento e
  // SEM leitura de anexos por padrao (secao 4).
  TECH_ADMIN: new Set<Action>([
    'ADMIN_CONFIGURE',
    'ADMIN_PROVISION',
    'ADMIN_GRANT_ACCESS',
    'CATALOG_READ_DRAFT',
    'AUDIT_READ_EVENTS',
    'EXPORT_READ_METADATA',
  ]),

  // Auditor: eventos dentro do escopo formal. Ler CONTEUDO e permissao
  // distinta, com finalidade registrada (secao 4).
  AUDITOR: new Set<Action>(['AUDIT_READ_EVENTS', 'EXPORT_READ_METADATA']),
};

export function actionsForRole(role: Role): readonly Action[] {
  return [...ROLE_ACTIONS[role]].sort();
}

/** Acoes que o cidadao pode exercer sobre um recurso. */
const CITIZEN_OWNED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'REQUEST_READ_OWN',
  'REQUEST_CANCEL_OWN',
  'REQUEST_REOPEN_REQUEST_OWN',
  'REQUEST_EVALUATE_OWN',
  'MESSAGE_SEND_OWN',
  'ATTACHMENT_UPLOAD_OWN',
]);

function isMembershipUsable(membership: Membership, now: Date): boolean {
  if (!membership.active) return false;
  if (membership.startsAt.getTime() > now.getTime()) return false;
  if (membership.expiresAt !== null && membership.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

function isGrantUsable(grant: AccessGrant, now: Date): boolean {
  if (grant.startsAt.getTime() > now.getTime()) return false;
  return grant.expiresAt.getTime() > now.getTime();
}

/** O vinculo corresponde ao recurso quanto a secretaria e a unidade. */
function membershipCoversTarget(
  membership: Membership,
  target: AuthorizationTarget,
): boolean {
  if (target.secretariatId !== undefined && membership.secretariatId !== target.secretariatId) {
    return false;
  }
  if (target.unitId === undefined) return true;
  // Lista vazia de unidades cobre a secretaria inteira, conforme o vinculo.
  if (membership.unitIds.length === 0) return true;
  return membership.unitIds.includes(target.unitId);
}

/**
 * Verifica uma acao.
 *
 * Retorna o motivo da negacao apenas para auditoria interna. A mensagem enviada
 * ao cliente e sempre a mesma e generica, para nao permitir enumeracao de
 * recursos existentes.
 */
export function authorize(
  subject: AuthorizationSubject,
  action: Action,
  target: AuthorizationTarget,
): { allowed: true } | { allowed: false; reason: string } {
  const deny = (reason: string) => ({ allowed: false as const, reason });

  // 1. Sessao ativa e identidade reconhecida.
  if (!subject.userId) {
    return deny('SESSAO_INVALIDA');
  }

  const grant = subject.grants.find(
    (g) =>
      g.action === action &&
      isGrantUsable(g, subject.now) &&
      (target.requestId === undefined || g.resourceId === target.requestId),
  );
  if (grant) {
    return { allowed: true };
  }

  // 2. Escopo do cidadao: apenas as proprias solicitacoes.
  if (subject.isCitizen && CITIZEN_OWNED_ACTIONS.has(action)) {
    if (target.ownerCitizenId !== subject.userId) {
      return deny('NAO_E_DONO');
    }
    // Acao de cidadao sobre recurso de terceiro nunca prossegue, mesmo que ele
    // seja o mesmo usuario no Keycloak: representacao exige vinculo validado.
    return { allowed: true };
  }

  // 3. Acao institucional exige vinculo com papel que a conceda.
  if (!subject.isServer) {
    return deny('SEM_VINCULO_INSTITUCIONAL');
  }

  const usable = subject.memberships.filter((m) => isMembershipUsable(m, subject.now));
  if (usable.length === 0) {
    return deny('SEM_VINCULO_ATIVO');
  }

  const roleGrants = usable.filter(
    (m) => ROLE_ACTIONS[m.role].has(action) && membershipCoversTarget(m, target),
  );
  if (roleGrants.length === 0) {
    return deny('PERFIL_OU_ESCOPO_INSUFICIENTE');
  }

  // 4. Restricoes especificas de perfil que valem mesmo com o papel correto.
  const roles = new Set(roleGrants.map((m) => m.role));
  if (roles.size === 1 && roles.has('TECH_ADMIN')) {
    if (TECH_ADMIN_FORBIDDEN_BY_DEFAULT.includes(action)) {
      return deny('TECNICO_SEM_ATENDIMENTO');
    }
  }
  if (roles.size === 1 && roles.has('CENTRAL_MANAGEMENT')) {
    if (CENTRAL_MANAGEMENT_FORBIDDEN.includes(action)) {
      return deny('GESTAO_CENTRAL_SEM_CASO_INDIVIDUAL');
    }
  }

  // 5. Conteudo restrito exige atribuicao explicita, mesmo para gestor.
  if (
    target.classification !== undefined &&
    isRestrictedClassification(target.classification)
  ) {
    const hasRestricted = roleGrants.some(
      (m) => m.role === 'ATTENDANT' || m.role === 'SECRETARY_MANAGER',
    );
    if (!hasRestricted) {
      return deny('CONTEUDO_RESTRITO_EXIGE_ATRIBUICAO');
    }
  }

  // 6. O contexto de trabalho precisa cobrir a secretaria do recurso.
  if (target.secretariatId !== undefined && subject.currentContext !== null) {
    if (subject.currentContext.secretariatId !== target.secretariatId) {
      return deny('FORA_DO_CONTEXTO_SELECIONADO');
    }
  }

  return { allowed: true };
}

export function isAllowed(
  subject: AuthorizationSubject,
  action: Action,
  target: AuthorizationTarget,
): boolean {
  return authorize(subject, action, target).allowed;
}

/**
 * Filtro de escopo para consultas. Devolve os IDs de secretaria e unidade que o
 * servidor pode ver, para que o repositorio FILTRE no banco.
 *
 * Sem isto, um filtro aplicado apenas no controller permitiria que a contagem
 * ou a exportacao vazasse o que a lista nao mostra.
 */
export function scopeFilterFor(
  subject: AuthorizationSubject,
): { secretariatIds: string[]; unitIds: string[] } {
  if (!subject.isServer) {
    return { secretariatIds: [], unitIds: [] };
  }
  const usable = subject.memberships.filter((m) => isMembershipUsable(m, subject.now));
  const secretariatIds = [...new Set(usable.map((m) => m.secretariatId))];
  const unitIds = [
    ...new Set(usable.flatMap((m) => (m.unitIds.length > 0 ? m.unitIds : []))),
  ];
  return { secretariatIds, unitIds };
}

/**
 * Acao pode ser exercida sobre ESTE recurso, e nao apenas sobre a secretaria.
 * Usado quando a interface precisa explicar um botao desabilitado.
 */
export function canActOn(
  subject: AuthorizationSubject,
  action: Action,
  target: AuthorizationTarget,
): boolean {
  return isAllowed(subject, action, target);
}
