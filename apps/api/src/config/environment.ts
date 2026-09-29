/**
 * Validacao do ambiente (especificacao secao 13).
 *
 * Falhar na inicializacao e melhor do que falhar em producao com um segredo
 * ausente. Este modulo exige as variaveis que a aplicacao realmente usa e
 * recusa valores de demonstracao fora do ambiente local.
 */
import { SESSION_COOKIE_NAME } from '../auth/session.service';

/** Forma do objeto que o ConfigModule entrega apos a validacao. */
type ValidatedEnvironment = Record<string, string | undefined>;

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly isProduction: boolean;
  readonly isLocal: boolean;
  readonly publicOrigin: string;
  readonly sessionSecret: string;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly sessionCookieName: string;
  readonly sessionCookieSecure: boolean;
  readonly keycloakUrl: string;
  readonly keycloakRealmCitizens: string;
  readonly keycloakRealmServers: string;
  readonly keycloakClientId: string;
  readonly keycloakClientSecret: string;
  readonly keycloakRedirectUri: string;
  readonly turnstileSiteKey: string;
  readonly turnstileSecretKey: string;
  readonly redisSessionUrl: string;
  readonly redisQueueUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly forcePathStyle: boolean;
    readonly quarantineBucket: string;
    readonly documentsBucket: string;
  };
  readonly clamav: { readonly host: string; readonly port: number; readonly timeoutMs: number };
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly fromName: string;
    readonly fromAddress: string;
  };
  readonly demoSlaSimulated: boolean;
  readonly dataEncryptionKeyVersion: number;
}

/** Valores de demonstracao que nunca podem chegar a um ambiente real. */
const PLACEHOLDER_SECRETS = [
  'troque-este-valor-em-qualquer-ambiente-nao-local',
  'troque-este-client-secret',
];

function required(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
  }
  return value;
}

/**
 * Le um valor de ambiente como texto.
 *
 * O ConfigModule entrega `string`, mas o tipo declarado e `unknown` porque a
 * funcao tambem e chamada em teste com objeto montado a mao. Converter com
 * `String()` um valor que ja e objeto produziria `[object Object]` e a
 * validacao passaria por um valor invalido.
 */
function text(env: Record<string, unknown>, key: string, fallback?: string): string {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
  }
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
    throw new Error(`Variavel ${key} deve ser texto, recebido ${typeof raw}`);
  }
  return String(raw);
}

function optionalInt(env: Record<string, unknown>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new Error(`Variavel ${key} deve ser numerica, recebido ${typeof raw}`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Variavel ${key} deve ser um inteiro positivo, recebido: ${String(raw)}`);
  }
  return parsed;
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') {
    throw new Error(`Valor booleano invalido: ${typeof value}`);
  }
  return value.toLowerCase() === 'true';
}

/**
 * Validador executado pelo ConfigModule antes de a aplicacao subir.
 */
export function validateEnvironment(input: Record<string, unknown>): ValidatedEnvironment {
  const nodeEnvRaw = text(input, 'NODE_ENV', 'development');
  if (!['development', 'test', 'production'].includes(nodeEnvRaw)) {
    throw new Error(`NODE_ENV invalido: ${nodeEnvRaw}`);
  }
  const isLocal = nodeEnvRaw === 'development' || nodeEnvRaw === 'test';

  const sessionSecret = required(input, 'SESSION_SECRET');
  const keycloakClientSecret = required(input, 'KEYCLOAK_CLIENT_SECRET');

  // Segredo de demonstracao em ambiente nao local e falha na inicializacao.
  // Preferimos parar cedo a descobrir a falha em um incidente.
  if (!isLocal) {
    for (const placeholder of PLACEHOLDER_SECRETS) {
      if (sessionSecret === placeholder) {
        throw new Error(
          'SESSION_SECRET ainda esta com valor de demonstracao. Gere um segredo proprio deste ambiente.',
        );
      }
      if (keycloakClientSecret === placeholder) {
        throw new Error(
          'KEYCLOAK_CLIENT_SECRET ainda esta com valor de demonstracao. Gere um segredo proprio deste ambiente.',
        );
      }
    }
    if (input['KEYCLOAK_ADMIN_USERNAME'] === undefined || input['KEYCLOAK_ADMIN_PASSWORD'] === undefined) {
      throw new Error('KEYCLOAK_ADMIN_USERNAME e KEYCLOAK_ADMIN_PASSWORD sao obrigatorias fora do ambiente local.');
    }
    if (input['KEYCLOAK_ADMIN_PASSWORD'] === 'admin-local-apenas') {
      throw new Error('KEYCLOAK_ADMIN_PASSWORD ainda esta com valor de demonstracao.');
    }
    if (input['SESSION_COOKIE_SECURE'] === undefined || input['SESSION_COOKIE_SECURE'] === 'false') {
      throw new Error(
        'SESSION_COOKIE_SECURE precisa ser true fora do ambiente local: o cookie __Host- exige HTTPS.',
      );
    }
  }

  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET deve ter ao menos 32 caracteres.');
  }

  const idleTtl = optionalInt(input, 'SESSION_IDLE_TTL_SECONDS', 1200);
  const absoluteTtl = optionalInt(input, 'SESSION_ABSOLUTE_TTL_SECONDS', 28800);
  if (idleTtl > absoluteTtl) {
    throw new Error(
      'SESSION_IDLE_TTL_SECONDS nao pode ser maior que SESSION_ABSOLUTE_TTL_SECONDS.',
    );
  }

  return {
    ...(input as ValidatedEnvironment),
    NODE_ENV: nodeEnvRaw,
    SESSION_IDLE_TTL_SECONDS: String(idleTtl),
    SESSION_ABSOLUTE_TTL_SECONDS: String(absoluteTtl),
    POSTGRES_PORT: text(input, 'POSTGRES_PORT', '5432'),
    CLAMAV_PORT: text(input, 'CLAMAV_PORT', '3310'),
    SMTP_PORT: text(input, 'SMTP_PORT', '1025'),
    DATA_ENCRYPTION_KEY_VERSION: text(input, 'DATA_ENCRYPTION_KEY_VERSION', '1'),
    DEMO_SLA_SIMULATED: boolean(input['DEMO_SLA_SIMULATED'], true) ? 'true' : 'false',
    SESSION_COOKIE_SECURE: boolean(input['SESSION_COOKIE_SECURE'], !isLocal) ? 'true' : 'false',
  };
}

/** Fabrica de configuracao tipada, injetada via ConfigService. */
export function configuration(): Record<string, unknown> {
  return {
    publicOrigin: process.env['PUBLIC_ORIGIN'],
    sessionSecret: process.env['SESSION_SECRET'],
    sessionIdleTtlSeconds: Number(process.env['SESSION_IDLE_TTL_SECONDS'] ?? '1200'),
    sessionAbsoluteTtlSeconds: Number(process.env['SESSION_ABSOLUTE_TTL_SECONDS'] ?? '28800'),
    // O nome do cookie vem do codigo, nao do ambiente: o prefixo `__Host-` e
    // uma regra do navegador, e o mesmo nome precisa ser usado pelo guard (que
    // le) e pelo controller (que escreve). Ver `SESSION_COOKIE_NAME`.
    sessionCookieName: SESSION_COOKIE_NAME,
    sessionCookieSecure: process.env['SESSION_COOKIE_SECURE'] === 'true',
    keycloakUrl: process.env['KEYCLOAK_URL'],
    keycloakRealmCitizens: process.env['KEYCLOAK_REALM_CITIZENS'],
    keycloakRealmServers: process.env['KEYCLOAK_REALM_SERVERS'],
    keycloakClientId: process.env['KEYCLOAK_CLIENT_ID'],
    keycloakClientSecret: process.env['KEYCLOAK_CLIENT_SECRET'],
    keycloakRedirectUri: process.env['KEYCLOAK_REDIRECT_URI'],
    turnstileSiteKey: process.env['TURNSTILE_SITE_KEY'] ?? '',
    turnstileSecretKey: process.env['TURNSTILE_SECRET_KEY'] ?? '',
    redisSessionUrl: process.env['REDIS_SESSION_URL'],
    redisQueueUrl: process.env['REDIS_QUEUE_URL'],
    s3: {
      endpoint: process.env['S3_ENDPOINT'],
      region: process.env['S3_REGION'] ?? 'us-east-1',
      accessKey: process.env['S3_ACCESS_KEY'],
      secretKey: process.env['S3_SECRET_KEY'],
      forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
      quarantineBucket: process.env['S3_BUCKET_QUARANTINE'] ?? 'sertania-quarantine',
      documentsBucket: process.env['S3_BUCKET_DOCUMENTS'] ?? 'sertania-documents',
    },
    clamav: {
      host: process.env['CLAMAV_HOST'] ?? 'localhost',
      port: Number(process.env['CLAMAV_PORT'] ?? '3310'),
      timeoutMs: Number(process.env['CLAMAV_TIMEOUT_MS'] ?? '30000'),
    },
    smtp: {
      host: process.env['SMTP_HOST'] ?? 'localhost',
      port: Number(process.env['SMTP_PORT'] ?? '1025'),
      fromName: process.env['SMTP_FROM_NAME'] ?? 'Prefeitura de Sertania',
      fromAddress: process.env['SMTP_FROM_ADDRESS'] ?? 'nao-responda@sertania.local',
    },
    demoSlaSimulated: process.env['DEMO_SLA_SIMULATED'] === 'true',
    dataEncryptionKeyVersion: Number(process.env['DATA_ENCRYPTION_KEY_VERSION'] ?? '1'),
  };
}
