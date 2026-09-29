import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type PresetAcessibilidade = 'padrao' | 'alto-contraste' | 'texto-ampliado' | 'menos-movimento';

export const PRESETS_ACESSIBILIDADE: ReadonlyArray<{
  id: PresetAcessibilidade;
  name: string;
  description: string;
}> = [
  { id: 'padrao', name: 'Padrao', description: 'Visual original da plataforma.' },
  { id: 'alto-contraste', name: 'Alto contraste', description: 'Mais contraste entre texto, fundo e controles.' },
  { id: 'texto-ampliado', name: 'Texto ampliado', description: 'Aumenta o tamanho do texto e o espacamento.' },
  { id: 'menos-movimento', name: 'Menos movimento', description: 'Reduz animacoes e transicoes.' },
];

interface AcessibilidadeContexto {
  readonly preset: PresetAcessibilidade;
  readonly definirPreset: (preset: PresetAcessibilidade) => void;
}

const Contexto = createContext<AcessibilidadeContexto | null>(null);
const STORAGE_KEY = 'sertania-preferencia-acessibilidade';

function presetInicial(): PresetAcessibilidade {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Preferencias sao opcionais; navegadores que bloqueiam storage usam o padrao.
  }
  return PRESETS_ACESSIBILIDADE.some((item) => item.id === value)
    ? value as PresetAcessibilidade
    : 'padrao';
}

export function ProvedorAcessibilidade({ children }: { readonly children: ReactNode }) {
  const [preset, definirPreset] = useState<PresetAcessibilidade>(presetInicial);

  useEffect(() => {
    document.documentElement.dataset.acessibilidade = preset;
    try {
      window.localStorage.setItem(STORAGE_KEY, preset);
    } catch {
      // A interface continua utilizavel mesmo sem persistencia de preferencias.
    }
  }, [preset]);

  const value = useMemo(() => ({ preset, definirPreset }), [preset]);
  return <Contexto.Provider value={value}>{children}</Contexto.Provider>;
}

export function useAcessibilidade(): AcessibilidadeContexto {
  const value = useContext(Contexto);
  if (value === null) throw new Error('useAcessibilidade usado fora do provedor');
  return value;
}
