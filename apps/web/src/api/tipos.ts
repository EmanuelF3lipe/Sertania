/**
 * Tipos que a interface consome, copiados do que a API devolve.
 *
 * Estes tipos NAO sao a fonte de verdade: `@sertania/contracts` e. Eles sao a
 * forma como o servidor responde, e estao aqui para a interface ter o que
 * esperar. Se um DTO mudar, o erro aparece aqui, e nao em um bug de tela.
 */
import type { RequestState } from '@sertania/contracts';

export interface Sessao {
  readonly authenticated: boolean;
  readonly isCitizen: boolean;
  readonly isServer: boolean;
  readonly userId: string | null;
  readonly contexts: readonly ContextoVinculo[];
  readonly can: {
    readonly openRequest: boolean;
    readonly viewQueue: boolean;
    readonly complete: boolean;
    readonly manageServerAccess: boolean;
    readonly manageCatalog: boolean;
    readonly viewDashboard: boolean;
  };
}

export interface ContextoVinculo {
  readonly contextId: string;
  readonly secretariatId: string;
  readonly secretariatName: string;
  readonly unitIds: readonly string[];
  readonly roles: readonly string[];
  readonly isCurrent: boolean;
}

export interface CatalogoPrazo {
  readonly id: string;
  readonly firstResponseMinutes: number;
  readonly resolutionValue: number;
  readonly resolutionUnit: string;
  /** `false` quando o prazo e' SIMULADO e nao' e compromisso municipal. */
  readonly publishedCommitment: boolean;
}

export interface CatalogoServico {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly guidance: string;
  readonly defaultUnitId: string;
  readonly requiresRepresentation: boolean;
  readonly maxAttachments: number;
  readonly formSchema: unknown;
  readonly sla: CatalogoPrazo;
}

export interface CatalogoSecretariat {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly services: readonly CatalogoServico[];
}

export interface Catalogo {
  readonly secretariats: readonly CatalogoSecretariat[];
}

/**
 * Envelope de lista paginada que a API devolve.
 *
 * A interface recebe `{ items, total, limit, offset }` e nao um array direto.
 * Importante porque "carregando" e "vazio" sao estados DIFERENTES: um array
 * vazio sem o `total` impede a tela de dizer "voce nao tem nenhum pedido" sem
 * antes perguntar se a consulta ja terminou.
 */
export interface Pagina<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Fotografia do relogio de prazo calculada pela API no instante da leitura. */
export interface ProgressoSla {
  readonly progressPercent: number;
  readonly elapsedMinutes: number;
  readonly targetMinutes: number;
  readonly remainingMinutes: number;
  readonly businessUnit: boolean;
  readonly dueAt: string | null;
  readonly overdue: boolean;
  readonly paused: boolean;
  readonly publishedCommitment: boolean;
  readonly asOf: string;
}

/** Item da lista de pedidos do cidadao. */
export interface PedidoCidadao {
  readonly id: string;
  readonly protocol: string;
  readonly state: RequestState;
  readonly stateText: string;
  readonly serviceName: string;
  readonly secretariatName: string;
  readonly createdAt: string;
  readonly dueAt: string | null;
  readonly sla: ProgressoSla | null;
  readonly outcome: string | null;
}

/** Linha da fila institucional. */
export interface PedidoOperacao {
  readonly id: string;
  readonly protocol: string;
  readonly state: RequestState;
  readonly stateText: string;
  readonly serviceName: string;
  readonly citizenName: string | null;
  readonly classification: string;
  readonly createdAt: string;
  readonly submittedAt?: string | null;
  readonly dueAt: string | null;
  readonly sla: ProgressoSla | null;
  readonly version: number;
  readonly priority?: string;
  readonly assigneeUserId?: string | null;
}

export interface CatalogoAdminServico {
  readonly id: string;
  readonly slug: string;
  readonly active: boolean;
  readonly defaultUnitId: string | null;
  readonly version: {
    readonly id: string | null;
    readonly number: number | null;
    readonly name: string;
    readonly description: string;
    readonly guidance: string;
    readonly formSchema: unknown;
    readonly classification: string;
    readonly requiresRepresentation: boolean;
    readonly maxAttachments: number;
    readonly published: boolean;
    readonly publishedAt: string | null;
    readonly sla: {
      readonly id: string;
      readonly name: string;
      readonly firstResponseMinutes: number;
      readonly resolutionValue: number;
      readonly resolutionUnit: string;
      readonly publishedCommitment: boolean;
    } | null;
  } | null;
  readonly teams: readonly { readonly id: string; readonly unitId: string; readonly name: string; readonly enabled: boolean }[];
}

export interface CatalogoAdmin {
  readonly secretariats: readonly {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly active: boolean;
    readonly units: readonly { readonly id: string; readonly name: string; readonly locality: string; readonly active: boolean }[];
    readonly services: readonly CatalogoAdminServico[];
  }[];
}

export interface LinhaDoTempo {
  readonly at: string;
  readonly text: string;
}

export interface DetalheCidadao {
  readonly id: string;
  readonly protocol: string;
  readonly state: RequestState;
  readonly stateText: string;
  readonly serviceName: string;
  readonly guidance: string;
  readonly secretariatName: string;
  readonly description: string;
  readonly classification: string;
  readonly createdAt: string;
  readonly version: number;
  readonly dueAt: string | null;
  readonly dueAtText: string;
  readonly scheduledFor: string | null;
  readonly scheduleIsEstimate: boolean;
  readonly sla: ProgressoSla | null;
  readonly outcome: string | null;
  readonly outcomeText: string | null;
  readonly requiresRepresentation: boolean;
  readonly timeline: readonly LinhaDoTempo[];
}

export interface DetalheOperacao {
  readonly id: string;
  readonly protocol: string;
  readonly state: RequestState;
  readonly stateText: string;
  readonly version: number;
  readonly serviceName: string;
  readonly description: string;
  readonly classification: string;
  readonly citizenName: string | null;
  readonly createdAt: string;
  readonly dueAt: string | null;
  readonly dueAtText: string;
  readonly scheduledFor: string | null;
  readonly scheduleIsEstimate: boolean;
  readonly sla: ProgressoSla | null;
  readonly priority?: string;
  readonly assigneeUserId?: string | null;
  readonly internalNote: string | null;
  readonly timeline: readonly LinhaDoTempo[];
  readonly allowedCommands: readonly string[];
}

export interface MensagemPedido {
  readonly id: string;
  readonly visibility: 'CITIZEN_VISIBLE' | 'INTERNAL_ONLY';
  readonly body: string;
  readonly authorUserId: string;
  readonly isMine: boolean;
  readonly createdAt: string;
}

export interface AvaliacaoPedido {
  readonly id: string;
  readonly requestId: string;
  readonly cycleNumber: number;
  readonly rating: number;
  readonly comment: string | null;
  readonly createdAt: string;
}

export interface AnexoPedido {
  readonly id: string;
  readonly detectedMediaType: string;
  readonly sizeBytes: number;
  readonly inspectionState: 'QUARANTINED' | 'SCANNING' | 'RELEASED' | 'REJECTED' | 'ERROR';
  readonly available: boolean;
  readonly createdAt: string;
}
