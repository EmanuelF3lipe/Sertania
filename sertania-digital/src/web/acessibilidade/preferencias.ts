import { useSyncExternalStore } from 'react';

/**
 * Preferencias de acessibilidade, unicas para o app inteiro (topo publico, area da equipe e painel).
 * Ficam no aparelho (localStorage) e viram atributos data-* no <html>, que o CSS usa.
 */
export interface Prefs {
  theme: '' | 'light' | 'dark';
  contraste: '' | 'alto';
  texto: '' | 'grande' | 'enorme';
  espacamento: '' | 'amplo';
  fonte: '' | 'leitura';
  links: '' | 'destacados';
  cursor: '' | 'grande';
  movimento: '' | 'reduzido';
  alvos: '' | 'grandes';
  cores: '' | 'cinza';
  guia: '' | 'on';
  /** le em voz alta o que recebe foco ou toque */
  vozFoco: '' | 'on';
  /** velocidade da fala: 0.7, 1, 1.3 */
  vozVelocidade: string;
  /** mostra o microfone para ditar em qualquer campo de texto */
  ditado: '' | 'on';
  /** carrega o VLibras (tradutor para Libras do Governo Federal) */
  libras: '' | 'on';
}
export type ChavePref = keyof Prefs;

export const PADRAO: Prefs = {
  theme: '', contraste: '', texto: '', espacamento: '', fonte: '', links: '', cursor: '', movimento: '', alvos: '', cores: '', guia: '',
  vozFoco: '', vozVelocidade: '1', ditado: '', libras: '',
};
/** So estas viram atributo no <html> (as outras so mudam comportamento) */
const VISUAIS: ChavePref[] = ['theme', 'contraste', 'texto', 'espacamento', 'fonte', 'links', 'cursor', 'movimento', 'alvos', 'cores'];

function ler(): Prefs {
  try {
    const salvo = JSON.parse(localStorage.getItem('preferencias') ?? '{}') as Partial<Prefs>;
    return { ...PADRAO, ...salvo };
  } catch {
    return { ...PADRAO };
  }
}

let atual: Prefs = ler();
const ouvintes = new Set<() => void>();

export function aplicarNoDocumento(p: Prefs = atual): void {
  const r = document.documentElement;
  for (const k of VISUAIS) {
    const v = p[k];
    if (v) r.setAttribute(`data-${k}`, v);
    else r.removeAttribute(`data-${k}`);
  }
}

export function lerPrefs(): Prefs {
  return atual;
}

export function definirPref<K extends ChavePref>(k: K, v: Prefs[K]): void {
  atual = { ...atual, [k]: v };
  try { localStorage.setItem('preferencias', JSON.stringify(atual)); } catch { /* sem armazenamento */ }
  aplicarNoDocumento();
  ouvintes.forEach((f) => f());
}

export function restaurarPadrao(): void {
  atual = { ...PADRAO };
  try { localStorage.setItem('preferencias', JSON.stringify(atual)); } catch { /* sem armazenamento */ }
  aplicarNoDocumento();
  ouvintes.forEach((f) => f());
}

/** Quantos ajustes estao ligados (para o selo no botao de acessibilidade) */
export function ajustesAtivos(p: Prefs): number {
  return (Object.keys(PADRAO) as ChavePref[]).filter((k) => k !== 'vozVelocidade' && k !== 'theme' && p[k] && p[k] !== PADRAO[k]).length;
}

export function usePreferencias() {
  const p = useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    () => atual,
  );
  return {
    p,
    definir: definirPref,
    /** liga/desliga: se ja estiver no valor v, volta ao padrao */
    alternar: <K extends ChavePref>(k: K, v: Prefs[K]) => definirPref(k, (atual[k] === v ? PADRAO[k] : v) as Prefs[K]),
  };
}

// aplica assim que o modulo carrega, antes do primeiro desenho, para nao piscar
if (typeof document !== 'undefined') aplicarNoDocumento();
