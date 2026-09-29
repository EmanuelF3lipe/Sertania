/**
 * Guarda de `state` do fluxo de autorizacao (marco B, secao 12).
 *
 * Por que este arquivo existe separado de `oidc.service.ts`: `state` e a
 * propriedade de seguranca mais importante do login, e ela precisa de teste.
 * `oidc.service.ts` importa `openid-client`, que e distribuido apenas como ESM,
 * e a suite unitaria roda em CommonJS. Um arquivo so com a guarda e testavel de
 * verdade, sem simular o provedor de identidade.
 *
 * O que a guarda garante, em tres regras:
 *
 * 1. O `state` fica no SERVIDOR. Guardado no navegador, um atacante com acesso
 *    ao storage fabricaria o par e forjaria o login.
 *
 * 2. O `state` e de uso unico. Consumir remove a entrada, o que impede
 *    reaproveitar um codigo de autorizacao interceptado.
 *
 * 3. O `state` expira. Cinco minutos cobrem o login e nao acumulam estado.
 */
import { Injectable } from '@nestjs/common';

/** Realm de destino do login. */
export type LoginRealm = 'citizens' | 'servers';

export interface PendingAuthorization {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly createdAt: number;
  readonly realm: LoginRealm;
}

@Injectable()
export class AuthorizationStateStore {
  /** Cinco minutos cobrem o login e nao acumulam estado sem uso. */
  private readonly ttlMs = 5 * 60 * 1000;
  private readonly pending = new Map<string, PendingAuthorization>();

  remember(pending: PendingAuthorization): void {
    this.prune();
    this.pending.set(pending.state, pending);
  }

  /**
   * Consome o estado.
   *
   * Remove antes de devolver: um `state` valido so pode ser usado uma vez.
   */
  consume(state: string): PendingAuthorization | null {
    this.prune();
    const found = this.pending.get(state);
    this.pending.delete(state);
    // `Map.get` devolve `undefined` para chave ausente; a interface promete
    // `null`, que distingue "nao havia" de "havia e foi consumido".
    return found ?? null;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, value] of this.pending.entries()) {
      if (now - value.createdAt > this.ttlMs) {
        this.pending.delete(key);
      }
    }
  }

  get size(): number {
    return this.pending.size;
  }
}
