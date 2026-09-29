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
  readonly dueAt: string | null;
  readonly version: number;
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
  readonly dueAt: string | null;
  readonly dueAtText: string;
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
  readonly internalNote: string | null;
  readonly timeline: readonly LinhaDoTempo[];
  readonly allowedCommands: readonly string[];
}
