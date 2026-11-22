import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Catalogo, Permissao, UsuarioSessao } from '../shared/dominio';
import { definirCsrf, get, lerSessao, post } from './api';

// ------------------------------------------------------------------ roteador por hash
export function useRota(): { caminho: string; partes: string[]; query: URLSearchParams } {
  const ler = () => {
    const h = window.location.hash.replace(/^#/, '') || '/';
    const [caminho, q] = h.split('?');
    return { caminho: caminho || '/', partes: (caminho || '/').split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
  };
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const f = () => {
      setRota(ler());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return rota;
}
export const ir = (caminho: string) => {
  window.location.hash = caminho;
};

// ------------------------------------------------------------------ sessao e catalogo
export interface Instalacao { precisaPrimeiroAcesso: boolean; demonstracao: boolean; ia: string }

interface Estado {
  instalacao: Instalacao | null;
  recarregarInstalacao: () => void;
  usuario: UsuarioSessao | null;
  carregando: boolean;
  catalogo: Catalogo | null;
  definirUsuario: (u: UsuarioSessao | null, csrf?: string) => void;
  sair: () => Promise<void>;
  pode: (...p: Permissao[]) => boolean;
  recarregarCatalogo: () => void;
}
const Ctx = createContext<Estado | null>(null);

export function ProvedorEstado({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const recarregarCatalogo = useCallback(() => {
    get<Catalogo>('/publico/catalogo')
      .then((c) => {
        setCatalogo(c);
        try { localStorage.setItem('catalogo', JSON.stringify(c)); } catch { /* sem armazenamento */ }
      })
      .catch(() => {
        try {
          const c = localStorage.getItem('catalogo');
          if (c) setCatalogo(JSON.parse(c) as Catalogo); // modo offline
        } catch { /* ignora */ }
        setTimeout(() => recarregarRef.current(), 5000); // tenta de novo quando a conexao voltar
      });
  }, []);
  const recarregarRef = useRef(recarregarCatalogo);
  recarregarRef.current = recarregarCatalogo;
  const [instalacao, setInstalacao] = useState<Instalacao | null>(null);
  const recarregarInstalacao = useCallback(() => {
    get<Instalacao>('/configuracao/estado').then(setInstalacao).catch(() => undefined);
  }, []);
  useEffect(() => {
    lerSessao().then(setUsuario).catch(() => setUsuario(null)).finally(() => setCarregando(false));
    recarregarCatalogo();
    recarregarInstalacao();
  }, [recarregarCatalogo, recarregarInstalacao]);
  const valor: Estado = {
    instalacao, recarregarInstalacao,
    usuario, carregando, catalogo, recarregarCatalogo,
    definirUsuario: (u, csrf) => {
      definirCsrf(csrf);
      setUsuario(u);
    },
    sair: async () => {
      await post('/auth/sair').catch(() => undefined);
      definirCsrf('');
      setUsuario(null);
      ir('/');
    },
    pode: (...p) => !!usuario && p.some((x) => usuario.permissoes.includes(x)),
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
export function useEstado(): Estado {
  const c = useContext(Ctx);
  if (!c) throw new Error('ProvedorEstado ausente');
  return c;
}

// ------------------------------------------------------------------ preferencias de acessibilidade
type Pref = 'theme' | 'contraste' | 'texto' | 'movimento';
const PADRAO: Record<Pref, string> = { theme: '', contraste: '', texto: '', movimento: '' };
function aplicar(p: Record<Pref, string>) {
  const r = document.documentElement;
  for (const [k, v] of Object.entries(p)) {
    if (v) r.setAttribute(`data-${k}`, v);
    else r.removeAttribute(`data-${k}`);
  }
}
export function usePreferencias() {
  const [p, setP] = useState<Record<Pref, string>>(() => {
    try {
      return { ...PADRAO, ...(JSON.parse(localStorage.getItem('preferencias') ?? '{}') as Record<Pref, string>) };
    } catch {
      return PADRAO;
    }
  });
  useEffect(() => {
    aplicar(p);
    try { localStorage.setItem('preferencias', JSON.stringify(p)); } catch { /* ignora */ }
  }, [p]);
  return { p, alternar: (k: Pref, v: string) => setP((a) => ({ ...a, [k]: a[k] === v ? '' : v })) };
}

// ------------------------------------------------------------------ carregamento de dados
export function useDados<T>(rota: string | null, deps: unknown[] = []): { dados: T | null; erro: string | null; carregando: boolean; recarregar: () => void } {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!rota) return;
    let vivo = true;
    setCarregando(true);
    get<T>(rota)
      .then((d) => { if (vivo) { setDados(d); setErro(null); } })
      .catch((e: Error) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rota, n, ...deps]);
  return { dados, erro, carregando, recarregar: () => setN((x) => x + 1) };
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}
