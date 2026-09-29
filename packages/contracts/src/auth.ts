/**
 * Perfis e capacidades (especificacao secao 4).
 *
 * Um perfil define o TIPO de acesso. OALCANCE desse acesso vem dos vinculos
 * (secretaria/unidade) e das concessoes, nunca do perfil isolado nem do
 * dispositivo usado.
 */
export const ROLES = [
  'CITIZEN',
  'ATTENDANT',
  'OPERATIONAL_TEAM',
  'SECRETARY_MANAGER',
  'CENTRAL_MANAGEMENT',
  'TECH_ADMIN',
  'AUDITOR',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Acoes verificadas pela camada de autorizacao.
 *
 * Lista fechada e explicita. Nenhuma acao e permitida por padrao: a politica
 * nega e so libera quando todos os criteria sao satisfeitos.
 */
export const ACTIONS = [
  // Cidadao
  'REQUEST_CREATE',
  'REQUEST_READ_OWN',
  'REQUEST_CANCEL_OWN',
  'REQUEST_REOPEN_REQUEST_OWN',
  'REQUEST_EVALUATE_OWN',
  'MESSAGE_SEND_OWN',
  'ATTACHMENT_UPLOAD_OWN',
  'PROFILE_READ_OWN',
  'PROFILE_UPDATE_OWN',

  // Operacao
  'REQUEST_READ_QUEUE',
  'REQUEST_READ_RESTRICTED',
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

  // Gestao
  'CATALOG_READ_DRAFT',
  'CATALOG_MANAGE',
  'UNIT_MANAGE',
  'SLA_MANAGE',
  'ANALYTICS_READ_SCOPE',
  'ANALYTICS_READ_CENTRAL',
  'EXPORT_REQUEST',

  // Administracao tecnica
  'ADMIN_CONFIGURE',
  'ADMIN_PROVISION',
  'ADMIN_GRANT_ACCESS',

  // Auditoria
  'AUDIT_READ_EVENTS',
  'AUDIT_READ_CONTENT',
  'EXPORT_READ_METADATA',
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * Leitura de conteudo restrito e uma permissao DISTINTA da leitura de eventos
 * de auditoria (secao 4). Um auditor que le eventos nao le conteudo.
 */
export const CONTENT_READ_ACTIONS: readonly Action[] = [
  'REQUEST_READ_RESTRICTED',
  'AUDIT_READ_CONTENT',
];

/**
 * Administrador tecnico nao tem permissao de atendimento nem de leitura de
 * anexos por padrao (secao 4). Este conjunto existe para tornar essa separacao
 * legivel no codigo e nos testes.
 */
export const TECH_ADMIN_FORBIDDEN_BY_DEFAULT: readonly Action[] = [
  'REQUEST_READ_QUEUE',
  'REQUEST_READ_RESTRICTED',
  'REQUEST_ASSIGN',
  'REQUEST_COMPLETE',
  'AUDIT_READ_CONTENT',
];

/**
 * Gestao central ve indicadores consolidados, mas nao obtem documentos
 * individuais nem casos por atribuicao implicita (secao 4, criterio 5).
 */
export const CENTRAL_MANAGEMENT_FORBIDDEN: readonly Action[] = [
  'REQUEST_READ_QUEUE',
  'REQUEST_READ_RESTRICTED',
  'AUDIT_READ_CONTENT',
];

/**
 * Canais de atendimento assistido (secao 5). O atendente nao acessa a conta do
 * cidadao nem define senha para ele.
 */
export const ASSISTED_CHANNELS = [
  'ASSISTED_DESK',
  'ASSISTED_PHONE',
] as const;

export type AssistedChannel = (typeof ASSISTED_CHANNELS)[number];

/** Tipos de material anexavel permitidos no MVP (secao 13, passo 3 e 5). */
export const ALLOWED_ATTACHMENT_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export type AllowedAttachmentMediaType =
  (typeof ALLOWED_ATTACHMENT_MEDIA_TYPES)[number];

/**
 * Executaveis, HTML, SVG e arquivos compactados sao recusados no MVP.
 * A lista e negativa por design: adicionar formato exige decisao documentada.
 */
export const DENIED_ATTACHMENT_EXTENSIONS = [
  'exe', 'dll', 'com', 'bat', 'cmd', 'msi', 'scr', 'ps1', 'vbs', 'js', 'jse',
  'hta', 'jar', 'sh',
  'html', 'htm', 'xhtml', 'svg', 'svgz', 'xml', 'swf',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
] as const;

/** Limites iniciais propostos na secao 13. Sao propostas, nao regra municipal. */
export const ATTACHMENT_LIMITS = {
  maxFilesPerRequest: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
} as const;

/**
 * Zona horaria do calculo de prazo (secao 8). Horarios sao armazenados em UTC e
 * o calendario local e calculado com America/Recife.
 */
export const MUNICIPAL_TIMEZONE = 'America/Recife';

/** Formato de protocolo sugerido (secao 6). */
export const PROTOCOL_PATTERN = /^SER-\d{4}-\d{6}$/;

/** Janela demonstrativa de pedido de reabertura (secao 6). */
export const REOPEN_REQUEST_WINDOW_DAYS = 7;

/**
 * Limiar inicial de supressao de grupos pequenos em agregados de gestao central
 * (secao 14). Proposto; sujeito a avaliacao de risco.
 */
export const SMALL_GROUP_SUPPRESSION_THRESHOLD = 10;
