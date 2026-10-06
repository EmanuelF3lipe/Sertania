import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Tema = 'claro' | 'escuro';

interface ContextoTema {
  readonly tema: Tema;
  readonly alternarTema: () => void;
}

const Contexto = createContext<ContextoTema | null>(null);
const STORAGE_KEY = 'sertania-preferencia-tema';

function temaInicial(): Tema {
  try {
    const salvo = window.localStorage.getItem(STORAGE_KEY);
    if (salvo === 'claro' || salvo === 'escuro') return salvo;
  } catch {
    // A preferencia e opcional; sem storage a plataforma continua clara.
  }
  return 'claro';
}

export function ProvedorTema({ children }: { readonly children: ReactNode }) {
  const [tema, definirTema] = useState<Tema>(temaInicial);

  useLayoutEffect(() => {
    document.documentElement.dataset.tema = tema;
    document.documentElement.style.colorScheme = tema;
    try {
      window.localStorage.setItem(STORAGE_KEY, tema);
    } catch {
      // A interface segue funcionando mesmo quando preferencias nao persistem.
    }
  }, [tema]);

  const value = useMemo(
    () => ({
      tema,
      alternarTema: () => definirTema((atual) => (atual === 'claro' ? 'escuro' : 'claro')),
    }),
    [tema],
  );
  return <Contexto.Provider value={value}>{children}</Contexto.Provider>;
}

export function useTema(): ContextoTema {
  const value = useContext(Contexto);
  if (value === null) throw new Error('useTema usado fora do provedor');
  return value;
}
