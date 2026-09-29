import { describe, expect, it, jest } from '@jest/globals';
import {
  CsrfService,
  SessionService,
  isOriginAllowed,
  type SessionClaims,
  type SessionStore,
} from '../src/auth/session.service';

const SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres-ok';
const IDLE_TTL = 1200;
const ABSOLUTE_TTL = 28800;
const T0 = 1_760_000_000_000;

/**
 * Store em memoria, com semantica de TTL.
 *
 * O relogio e explicito: `now` avanca por chamada a `resolve`, em vez de
 * usar `Date.now()`. Sem isso, o teste nao consegue simular a passagem do
 * tempo, que e exatamente o que a expiracao precisa verificar.
 */
class MemoryStore implements SessionStore {
  readonly map = new Map<string, { value: string; expiresAt: number }>();
  now = T0;

  private expired(entry: { expiresAt: number }): boolean {
    return entry.expiresAt <= this.now;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (this.expired(entry)) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.map.set(key, { value, expiresAt: this.now + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async touch(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.map.get(key);
    if (entry) entry.expiresAt = this.now + ttlSeconds * 1000;
  }

  async deleteByUser(userId: string): Promise<number> {
    return (await this.keysByUser(userId)).length;
  }

  async keysByUser(userId: string): Promise<string[]> {
    const raw = await this.get(`sess-user:${userId}`);
    return raw ? raw.split(',').filter((id) => id.length > 0) : [];
  }
}

function claims(overrides: Partial<SessionClaims> = {}): Omit<SessionClaims, 'createdAt' | 'absoluteExpiresAt'> {
  return {
    userId: 'u-1',
    realm: 'sertania-ciudadanos',
    isCitizen: true,
    isServer: false,
    membershipId: null,
    secretariatId: null,
    generation: 1,
    ...overrides,
  };
}

function makeService(store = new MemoryStore()) {
  return { service: new SessionService(store, SECRET, IDLE_TTL, ABSOLUTE_TTL), store };
}

describe('ciclo de vida da sessao (secao 12)', () => {
  it('cria sessao e devolve cookie opaco assinado', async () => {
    const { service } = makeService();
    const cookie = await service.create(claims(), T0);
    // O cookie traz id e assinatura; nao traz token do Keycloak nem dado do
    // cidadao.
    expect(cookie).toContain('.');
    expect(cookie).not.toContain('u-1');
    expect(cookie).not.toContain('sertania-ciudadanos');
  });

  it('resolve a sessao criada', async () => {
    const { service } = makeService();
    const cookie = await service.create(claims(), T0);
    const resolved = await service.resolve(cookie, T0 + 1000);
    expect(resolved?.userId).toBe('u-1');
    expect(resolved?.isCitizen).toBe(true);
  });

  it('recusa cookie ausente', async () => {
    const { service } = makeService();
    expect(await service.resolve(undefined, T0)).toBeNull();
  });

  it('recusa cookie com assinatura invalida', async () => {
    const { service } = makeService();
    const cookie = await service.create(claims(), T0);
    // Adulterar a assinatura e o ataque de fixacao de sessao mais direto.
    const forjado = `${cookie.slice(0, cookie.lastIndexOf('.'))}.assinaturaFalsa`;
    expect(await service.resolve(forjado, T0)).toBeNull();
  });

  it('recusa id de sessao inventado pelo cliente', async () => {
    const { service } = makeService();
    // O cliente nao consegue assinar um id, porque nao tem o segredo.
    expect(await service.resolve('id-inventado-nao-assinado', T0)).toBeNull();
  });

  it('recusa sessao de outro segredo', async () => {
    const outro = new SessionService(new MemoryStore(), 'outro-segredo-com-32-caracteres-minimo', IDLE_TTL, ABSOLUTE_TTL);
    const cookie = await outro.create(claims(), T0);
    const { service } = makeService();
    expect(await service.resolve(cookie, T0)).toBeNull();
  });

  it('gera identificadores diferentes a cada login', async () => {
    const { service } = makeService();
    const a = await service.create(claims(), T0);
    const b = await service.create(claims(), T0);
    // Rotacionar no login evita que um id fixado antes do login continue
    // valido depois dele.
    expect(a).not.toBe(b);
  });
});

describe('expiracao', () => {
  it('expira quando a duracao absoluta e ultrapassada', async () => {
    const { service } = makeService();
    const cookie = await service.create(claims(), T0);
    // Acima de 8 horas de duracao absoluta.
    expect(await service.resolve(cookie, T0 + ABSOLUTE_TTL * 1000 + 1000)).toBeNull();
  });

  it('atividade nao renova a expiracao absoluta', async () => {
    const { service, store } = makeService();
    const cookie = await service.create(claims(), T0);
    // Acessos repetidos durante a janela de ociosidade.
    for (let i = 1; i <= 40; i += 1) {
      const resolved = await service.resolve(cookie, T0 + i * 60 * 1000);
      expect(resolved).not.toBeNull();
    }
    // Ainda assim, a expiracao absoluta nao se estende.
    expect(await service.resolve(cookie, T0 + ABSOLUTE_TTL * 1000 + 1000)).toBeNull();
    void store;
  });

  it('expira por ociosidade quando o TTL nao e renovado', async () => {
    const { service, store } = makeService();
    const cookie = await service.create(claims(), T0);
    // Primeiro acesso, que renova o TTL de ociosidade.
    store.now = T0 + 1000;
    expect(await service.resolve(cookie, store.now)).not.toBeNull();

    // Agora o tempo passa alem do TTL de ociosidade, sem nenhum acesso.
    store.now = T0 + 1000 + IDLE_TTL * 1000 + 1000;
    expect(await service.resolve(cookie, store.now)).toBeNull();
  });
});

describe('revogacao (criterio 7)', () => {
  it('logout invalida a sessao', async () => {
    const { service } = makeService();
    const cookie = await service.create(claims(), T0);
    expect(await service.resolve(cookie, T0 + 1000)).not.toBeNull();
    await service.revoke(cookie, 'u-1');
    expect(await service.resolve(cookie, T0 + 2000)).toBeNull();
  });

  it('revogacao de vinculo invalida todas as sessoes do usuario', async () => {
    const { service } = makeService();
    const primeira = await service.create(claims(), T0);
    const segunda = await service.create(claims({ realm: 'sertania-servidores', isCitizen: false, isServer: true }), T0);

    expect(await service.resolve(primeira, T0 + 1000)).not.toBeNull();
    expect(await service.resolve(segunda, T0 + 1000)).not.toBeNull();

    const removidas = await service.revokeAllForUser('u-1');
    expect(removidas).toBe(2);
    // A especificacao exige que o vinculo mudando invalide o acesso, e nao
    // apenas negar a proxima operacao.
    expect(await service.resolve(primeira, T0 + 2000)).toBeNull();
    expect(await service.resolve(segunda, T0 + 2000)).toBeNull();
  });

  it('revogacao de um usuario nao afeta o outro', async () => {
    const { service } = makeService();
    const a = await service.create(claims({ userId: 'u-a' }), T0);
    const b = await service.create(claims({ userId: 'u-b' }), T0);
    await service.revokeAllForUser('u-a');
    expect(await service.resolve(a, T0 + 2000)).toBeNull();
    expect(await service.resolve(b, T0 + 2000)).not.toBeNull();
  });
});

describe('conteudo da sessao', () => {
  it('preserva o contexto de trabalho de servidor', async () => {
    const { service } = makeService();
    const cookie = await service.create(
      claims({
        realm: 'sertania-servidores',
        isCitizen: false,
        isServer: true,
        membershipId: 'm-1',
        secretariatId: 'sec-saude',
      }),
      T0,
    );
    const resolved = await service.resolve(cookie, T0 + 1000);
    expect(resolved?.membershipId).toBe('m-1');
    expect(resolved?.secretariatId).toBe('sec-saude');
  });

  it('nao usa CPF, data de nascimento ou protocolo como segredo', async () => {
    const { service } = makeService();
    const cookie = await service.create(claims(), T0);
    // Nada disso aparece no cookie: o cookie e opaco e assinado.
    expect(cookie).not.toMatch(/\d{11}/);
    expect(cookie).not.toContain('SER-');
  });
});

describe('token CSRF (secao 12)', () => {
  it('gera token deterministico por sessao', () => {
    const csrf = new CsrfService(SECRET);
    expect(csrf.tokenFor('sess-1')).toBe(csrf.tokenFor('sess-1'));
  });

  it('gera tokens diferentes para sessoes diferentes', () => {
    const csrf = new CsrfService(SECRET);
    expect(csrf.tokenFor('sess-1')).not.toBe(csrf.tokenFor('sess-2'));
  });

  it('aceita o token correto e recusa o errado', () => {
    const csrf = new CsrfService(SECRET);
    const token = csrf.tokenFor('sess-1');
    expect(csrf.verify('sess-1', token)).toBe(true);
    expect(csrf.verify('sess-1', 'token-falso')).toBe(false);
    expect(csrf.verify('sess-1', undefined)).toBe(false);
  });

  it('token de uma sessao nao vale em outra', () => {
    const csrf = new CsrfService(SECRET);
    const token = csrf.tokenFor('sess-1');
    expect(csrf.verify('sess-2', token)).toBe(false);
  });
});

describe('conferencia de Origin', () => {
  it('aceita origem autorizada', () => {
    expect(isOriginAllowed('https://app.sertania.pe.gov.br', ['https://app.sertania.pe.gov.br'])).toBe(true);
  });

  it('recusa origem nao autorizada', () => {
    expect(isOriginAllowed('https://site-malicioso.example', ['https://app.sertania.pe.gov.br'])).toBe(false);
  });

  it('recusa ausencia de origem em mutacao', () => {
    expect(isOriginAllowed(undefined, ['https://app.sertania.pe.gov.br'])).toBe(false);
  });

  it('recusa origem com prefixo parecido', () => {
    // Comparacao por igualdade, e nao por `startsWith`: senao um dominio
    //Controlled por terceiros passaria.
    expect(isOriginAllowed('https://app.sertania.pe.gov.br.evil.example', ['https://app.sertania.pe.gov.br'])).toBe(false);
  });
});
