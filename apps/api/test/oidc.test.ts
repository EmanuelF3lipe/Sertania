/**
 * Testes da politica de segundo fator que pode ser reativada em producao.
 *
 * O que estes testes NAO provam, e importante saber:
 *
 * Estes testes verificam apenas a REGUA: quais `amr` contam como prova de
 * segundo fator. Um teste que so injete uma sessao no Redis nao prova nada
 * sobre isto, porque nao passa por nenhum provedor de identidade. O fluxo
 * demonstrativo atual usa e-mail + senha e nao exige essa regua.
 *
 * O `openid-client` e distribuido apenas como ESM e a suite unitaria roda em
 * CommonJS, entao o servico OIDC nao pode ser importado aqui. E a razao de a
 * politica morar em `second-factor.ts`, e nao dentro do cliente OIDC.
 */
import { describe, expect, it } from '@jest/globals';
import {
  metodosDeSegundoFatorConhecidos,
  tokenProvaSegundoFator,
} from '../src/auth/second-factor';
import { AuthorizationStateStore } from '../src/auth/authorization-state.store';

describe('tokenProvaSegundoFator', () => {
  it('aceita os metodos de segundo fator reconhecidos', () => {
    for (const metodo of metodosDeSegundoFatorConhecidos()) {
      expect([metodo, tokenProvaSegundoFator([metodo])]).toEqual([metodo, true]);
    }
  });

  it('recusa senha sozinha, porque senha com MFA continua sendo senha', () => {
    expect(tokenProvaSegundoFator(['pwd'])).toBe(false);
  });

  it('recusa lista vazia, ausencia de `amr` e nulo', () => {
    // Ausencia de `amr` e ausencia de prova. Tratar a ausencia como "tem"
    // transformaria uma mudanca do provedor em liberacao silenciosa.
    expect(tokenProvaSegundoFator([])).toBe(false);
    expect(tokenProvaSegundoFator(null)).toBe(false);
    expect(tokenProvaSegundoFator(undefined)).toBe(false);
  });

  it('recusa um metodo desconhecido, em vez de assumir que e segundo fator', () => {
    expect(tokenProvaSegundoFator(['sms', 'pwd'])).toBe(false);
  });

  it('recusa rotulo generico, que nao diz qual fator foi provado', () => {
    // `mfa` e um rotulo, nao uma prova. Aceitar um rotulo generico
    // substituiria a verificacao por uma confianca sem base.
    expect(tokenProvaSegundoFator(['mfa'])).toBe(false);
  });

  it('aceita quando o segundo fator aparece junto com a senha', () => {
    expect(tokenProvaSegundoFator(['pwd', 'totp'])).toBe(true);
  });

  it('nao confunde nome parecido: `totp2` nao e `totp`', () => {
    expect(tokenProvaSegundoFator(['totp2'])).toBe(false);
  });
});
describe('AuthorizationStateStore', () => {
  function pendente(state: string, agora: number) {
    return {
      state,
      nonce: 'nonce-de-teste',
      codeVerifier: 'verificador-de-teste',
      createdAt: agora,
      realm: 'citizens' as const,
    };
  }

  it('devolve o estado e consome: um `state` valido serve uma vez so', () => {
    // Reaproveitar o mesmo `state` com um codigo de autorizacao capturado
    // permitiria trocar a sessao de uma pessoa por outra.
    const store = new AuthorizationStateStore();
    store.remember(pendente('abc', Date.now()));

    expect(store.consume('abc')).not.toBeNull();
    expect(store.consume('abc')).toBeNull();
  });

  it('devolve nulo para estado desconhecido, sem lancar', () => {
    expect(new AuthorizationStateStore().consume('nao-existe')).toBeNull();
  });

  it('guarda estado dentro do prazo de cinco minutos', () => {
    const store = new AuthorizationStateStore();
    store.remember(pendente('novo', Date.now()));
    expect(store.consume('novo')).not.toBeNull();
  });

  it('esquece estado vencido, para nao acumular entradas sem uso', () => {
    // O relogio do store e o do sistema, entao o tempo entra pelo `createdAt`.
    const store = new AuthorizationStateStore();
    store.remember(pendente('velho', Date.now() - 6 * 60 * 1000));
    expect(store.consume('velho')).toBeNull();
  });

  it('nao guarda nada depois do consumo', () => {
    const store = new AuthorizationStateStore();
    store.remember(pendente('abc', Date.now()));
    expect(store.size).toBe(1);
    store.consume('abc');
    expect(store.size).toBe(0);
  });
});
