/**
 * Regras de dominio compartilhadas entre API e interface.
 *
 * Adaptado do repositorio original (packages/contracts/src/workflow.ts):
 * o backend recebe COMANDOS de negocio, nunca um PATCH generico de status.
 * Cada comando so e aceito a partir dos estados listados aqui.
 */

export const STATUS = [
  'RECEBIDA',
  'ENCAMINHADA',
  'AGUARDANDO_CIDADAO',
  'AGENDADA',
  'EM_EXECUCAO',
  'IMPEDIDA',
  'CONCLUIDA',
  'CANCELADA',
] as const;
export type Status = (typeof STATUS)[number];

export const STATUS_ABERTOS: readonly Status[] = [
  'RECEBIDA',
  'ENCAMINHADA',
  'AGUARDANDO_CIDADAO',
  'AGENDADA',
  'EM_EXECUCAO',
  'IMPEDIDA',
];

/** Texto em linguagem simples, mostrado ao cidadao. */
export const STATUS_TEXTO: Record<Status, string> = {
  RECEBIDA: 'Recebida',
  ENCAMINHADA: 'Enviada ao setor responsável',
  AGUARDANDO_CIDADAO: 'Precisamos de uma informação sua',
  AGENDADA: 'Atendimento agendado',
  EM_EXECUCAO: 'Equipe trabalhando',
  IMPEDIDA: 'Com impedimento',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

export const RESULTADOS = ['RESOLVIDA', 'IMPROCEDENTE', 'DUPLICADA', 'FORA_DE_COMPETENCIA'] as const;
export type Resultado = (typeof RESULTADOS)[number];
export const RESULTADO_TEXTO: Record<Resultado, string> = {
  RESOLVIDA: 'Resolvida',
  IMPROCEDENTE: 'Não procede',
  DUPLICADA: 'Já registrada em outra solicitação',
  FORA_DE_COMPETENCIA: 'Fora da competência do município',
};

export const PRIORIDADES = ['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export const CANAIS = ['APP', 'PRESENCIAL', 'TELEFONE', 'WHATSAPP', 'OUVIDORIA'] as const;
export type Canal = (typeof CANAIS)[number];
export const CANAL_TEXTO: Record<Canal, string> = {
  APP: 'Aplicativo / site',
  PRESENCIAL: 'Atendimento presencial',
  TELEFONE: 'Telefone',
  WHATSAPP: 'WhatsApp',
  OUVIDORIA: 'Ouvidoria',
};

export const TIPOS_LOCALIDADE = ['SEDE', 'DISTRITO', 'COMUNIDADE_RURAL'] as const;
export type TipoLocalidade = (typeof TIPOS_LOCALIDADE)[number];

export const COMANDOS = [
  'ENCAMINHAR',
  'SOLICITAR_INFO',
  'AGENDAR',
  'INICIAR_EXECUCAO',
  'REGISTRAR_IMPEDIMENTO',
  'CONCLUIR',
  'CANCELAR',
  'REABRIR',
] as const;
export type Comando = (typeof COMANDOS)[number];

export interface RegraComando {
  readonly de: readonly Status[];
  readonly para: Status;
  readonly exigeTexto?: boolean;
  readonly exigeSetor?: boolean;
  readonly exigeResultado?: boolean;
  readonly exigeData?: boolean;
  readonly rotulo: string;
}

export const REGRAS: Record<Comando, RegraComando> = {
  ENCAMINHAR: {
    de: ['RECEBIDA', 'ENCAMINHADA', 'IMPEDIDA', 'AGENDADA', 'EM_EXECUCAO'],
    para: 'ENCAMINHADA',
    exigeSetor: true,
    rotulo: 'Encaminhar ao setor',
  },
  SOLICITAR_INFO: {
    de: ['RECEBIDA', 'ENCAMINHADA', 'AGENDADA', 'EM_EXECUCAO', 'IMPEDIDA'],
    para: 'AGUARDANDO_CIDADAO',
    exigeTexto: true,
    rotulo: 'Pedir informação ao cidadão',
  },
  AGENDAR: {
    de: ['ENCAMINHADA', 'EM_EXECUCAO', 'IMPEDIDA'],
    para: 'AGENDADA',
    exigeData: true,
    rotulo: 'Agendar atendimento',
  },
  INICIAR_EXECUCAO: {
    de: ['ENCAMINHADA', 'AGENDADA', 'IMPEDIDA'],
    para: 'EM_EXECUCAO',
    rotulo: 'Iniciar execução',
  },
  REGISTRAR_IMPEDIMENTO: {
    de: ['ENCAMINHADA', 'AGENDADA', 'EM_EXECUCAO'],
    para: 'IMPEDIDA',
    exigeTexto: true,
    rotulo: 'Registrar impedimento',
  },
  CONCLUIR: {
    de: ['ENCAMINHADA', 'EM_EXECUCAO', 'IMPEDIDA', 'AGENDADA'],
    para: 'CONCLUIDA',
    exigeTexto: true,
    exigeResultado: true,
    rotulo: 'Concluir',
  },
  CANCELAR: {
    de: ['RECEBIDA', 'ENCAMINHADA', 'AGUARDANDO_CIDADAO', 'AGENDADA', 'EM_EXECUCAO', 'IMPEDIDA'],
    para: 'CANCELADA',
    exigeTexto: true,
    rotulo: 'Cancelar',
  },
  REABRIR: {
    de: ['CONCLUIDA', 'CANCELADA'],
    para: 'ENCAMINHADA',
    exigeTexto: true,
    rotulo: 'Reabrir',
  },
};

export function comandosPermitidos(status: Status): Comando[] {
  return COMANDOS.filter((c) => REGRAS[c].de.includes(status));
}

export function podeTransicionar(status: Status, comando: Comando): boolean {
  return REGRAS[comando].de.includes(status);
}

// ---------------------------------------------------------------------------
// Perfis e permissoes
// ---------------------------------------------------------------------------

export const PAPEIS = [
  'CIDADAO',
  'ATENDENTE',
  'CAMPO',
  'GESTOR_SETOR',
  'GESTOR_SECRETARIA',
  'ADMIN_SAD',
  'AUDITOR',
] as const;
export type Papel = (typeof PAPEIS)[number];

export const PAPEL_TEXTO: Record<Papel, string> = {
  CIDADAO: 'Cidadão',
  ATENDENTE: 'Atendimento / triagem',
  CAMPO: 'Equipe operacional / campo',
  GESTOR_SETOR: 'Gestor de setor',
  GESTOR_SECRETARIA: 'Gestor de secretaria',
  ADMIN_SAD: 'Administração (SAD) – visão consolidada',
  AUDITOR: 'Auditoria / controle interno',
};

export type Permissao =
  | 'demanda.ver'
  | 'demanda.registrar_assistido'
  | 'demanda.triagem'
  | 'demanda.executar'
  | 'demanda.atribuir'
  | 'demanda.ver_dados_pessoais'
  | 'painel.ver'
  | 'relatorio.gerar'
  | 'ia.usar'
  | 'ia.decidir'
  | 'alerta.tratar'
  | 'admin.usuarios'
  | 'admin.catalogo'
  | 'admin.diagnostico'
  | 'admin.backup'
  | 'admin.integracao'
  | 'admin.privacidade'
  | 'auditoria.ver';

export const PERMISSOES: Record<Papel, readonly Permissao[]> = {
  CIDADAO: [],
  ATENDENTE: [
    'demanda.ver',
    'demanda.registrar_assistido',
    'demanda.triagem',
    'demanda.ver_dados_pessoais',
    'ia.usar',
    'ia.decidir',
  ],
  CAMPO: ['demanda.ver', 'demanda.executar', 'ia.usar'],
  GESTOR_SETOR: [
    'demanda.ver',
    'demanda.triagem',
    'demanda.executar',
    'demanda.atribuir',
    'demanda.ver_dados_pessoais',
    'painel.ver',
    'relatorio.gerar',
    'ia.usar',
    'ia.decidir',
    'alerta.tratar',
  ],
  GESTOR_SECRETARIA: [
    'demanda.ver',
    'demanda.triagem',
    'demanda.executar',
    'demanda.atribuir',
    'demanda.ver_dados_pessoais',
    'painel.ver',
    'relatorio.gerar',
    'ia.usar',
    'ia.decidir',
    'alerta.tratar',
  ],
  ADMIN_SAD: [
    'demanda.ver',
    'painel.ver',
    'relatorio.gerar',
    'ia.usar',
    'alerta.tratar',
    'admin.usuarios',
    'admin.catalogo',
    'admin.diagnostico',
    'admin.backup',
    'admin.integracao',
    'admin.privacidade',
    'auditoria.ver',
  ],
  AUDITOR: ['demanda.ver', 'painel.ver', 'auditoria.ver'],
};

export function tem(papel: Papel, permissao: Permissao): boolean {
  return PERMISSOES[papel].includes(permissao);
}

/**
 * Escopo de visibilidade das demandas.
 * - SETOR: apenas o setor do usuario (campo, gestor de setor)
 * - SECRETARIA: a secretaria do usuario
 * - MUNICIPIO: todas (atendimento/triagem, SAD e auditoria). A SAD e a auditoria
 *   enxergam o municipio inteiro SEM dados pessoais: a SAD e articuladora, nao
 *   substitui a autonomia das secretarias.
 */
export type Escopo = 'PROPRIO' | 'SETOR' | 'SECRETARIA' | 'MUNICIPIO';
export const ESCOPO_PAPEL: Record<Papel, Escopo> = {
  CIDADAO: 'PROPRIO',
  ATENDENTE: 'MUNICIPIO',
  CAMPO: 'SETOR',
  GESTOR_SETOR: 'SETOR',
  GESTOR_SECRETARIA: 'SECRETARIA',
  ADMIN_SAD: 'MUNICIPIO',
  AUDITOR: 'MUNICIPIO',
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface Secretaria { id: number; nome: string; sigla: string }
export interface Setor { id: number; secretariaId: number; nome: string }
export interface Servico {
  id: number;
  setorId: number;
  secretariaId: number;
  nome: string;
  descricao: string;
  palavrasChave: string;
  prazoDiasUteis: number;
  prioridadePadrao: Prioridade;
  ativo: boolean;
}
export interface Localidade { id: number; nome: string; tipo: TipoLocalidade; lat: number; lng: number }

export interface Catalogo {
  secretarias: Secretaria[];
  setores: Setor[];
  servicos: Servico[];
  localidades: Localidade[];
}

export interface EventoDto {
  id: number;
  tipo: string;
  deStatus: Status | null;
  paraStatus: Status | null;
  textoPublico: string | null;
  notaInterna?: string | null;
  autor: string;
  criadoEm: string;
  anexos: AnexoDto[];
}

export interface AnexoDto { id: number; nome: string; mime: string; tamanho: number; origem: string }

export interface SlaDto {
  prazoEm: string | null;
  vencida: boolean;
  pausada: boolean;
  percentual: number; // 0..100+ do prazo consumido
}

export interface DemandaResumo {
  id: number;
  protocolo: string;
  status: Status;
  statusTexto: string;
  prioridade: Prioridade;
  servico: string;
  servicoId: number;
  setor: string;
  setorId: number;
  secretaria: string;
  secretariaId: number;
  localidade: string | null;
  localidadeId: number | null;
  descricao: string;
  canal: Canal;
  criadaEm: string;
  responsavel: string | null;
  responsavelId: number | null;
  sla: SlaDto;
  recorrente: boolean;
  lat: number | null;
  lng: number | null;
}

export interface DemandaDetalhe extends DemandaResumo {
  endereco: string | null;
  referencia: string | null;
  solicitante: { nome: string | null; telefone: string | null; email: string | null; anonima: boolean } | null;
  resultado: Resultado | null;
  agendadaPara: string | null;
  ciclo: number;
  versao: number;
  avaliacao: { nota: number; comentario: string | null } | null;
  eventos: EventoDto[];
  anexos: AnexoDto[];
  comandos: Comando[];
  dadosPessoaisOcultos: boolean;
}

export interface UsuarioSessao {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  secretariaId: number | null;
  setorId: number | null;
  permissoes: Permissao[];
  /** Senha provisoria: precisa ser trocada antes de qualquer outra acao. */
  deveTrocarSenha: boolean;
}

export interface SugestaoClassificacao {
  servicoId: number;
  servico: string;
  secretaria: string;
  confianca: number;
}

export interface AnaliseIa {
  classificacao: SugestaoClassificacao[];
  prioridade: Prioridade;
  motivoPrioridade: string;
  resumo: string;
  provedor: string;
}

/** Normaliza texto para comparacoes: minusculas, sem acento, sem pontuacao. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
