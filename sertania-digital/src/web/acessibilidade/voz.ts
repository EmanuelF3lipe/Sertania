import { useSyncExternalStore } from 'react';
import { normalizar } from './comandos';
import { lerPrefs } from './preferencias';

/* ================================================================ leitura em voz alta (sintese de fala do navegador) */

interface EstadoFala { falando: boolean; trecho: string }
let fala: EstadoFala = { falando: false, trecho: '' };
const ouvintesFala = new Set<() => void>();
const mudarFala = (e: EstadoFala) => { fala = e; ouvintesFala.forEach((f) => f()); };

export const falaDisponivel = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

function vozPortugues(): SpeechSynthesisVoice | undefined {
  const vozes = window.speechSynthesis.getVoices();
  return vozes.find((v) => v.lang === 'pt-BR') ?? vozes.find((v) => v.lang.toLowerCase().startsWith('pt'));
}

/** Quebra em frases curtas: o Chrome corta falas longas, e a legenda acompanha frase a frase. */
export function emFrases(texto: string): string[] {
  return texto
    .split(/\n+|(?<=[.!?;:])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s))
    .flatMap((s) => (s.length <= 220 ? [s] : s.match(/.{1,200}(\s|$)/g) ?? [s]));
}

let geracao = 0;
/** Fala o texto. Interrompe o que estava sendo lido. */
export function falar(texto: string): void {
  if (!falaDisponivel()) return;
  const sintese = window.speechSynthesis;
  sintese.cancel();
  const frases = emFrases(texto);
  if (!frases.length) return mudarFala({ falando: false, trecho: '' });
  const minha = ++geracao;
  const velocidade = Number(lerPrefs().vozVelocidade) || 1;
  const voz = vozPortugues();
  frases.forEach((f, i) => {
    const u = new SpeechSynthesisUtterance(f);
    u.lang = 'pt-BR';
    u.rate = velocidade;
    if (voz) u.voice = voz;
    u.onstart = () => { if (minha === geracao) mudarFala({ falando: true, trecho: f }); };
    const fim = () => { if (minha === geracao && i === frases.length - 1) mudarFala({ falando: false, trecho: '' }); };
    u.onend = fim;
    u.onerror = fim;
    sintese.speak(u);
  });
  mudarFala({ falando: true, trecho: frases[0]! });
}

export function pararFala(): void {
  geracao++;
  if (falaDisponivel()) window.speechSynthesis.cancel();
  mudarFala({ falando: false, trecho: '' });
}

export function useFala(): EstadoFala {
  return useSyncExternalStore((f) => { ouvintesFala.add(f); return () => ouvintesFala.delete(f); }, () => fala);
}

/* ================================================================ reconhecimento de voz (ditado e comandos) */

interface ResultadoReconhecimento { isFinal: boolean; 0: { transcript: string } }
export interface Reconhecimento {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ResultadoReconhecimento> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type Construtor = new () => Reconhecimento;

function construtor(): Construtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: Construtor; webkitSpeechRecognition?: Construtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const reconhecimentoDisponivel = (): boolean => !!construtor();

export function criarReconhecimento(continuo: boolean): Reconhecimento | null {
  const C = construtor();
  if (!C) return null;
  const r = new C();
  r.lang = 'pt-BR';
  r.continuous = continuo;
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

export function mensagemErroVoz(erro: string): string {
  if (erro === 'not-allowed' || erro === 'service-not-allowed') return 'O navegador não liberou o microfone. Toque no cadeado ao lado do endereço do site e permita o microfone.';
  if (erro === 'no-speech') return 'Não ouvi nada. Toque no microfone e fale perto do aparelho.';
  if (erro === 'audio-capture') return 'Nenhum microfone encontrado neste aparelho.';
  if (erro === 'network') return 'O reconhecimento de voz precisa de internet.';
  return 'Não foi possível usar o microfone agora.';
}

/* ================================================================ ajudas para mexer na pagina */

const CAMPO_TEXTO = 'textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=tel], input[type=url], input[type=password], input[type=number]';
export const ehCampoTexto = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => !!el && el.matches(CAMPO_TEXTO) && !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly;

/** Muda o valor de um campo controlado pelo React (precisa do setter nativo + evento input). */
export function definirValorCampo(el: HTMLInputElement | HTMLTextAreaElement, valor: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, valor);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function visivel(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
  const r = h.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(h);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

/** Texto que um leitor de tela diria para o elemento */
export function nomeAcessivel(el: Element): string {
  const h = el as HTMLElement;
  const rotulo = h.getAttribute('aria-label');
  const porId = h.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ').trim();
  let nome = rotulo || porId || '';
  if (!nome && (h instanceof HTMLInputElement || h instanceof HTMLTextAreaElement || h instanceof HTMLSelectElement)) {
    nome = h.labels?.[0]?.innerText ?? h.getAttribute('placeholder') ?? h.name ?? '';
  }
  if (!nome && h instanceof HTMLImageElement) nome = h.alt;
  if (!nome) nome = h.innerText ?? h.textContent ?? '';
  if (!nome) nome = h.getAttribute('title') ?? '';
  return nome.replace(/\s+/g, ' ').trim();
}

/** Como anunciar o elemento: nome + papel + estado ("Contraste forte, botão, ligado") */
export function descreverElemento(el: Element): string {
  const h = el as HTMLElement;
  const nome = nomeAcessivel(h);
  const papelAria = h.getAttribute('role');
  const partes = [nome];
  if (h instanceof HTMLInputElement && h.type === 'checkbox') partes.push('caixa de marcação', h.checked ? 'marcada' : 'desmarcada');
  else if (h instanceof HTMLInputElement && h.type === 'radio') partes.push('opção', h.checked ? 'escolhida' : 'não escolhida');
  else if (h instanceof HTMLSelectElement) partes.push('lista de opções', h.selectedOptions[0]?.text ?? '');
  else if (h instanceof HTMLInputElement || h instanceof HTMLTextAreaElement) partes.push('campo de texto', h.value ? `preenchido: ${h.value.slice(0, 120)}` : 'vazio');
  else if (papelAria === 'switch') partes.push('chave', h.getAttribute('aria-checked') === 'true' ? 'ligada' : 'desligada');
  else if (h.tagName === 'BUTTON' || papelAria === 'button' || papelAria?.startsWith('menuitem') || papelAria === 'tab') {
    partes.push('botão');
    if (h.getAttribute('aria-pressed') === 'true' || h.getAttribute('aria-checked') === 'true' || h.getAttribute('aria-selected') === 'true') partes.push('ativado');
    if (h.getAttribute('aria-expanded') === 'true') partes.push('aberto');
  } else if (h.tagName === 'A') partes.push(h.getAttribute('aria-current') === 'page' ? 'link, página atual' : 'link');
  else if (/^H[1-6]$/.test(h.tagName)) partes.push(`título nível ${h.tagName[1]}`);
  return partes.filter(Boolean).join(', ');
}

const CLICAVEIS = 'a[href], button, [role=button], [role=tab], [role=switch], [role=menuitem], [role=menuitemcheckbox], input[type=checkbox], input[type=radio], input[type=submit], summary, label.check';
export function clicaveisVisiveis(raiz: ParentNode = document): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(`${CLICAVEIS}, ${CAMPO_TEXTO}, select`))
    .filter((el) => !(el as HTMLButtonElement).disabled && visivel(el) && !el.closest('.numeros-voz'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth; });
}

/**
 * Acha e aciona o elemento cujo nome bate com o que a pessoa falou.
 * Tambem escolhe opcoes de listas (select). Devolve o que foi acionado, para anunciar.
 */
export function acionarPorNome(alvo: string): string | null {
  const a = normalizar(alvo);
  if (!a) return null;
  const candidatos = Array.from(document.querySelectorAll<HTMLElement>(CLICAVEIS))
    .filter((el) => !(el as HTMLButtonElement).disabled && visivel(el) && !el.closest('.numeros-voz, .painel-acess-fala'));
  const nota = (el: HTMLElement) => {
    const n = normalizar(nomeAcessivel(el).replace(/[←→✓✕☰▲⚠]/g, ''));
    if (!n) return 0;
    if (n === a) return 3;
    if (n.startsWith(a)) return 2;
    if (n.includes(a)) return 1;
    return 0;
  };
  const melhor = candidatos.map((el) => [el, nota(el)] as const).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1])[0]?.[0];
  if (melhor) {
    melhor.focus({ preventScroll: false });
    melhor.click();
    return nomeAcessivel(melhor);
  }
  // opcao de lista: "escolher iluminacao"
  for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>('select')).filter(visivel)) {
    const op = Array.from(sel.options).find((o) => o.value && normalizar(o.text).includes(a));
    if (op) {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      set?.call(sel, op.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.focus();
      return op.text;
    }
  }
  return null;
}

/** Texto principal da tela para "ler a pagina" */
export function textoDaPagina(): string {
  const raiz = document.getElementById('conteudo') ?? document.body;
  const partes: string[] = [];
  const andar = (no: Node) => {
    if (no.nodeType === Node.TEXT_NODE) { partes.push(no.textContent ?? ''); return; }
    if (!(no instanceof HTMLElement)) return;
    if (no.getAttribute('aria-hidden') === 'true' || no.hidden || ['SCRIPT', 'STYLE', 'SVG', 'svg', 'NOSCRIPT'].includes(no.tagName)) return;
    if (no.classList.contains('leaflet-container')) { partes.push('\nMapa interativo.\n'); return; }
    const s = getComputedStyle(no);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    if (no instanceof HTMLImageElement) { if (no.alt) partes.push(` Imagem: ${no.alt}. `); return; }
    if (no instanceof HTMLInputElement || no instanceof HTMLTextAreaElement || no instanceof HTMLSelectElement) { partes.push(`\n${descreverElemento(no)}.\n`); return; }
    const bloco = s.display !== 'inline' && s.display !== 'inline-block';
    if (bloco) partes.push('\n');
    if (no.tagName === 'LABEL') { partes.push(no.innerText + ': '); return; }
    no.childNodes.forEach(andar);
    if (bloco) partes.push('\n');
  };
  andar(raiz);
  return partes.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
