/**
 * Sessao da interface.
 *
 * O estado da sessao vive em memoria e em nenhum outro lugar. Recarregar a
 * pagina faz a interface perguntar de novo a `/auth/me` e descobrir a verdade
 * pelo servidor, em vez de confiar em algo que o navegador guardou. Isso e o que
 * garante que encerrar a sessao no servidor termine a sessao na tela, e nao na
 * proxima requisicao.
 *
 * Nenhuma linha deste arquivo escreve em `localStorage`, `sessionStorage` ou
 * IndexedDB. Nao e esquecimento: e a razao de o arquivo existir.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet, limparCacheDeSessao } from './cliente';
import type { Sessao as SessaoApi } from './tipos';

export type FaseSessao = 'carregando' | 'anonimo' | 'cidadao' | 'servidor';

export interface ContextoSessao {
  readonly fase: FaseSessao;
  readonly sessao: SessaoApi | null;
  /** Recarrega `/auth/me`. Usado apos login e apos trocar de contexto. */
  readonly recarregar: () => Promise<void>;
  /** Encerra a sessao no servidor e limpa o estado em memoria. */
  readonly sair: () => Promise<void>;
}

const Contexto = createContext<ContextoSessao | null>(null);

function faseDe(sessao: SessaoApi): FaseSessao {
  if (!sessao.authenticated) return 'anonimo';
  return sessao.isServer ? 'servidor' : 'cidadao';
}

export function ProvedorSessao({ children }: { readonly children: ReactNode }) {
  const [fase, definirFase] = useState<FaseSessao>('carregando');
  const [sessao, definirSessao] = useState<SessaoApi | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const resposta = await apiGet<SessaoApi>('/api/v1/auth/me');
      definirSessao(resposta);
      definirFase(faseDe(resposta));
    } catch {
      // 401 e erro de rede caem no mesmo fallback visual seguro. A proxima
      // navegacao tenta novamente sem registrar dados autenticados no browser.
      definirSessao(null);
      definirFase('anonimo');
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const sair = useCallback(async () => {
    let logoutDoProvedor: string | null = null;
    // O logout local encerra o cookie da aplicacao, mas o Keycloak mantem a
    // sessao SSO. Buscar a URL antes de revogar a sessao garante que o proximo
    // login realmente mostre a tela de credenciais novamente.
    try {
      const resposta = await fetch('/api/v1/auth/logout/provedor', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (resposta.ok) {
        const corpo = (await resposta.json()) as { url?: unknown };
        logoutDoProvedor = typeof corpo.url === 'string' && corpo.url !== '' ? corpo.url : null;
      }
    } catch {
      // O logout local continua sendo executado mesmo se o provedor estiver
      // temporariamente indisponivel.
    }
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Falha ao avisar o servidor: a sessao local e' limpa assim mesmo, e o
      // servidor expira a sessao pela janela de tempo. O contrario, manter a
      // tela "logada" depois de um erro de rede, seria pior.
    }
    definirSessao(null);
    definirFase('anonimo');
    limparCacheDeSessao();
    if (logoutDoProvedor !== null) {
      window.location.assign(logoutDoProvedor);
    } else {
      window.location.assign('/');
    }
  }, []);

  const valor = useMemo<ContextoSessao>(
    () => ({ fase, sessao, recarregar, sair }),
    [fase, sessao, recarregar, sair],
  );

  return createElement(Contexto.Provider, { value: valor }, children);
}

export function useSessao(): ContextoSessao {
  const contexto = useContext(Contexto);
  if (contexto === null) {
    throw new Error('useSessao usado fora do ProvedorSessao');
  }
  return contexto;
}
