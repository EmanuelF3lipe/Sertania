/**
 * Sessao no servidor (especificacao secao 12).
 *
 * O NestJS atua como BFF: o codigo de autorizacao e trocado no servidor e os
 * tokens ficam FORA do JavaScript do navegador. O navegador recebe somente um
 * identificador opaco de sessao, em cookie `__Host-session`, com HttpOnly,
 * Secure, SameSite=Lax, caminho `/` e sem Domain.
 *
 * Nao ha token em localStorage, em URL, nem CPF, data de nascimento ou numero
 * de protocolo como segredo.
 */
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

export interface SessionClaims {
  /** Usuario interno resolvido na autenticacao. */
  readonly userId: string;
  /** Realm que autenticou: distingue cidadao de servidor. */
  readonly realm: string;
  readonly isCitizen: boolean;
  readonly isServer: boolean;
  /** Contexto de trabalho selecionado, quando houver. */
  readonly membershipId: string | null;
  readonly secretariatId: string | null;
  /** Expiracao absoluta, que nao se renova com atividade. */
  readonly absoluteExpiresAt: number;
  readonly createdAt: number;
  /** Funcao a reexecutar no login e em mudanca de privilegio. */
  readonly generation: number;
}

export interface StoredSession {
  readonly claims: SessionClaims;
  /** Ultimo instante de atividade, para o TTL de ociosidade. */
  readonly lastSeenAt: number;
}

/** Redis privado, chaves com prefixo e TTL. */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
  /** Renova o TTL sem apagar o valor. */
  touch(key: string, ttlSeconds: number): Promise<void>;
  /** Remove todas as sessoes de um usuario, para revogacao em lote. */
  deleteByUser(userId: string): Promise<number>;
  keysByUser(userId: string): Promise<string[]>;
}

const KEY_PREFIX = 'sess:';
const USER_INDEX_PREFIX = 'sess-user:';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly store: SessionStore,
    private readonly secret: string,
    private readonly idleTtlSeconds: number,
    private readonly absoluteTtlSeconds: number,
  ) {}

  /**
   * Identificador opaco do cookie.
   *
   * Composto de um id de sessao e de uma assinatura. A assinatura impede que
   * o cliente fabrique um id valido por adivinhacao; o id sozinho seria
   * adivinhavel porque a sequencia de Protocolo e previsivel.
   */
  private sign(sessionId: string): string {
    return createHmac('sha256', this.secret).update(sessionId).digest('base64url');
  }

  private cookieValue(sessionId: string): string {
    return `${sessionId}.${this.sign(sessionId)}`;
  }

  /**
   * Valida a assinatura em tempo constante.
   *
   * `timingSafeEqual` evita que o tempo de resposta revele quantos bytes
   * corretos a assinatura tem.
   */
  private verifySignature(cookie: string): string | null {
    const separator = cookie.lastIndexOf('.');
    if (separator <= 0) return null;
    const sessionId = cookie.slice(0, separator);
    const provided = Buffer.from(cookie.slice(separator + 1), 'base64url');
    const expected = Buffer.from(this.sign(sessionId), 'base64url');
    if (provided.length !== expected.length) return null;
    return timingSafeEqual(provided, expected) ? sessionId : null;
  }

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  private userIndexKey(userId: string): string {
    return `${USER_INDEX_PREFIX}${userId}`;
  }

  /**
   * Cria uma sessao. Rotaciona o identificador no login e em mudanca de
   * privilegio, conforme a secao 12:_fixacao de sessao exige que o id mude
   * quando o nivel de acesso muda.
   */
  async create(claims: Omit<SessionClaims, 'createdAt' | 'absoluteExpiresAt'>, now: number): Promise<string> {
    const sessionId = randomBytes(32).toString('base64url');
    const stored: StoredSession = {
      claims: {
        ...claims,
        createdAt: now,
        absoluteExpiresAt: now + this.absoluteTtlSeconds * 1000,
      },
      lastSeenAt: now,
    };
    await this.store.setEx(this.key(sessionId), this.absoluteTtlSeconds, JSON.stringify(stored));
    await this.store.setEx(this.userIndexKey(claims.userId), this.absoluteTtlSeconds, '');
    await this.trackUserSession(claims.userId, sessionId, this.absoluteTtlSeconds);
    return this.cookieValue(sessionId);
  }

  private async trackUserSession(userId: string, sessionId: string, ttl: number): Promise<void> {
    const indexKey = this.userIndexKey(userId);
    const existing = await this.store.get(indexKey);
    if (existing === null) {
      await this.store.setEx(indexKey, ttl, sessionId);
      return;
    }
    // Guarda a lista de sessoes do usuario, para revogacao em lote quando o
    // vinculo mudar (secao 12).
    const ids = existing.split(',').filter((id) => id.length > 0 && id !== sessionId);
    ids.push(sessionId);
    await this.store.setEx(indexKey, ttl, ids.join(','));
  }

  /**
   * Le a sessao e renova o TTL de ociosidade.
   *
   * Devolve `null` quando a assinatura nao confere, quando a sessao expirou ou
   * quando a duracao absoluta foi ultrapassada. A expiracao absoluta nao se
   * renova com atividade, o que limita o tempo de vida de um session fixation.
   */
  async resolve(cookie: string | undefined, now: number): Promise<SessionClaims | null> {
    if (!cookie) return null;
    const sessionId = this.verifySignature(cookie);
    if (sessionId === null) return null;

    const raw = await this.store.get(this.key(sessionId));
    if (raw === null) return null;

    let stored: StoredSession;
    try {
      stored = JSON.parse(raw) as StoredSession;
    } catch {
      this.logger.warn('Sessao corrompida removida do armazenamento');
      await this.store.del(this.key(sessionId));
      return null;
    }

    if (stored.claims.absoluteExpiresAt <= now) {
      await this.revoke(sessionId, stored.claims.userId);
      return null;
    }

    // Ociosidade: renovamos o TTL, mas nao a expiracao absoluta.
    await this.store.touch(this.key(sessionId), this.idleTtlSeconds);
    await this.trackUserSession(
      stored.claims.userId,
      sessionId,
      Math.max(1, Math.floor((stored.claims.absoluteExpiresAt - now) / 1000)),
    );

    return { ...stored.claims, lastSeenAt: now } as SessionClaims;
  }

  /** Encerra a sessao. */
  async revoke(sessionIdOrCookie: string, userId?: string): Promise<void> {
    const sessionId = sessionIdOrCookie.includes('.')
      ? this.verifySignature(sessionIdOrCookie)
      : sessionIdOrCookie;
    if (sessionId === null) return;
    await this.store.del(this.key(sessionId));
    if (userId !== undefined) {
      await this.removeFromUserIndex(userId, sessionId);
    }
  }

  private async removeFromUserIndex(userId: string, sessionId: string): Promise<void> {
    const indexKey = this.userIndexKey(userId);
    const existing = await this.store.get(indexKey);
    if (existing === null) return;
    const ids = existing.split(',').filter((id) => id.length > 0 && id !== sessionId);
    if (ids.length === 0) {
      await this.store.del(indexKey);
      return;
    }
    await this.store.touch(indexKey, this.idleTtlSeconds);
    const remaining = ids.join(',');
    const writer = this.store as SessionStore & {
      touch?(key: string, ttl: number): Promise<void>;
    };
    if (typeof writer.touch === 'function') {
      // `touch` nao altera o valor; precisamos reescrever a lista. Usamos o
      // caminho de setEx para garantir o valor atualizado.
      await this.store.setEx(indexKey, this.idleTtlSeconds, remaining);
    }
  }

  /**
   * Revoga todas as sessoes de um usuario.
   *
   * Usado quando um vinculo e revogado, quando a conta e bloqueada e no logout
   * com revogacao central. A especificacao exige invalidar acesso nesses
   * casos, e nao apenas negar a proxima operacao.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const ids = await this.store.keysByUser(userId);
    for (const id of ids) {
      await this.store.del(this.key(id));
    }
    await this.store.del(this.userIndexKey(userId));
    return ids.length;
  }
}

/**
 * Token CSRF vinculado a sessao (especificacao secao 12).
 *
 * Exigido em mutacoes autenticadas por cookie, junto da conferencia de
 * Origin. Sem os dois, um site externo poderia acionar uma acao com a sessao
 * da vítima.
 */
@Injectable()
export class CsrfService {
  constructor(private readonly secret: string) {}

  /** Gera o token de uma sessao. Deterministico, para nao exigir round-trip. */
  tokenFor(sessionId: string): string {
    return createHmac('sha256', this.secret)
      .update(`csrf:${sessionId}`)
      .digest('base64url');
  }

  /** Confere em tempo constante. */
  verify(sessionId: string, provided: string | undefined): boolean {
    if (!provided) return false;
    const expected = Buffer.from(this.tokenFor(sessionId), 'base64url');
    const given = Buffer.from(provided, 'base64url');
    if (expected.length !== given.length) return false;
    return timingSafeEqual(expected, given);
  }
}

/**
 * Verifica a origem de uma mutacao.
 *
 * Exige que a origem pertence a lista de origens autorizadas. A verificacao de
 * Origin complementa o token CSRF: mesmo com o token vazado, um pedido de
 * origem nao autorizada e recusado.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin === undefined) {
    // Ausencia de Origin em navegador costuma significar navegacao. Em
    // mutacao, tratamos como nao autorizado: o fluxo legitimo sempre envia.
    return false;
  }
  return allowedOrigins.includes(origin);
}
