import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Accessibility, BookOpen, Contrast, Eye, Hand, Keyboard, Mic, MicOff, Moon, MousePointer2, Phone, RotateCcw, Ruler, Square, Type, Underline, Volume2, X,
} from 'lucide-react';
import { useEstado, useRota } from '../nucleo';
import { AJUDA_COMANDOS, aplicarDitado, interpretarComando, type Comando } from './comandos';
import { ajustesAtivos, definirPref, lerPrefs, restaurarPadrao, usePreferencias, type ChavePref, type Prefs } from './preferencias';
import {
  acionarPorNome, clicaveisVisiveis, criarReconhecimento, definirValorCampo, descreverElemento, ehCampoTexto, falaDisponivel, falar,
  mensagemErroVoz, nomeAcessivel, pararFala, reconhecimentoDisponivel, textoDaPagina, useFala, type Reconhecimento,
} from './voz';

/* ================================================================ abrir o painel de qualquer lugar */
const EVENTO_ABRIR = 'sertania:abrir-acessibilidade';
export const abrirPainelAcessibilidade = () => window.dispatchEvent(new Event(EVENTO_ABRIR));

/* ================================================================ avisos curtos (sempre escritos; falados se a leitura estiver ligada) */
let aviso = { texto: '', n: 0 };
const ouvintesAviso = new Set<() => void>();
export function avisar(texto: string, falarTambem = lerPrefs().vozFoco === 'on'): void {
  aviso = { texto, n: aviso.n + 1 };
  ouvintesAviso.forEach((f) => f());
  if (falarTambem) falar(texto);
}
const useAviso = () => useSyncExternalStore((f) => { ouvintesAviso.add(f); return () => ouvintesAviso.delete(f); }, () => aviso);

/* ================================================================ comandos de voz (estado global) */
interface EstadoComandos { ativo: boolean; ouvindo: string; numeros: boolean }
let comandos: EstadoComandos = { ativo: false, ouvindo: '', numeros: false };
const ouvintesCmd = new Set<() => void>();
const mudarCmd = (m: Partial<EstadoComandos>) => { comandos = { ...comandos, ...m }; ouvintesCmd.forEach((f) => f()); };
const useComandos = () => useSyncExternalStore((f) => { ouvintesCmd.add(f); return () => ouvintesCmd.delete(f); }, () => comandos);
export const ligarComandos = (v: boolean) => mudarCmd({ ativo: v, ouvindo: '', numeros: v ? comandos.numeros : false });

const TAMANHOS: Array<[Prefs['texto'], string]> = [['', 'Normal'], ['grande', 'Grande'], ['enorme', 'Muito grande']];
const VELOCIDADES: Array<[string, string]> = [['0.7', 'Devagar'], ['1', 'Normal'], ['1.3', 'Rápido']];

function proximoCampo(direcao: 'proximo' | 'anterior') {
  const campos = Array.from(document.querySelectorAll<HTMLElement>('#conteudo input:not([type=hidden]), #conteudo textarea, #conteudo select')).filter((c) => !(c as HTMLInputElement).disabled && c.offsetParent);
  if (!campos.length) return avisar('Não há campos nesta tela.');
  const i = campos.indexOf(document.activeElement as HTMLElement);
  const alvo = campos[direcao === 'proximo' ? (i + 1) % campos.length : (i - 1 + campos.length) % campos.length]!;
  alvo.focus();
  avisar(descreverElemento(alvo));
}

let alvosNumerados: HTMLElement[] = [];
/** Se os numeros estao na tela, renumera depois que a pagina muda */
function renumerar() {
  if (!comandos.numeros) return;
  setTimeout(() => { alvosNumerados = clicaveisVisiveis(); mudarCmd({ numeros: true }); }, 450);
}

/** Executa um comando falado. Devolve a mensagem para a pessoa. */
function executar(c: Comando): void {
  const p = lerPrefs();
  switch (c.tipo) {
    case 'ir':
      window.location.hash = c.destino;
      return avisar('Abrindo a página.');
    case 'voltar':
      if (!acionarPorNome('voltar')) history.back();
      renumerar();
      return avisar('Voltando.');
    case 'clicar': {
      const feito = acionarPorNome(c.alvo);
      renumerar();
      return avisar(feito ? `Acionado: ${feito}` : `Não achei “${c.alvo}” nesta tela. Diga “mostrar números” para ver as opções.`);
    }
    case 'numeros':
      alvosNumerados = clicaveisVisiveis();
      mudarCmd({ numeros: true });
      return avisar(`${alvosNumerados.length} itens numerados. Diga o número.`);
    case 'esconderNumeros':
      return mudarCmd({ numeros: false });
    case 'numero': {
      const el = alvosNumerados[c.n - 1];
      mudarCmd({ numeros: false });
      if (!el || !document.contains(el)) return avisar(`Número ${c.n} não existe. Diga “mostrar números”.`);
      el.focus();
      if (!ehCampoTexto(el) && el.tagName !== 'SELECT') el.click();
      return avisar(ehCampoTexto(el) ? `Campo selecionado: ${nomeAcessivel(el)}. Diga “escrever” e o texto.` : el.tagName === 'SELECT' ? `Lista: ${nomeAcessivel(el)}. Diga “escolher” e o nome da opção.` : `Acionado: ${nomeAcessivel(el)}`);
    }
    case 'rolar': {
      const alt = window.innerHeight * 0.7;
      if (c.direcao === 'topo') window.scrollTo({ top: 0 });
      else if (c.direcao === 'fim') window.scrollTo({ top: document.body.scrollHeight });
      else window.scrollBy({ top: c.direcao === 'baixo' ? alt : -alt });
      renumerar();
      return;
    }
    case 'ler':
      return falar(textoDaPagina());
    case 'parar':
      return pararFala();
    case 'escrever': {
      const el = document.activeElement;
      if (!ehCampoTexto(el)) return avisar('Primeiro escolha um campo: diga “mostrar números” e o número do campo, ou “próximo campo”.');
      definirValorCampo(el, aplicarDitado(el.value, c.texto));
      return avisar(`Escrito: ${c.texto}`);
    }
    case 'apagarCampo': {
      const el = document.activeElement;
      if (ehCampoTexto(el)) definirValorCampo(el, '');
      return avisar('Campo apagado.');
    }
    case 'campo':
      return proximoCampo(c.direcao);
    case 'preferencia': {
      const ordem: Prefs['texto'][] = ['', 'grande', 'enorme'];
      const i = ordem.indexOf(p.texto);
      if (c.acao === 'letraMaior') definirPref('texto', ordem[Math.min(2, i + 1)]!);
      if (c.acao === 'letraMenor') definirPref('texto', ordem[Math.max(0, i - 1)]!);
      if (c.acao === 'contraste') definirPref('contraste', p.contraste ? '' : 'alto');
      if (c.acao === 'escuro') definirPref('theme', 'dark');
      if (c.acao === 'claro') definirPref('theme', '');
      return avisar('Pronto.');
    }
    case 'painel':
      abrirPainelAcessibilidade();
      return;
    case 'ajuda':
      abrirPainelAcessibilidade();
      setTimeout(() => document.getElementById('acess-comandos')?.setAttribute('open', ''), 50);
      return avisar('Abri a lista de comandos no painel de acessibilidade.');
    case 'desligar':
      ligarComandos(false);
      return avisar('Comandos de voz desligados.');
    case 'desconhecido':
      return avisar(`Não entendi “${c.frase}”. Diga “ajuda” para ver os comandos.`);
  }
}

/** Executa uma frase como se tivesse sido falada (usado tambem nos testes no navegador) */
export const executarFrase = (frase: string) => executar(interpretarComando(frase));

/** Mantem o microfone ouvindo enquanto os comandos estiverem ligados (o navegador para sozinho depois de um silencio). */
function MotorComandos() {
  const { ativo } = useComandos();
  useEffect(() => {
    if (!ativo) return;
    const r = criarReconhecimento(true);
    if (!r) { ligarComandos(false); avisar('Este navegador não tem reconhecimento de voz. Use o Chrome ou o Edge.', false); return; }
    let vivo = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const frase = res[0].transcript;
        if (res.isFinal) { mudarCmd({ ouvindo: '' }); executar(interpretarComando(frase)); }
        else mudarCmd({ ouvindo: frase });
      }
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      vivo = false;
      ligarComandos(false);
      avisar(mensagemErroVoz(e.error), false);
    };
    r.onend = () => { if (vivo) { try { r.start(); } catch { /* ja iniciado */ } } };
    try { r.start(); } catch { /* ja iniciado */ }
    avisar('Comandos de voz ligados. Diga “ajuda” para ver o que falar.');
    return () => { vivo = false; r.onend = null; r.abort(); };
  }, [ativo]);
  return null;
}

/** Numeros sobre tudo que da para clicar (como no acesso por voz dos celulares) */
function NumerosVoz() {
  const { numeros } = useComandos();
  const [, redesenhar] = useState(0);
  useEffect(() => {
    if (!numeros) return;
    const f = () => redesenhar((n) => n + 1);
    window.addEventListener('scroll', f, true);
    window.addEventListener('resize', f);
    return () => { window.removeEventListener('scroll', f, true); window.removeEventListener('resize', f); };
  }, [numeros]);
  if (!numeros) return null;
  return createPortal(
    <div className="numeros-voz" aria-hidden="true">
      {alvosNumerados.map((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return null;
        return <span key={i} style={{ top: Math.max(0, r.top - 6), left: Math.max(0, r.left - 6) }}>{i + 1}</span>;
      })}
    </div>,
    document.body,
  );
}

/* ================================================================ ditado (falar em vez de digitar) */

export function useDitado(campo: () => HTMLInputElement | HTMLTextAreaElement | null) {
  const [ouvindo, setOuvindo] = useState(false);
  const [parcial, setParcial] = useState('');
  const ref = useRef<Reconhecimento | null>(null);
  const parar = useCallback(() => { ref.current?.stop(); }, []);
  const iniciar = useCallback(() => {
    const alvo = campo();
    if (!alvo) return avisar('Toque primeiro no campo onde quer escrever.', false);
    const r = criarReconhecimento(true);
    if (!r) return avisar('Este navegador não tem ditado por voz. Use o Chrome ou o Edge, ou o microfone do teclado do celular.', false);
    pararFala();
    ref.current = r;
    r.onresult = (e) => {
      let meio = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) definirValorCampo(alvo, aplicarDitado(alvo.value, res[0].transcript));
        else meio += res[0].transcript;
      }
      setParcial(meio);
    };
    r.onerror = (e) => { if (e.error !== 'aborted') avisar(mensagemErroVoz(e.error), false); };
    r.onend = () => { setOuvindo(false); setParcial(''); ref.current = null; };
    try { r.start(); setOuvindo(true); alvo.focus(); } catch { setOuvindo(false); }
  }, [campo]);
  useEffect(() => () => ref.current?.abort(), []);
  return { ouvindo, parcial, iniciar, parar, disponivel: reconhecimentoDisponivel() };
}

/** Botao de microfone ao lado de um campo: fale e o texto aparece no campo. */
export function BotaoDitado({ campoId, rotulo = 'Falar em vez de digitar' }: { campoId: string; rotulo?: string }) {
  const d = useDitado(useCallback(() => document.getElementById(campoId) as HTMLInputElement | HTMLTextAreaElement | null, [campoId]));
  if (!d.disponivel) return null;
  return (
    <span className="ditado-campo">
      <button type="button" className={`botao sec peq${d.ouvindo ? ' ouvindo' : ''}`} aria-pressed={d.ouvindo} onMouseDown={(e) => e.preventDefault()} onClick={d.ouvindo ? d.parar : d.iniciar}>
        {d.ouvindo ? <><Square size={14} aria-hidden="true" /> Parar de ouvir</> : <><Mic size={16} aria-hidden="true" /> {rotulo}</>}
      </button>
      {d.ouvindo && <span className="pequeno ditado-parcial" aria-live="polite">{d.parcial || 'Pode falar… diga “vírgula” ou “ponto final” para pontuar.'}</span>}
    </span>
  );
}

/** Microfone flutuante: aparece quando o ditado esta ligado e ha um campo de texto selecionado. */
function DitadoFlutuante() {
  const { p } = usePreferencias();
  const [campo, setCampo] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (p.ditado !== 'on') return;
    const f = (e: FocusEvent) => { if (ehCampoTexto(e.target as Element)) setCampo(e.target as HTMLInputElement); };
    document.addEventListener('focusin', f);
    return () => document.removeEventListener('focusin', f);
  }, [p.ditado]);
  const d = useDitado(useCallback(() => (campo && document.contains(campo) ? campo : null), [campo]));
  if (p.ditado !== 'on' || !d.disponivel || !campo || !document.contains(campo)) return null;
  return (
    <div className="ditado-flutuante" role="region" aria-label="Ditado por voz">
      <button type="button" className={d.ouvindo ? 'ouvindo' : ''} aria-pressed={d.ouvindo} onMouseDown={(e) => e.preventDefault()} onClick={d.ouvindo ? d.parar : d.iniciar}>
        {d.ouvindo ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
        <span>{d.ouvindo ? 'Parar' : `Ditar em “${nomeAcessivel(campo).slice(0, 40) || 'campo'}”`}</span>
      </button>
      {d.ouvindo && <span className="ditado-parcial" aria-live="polite">{d.parcial || 'Pode falar…'}</span>}
    </div>
  );
}

/* ================================================================ leitura do que recebe foco/toque, e legenda da fala */

function LeituraAoTocar() {
  const { p } = usePreferencias();
  useEffect(() => {
    if (p.vozFoco !== 'on') return;
    const foco = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('.barra-fala')) return;
      falar(descreverElemento(el));
    };
    const toque = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('a, button, input, select, textarea, label, [role], .barra-fala, .painel-acess')) return;
      const bloco = el.closest('p, li, h1, h2, h3, h4, td, th, dd, dt, figcaption, .aviso, .ajuda, blockquote');
      if (bloco) falar((bloco as HTMLElement).innerText);
    };
    const selecao = () => {
      const t = window.getSelection()?.toString().trim();
      if (t && t.length > 2) falar(t);
    };
    document.addEventListener('focusin', foco);
    document.addEventListener('click', toque);
    document.addEventListener('mouseup', selecao);
    return () => { document.removeEventListener('focusin', foco); document.removeEventListener('click', toque); document.removeEventListener('mouseup', selecao); };
  }, [p.vozFoco]);
  return null;
}

/** Legenda do que esta sendo falado (serve tambem para quem nao ouve bem) e botao de parar */
function BarraFala() {
  const { falando, trecho } = useFala();
  const { texto, n } = useAviso();
  const { ativo, ouvindo } = useComandos();
  const [avisoVisivel, setAvisoVisivel] = useState('');
  useEffect(() => {
    if (!texto) return;
    setAvisoVisivel(texto);
    const t = setTimeout(() => setAvisoVisivel(''), 6000);
    return () => clearTimeout(t);
  }, [texto, n]);
  return (
    <>
      <div className="so-leitor" aria-live="assertive">{avisoVisivel}</div>
      {(falando || ativo || avisoVisivel) && (
        <div className="barra-fala" role="region" aria-label="Voz">
          {ativo && (
            <span className="bf-microfone"><Mic size={16} aria-hidden="true" /> {ouvindo ? `“${ouvindo}”` : 'Ouvindo comandos…'}
              <button type="button" className="botao sec peq" onClick={() => ligarComandos(false)}>Desligar</button>
            </span>
          )}
          {avisoVisivel && !falando && <span className="bf-aviso">{avisoVisivel}</span>}
          {falando && (
            <span className="bf-legenda"><Volume2 size={16} aria-hidden="true" /> <span>{trecho}</span>
              <button type="button" className="botao peq" onClick={pararFala}><Square size={14} aria-hidden="true" /> Parar leitura</button>
            </span>
          )}
        </div>
      )}
    </>
  );
}

/* ================================================================ guia de leitura (faixa que acompanha o ponteiro) */
function GuiaLeitura() {
  const { p } = usePreferencias();
  const [y, setY] = useState<number | null>(null);
  useEffect(() => {
    if (p.guia !== 'on') return;
    const f = (e: PointerEvent) => setY(e.clientY);
    window.addEventListener('pointermove', f);
    return () => window.removeEventListener('pointermove', f);
  }, [p.guia]);
  if (p.guia !== 'on' || y === null) return null;
  const meia = 34;
  return (
    <div className="guia-leitura" aria-hidden="true">
      <div style={{ height: Math.max(0, y - meia) }} />
      <div style={{ top: y + meia }} />
    </div>
  );
}

/* ================================================================ Libras: VLibras, do Governo Federal */
function Libras() {
  const { p } = usePreferencias();
  useEffect(() => {
    const existente = document.querySelector<HTMLElement>('div[vw]');
    if (p.libras !== 'on') { if (existente) existente.style.display = 'none'; return; }
    if (existente) { existente.style.display = ''; return; }
    const raiz = document.createElement('div');
    raiz.setAttribute('vw', '');
    raiz.className = 'enabled';
    raiz.innerHTML = '<div vw-access-button class="active"></div><div vw-plugin-wrapper><div class="vw-plugin-top-wrapper"></div></div>';
    document.body.appendChild(raiz);
    const s = document.createElement('script');
    s.src = 'https://vlibras.gov.br/app/vlibras-plugin.js';
    s.async = true;
    s.onload = () => {
      const w = window as unknown as { VLibras?: { Widget: new (url: string) => unknown }; onload?: ((e: Event) => void) | null };
      if (!w.VLibras) return;
      new w.VLibras.Widget('https://vlibras.gov.br/app');
      // o VLibras se inicia no evento "load" da pagina; como carregamos depois, disparamos a mao
      if (document.readyState === 'complete' && typeof w.onload === 'function') w.onload(new Event('load'));
      avisar('Tradutor de Libras ativado: clique na mão azul à direita e depois no texto que quer traduzir.');
    };
    s.onerror = () => {
      raiz.remove();
      avisar('Não foi possível carregar o tradutor de Libras. Ele precisa de internet (vlibras.gov.br).');
    };
    document.body.appendChild(s);
  }, [p.libras]);
  return null;
}

/* ================================================================ atalhos de teclado (padrao eMAG do governo) */
function AtalhosTeclado({ abrir }: { abrir: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { pararFala(); if (comandos.numeros) mudarCmd({ numeros: false }); }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const tecla = e.code.replace('Digit', '').replace('Numpad', '');
      if (tecla === '1') { e.preventDefault(); const m = document.getElementById('conteudo'); m?.focus(); m?.scrollIntoView(); }
      else if (tecla === '2') {
        e.preventDefault();
        const alvo = document.querySelector<HTMLElement>('#nav a, .ct-nav a') ;
        const botaoMenu = document.querySelector<HTMLElement>('.menu-botao, .so-celular');
        (alvo && alvo.offsetParent ? alvo : botaoMenu)?.focus();
      } else if (tecla === '3') { e.preventDefault(); abrir(); }
      else if (tecla === '4') { e.preventDefault(); if (window.speechSynthesis?.speaking) pararFala(); else falar(textoDaPagina()); }
      else if (tecla === '5') { e.preventDefault(); ligarComandos(!comandos.ativo); }
    };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [abrir]);
  return null;
}

/* ================================================================ troca de pagina: titulo, anuncio e foco no titulo */
function AnunciadorRota() {
  const { caminho } = useRota();
  const primeira = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => {
      const h1 = document.querySelector<HTMLElement>('#conteudo h1');
      const titulo = h1?.innerText.replace(/^✓\s*/, '').trim();
      document.title = titulo ? `${titulo} – Sertânia Digital` : 'Sertânia Digital';
      if (primeira.current) { primeira.current = false; return; }
      if (h1) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      } else document.getElementById('conteudo')?.focus({ preventScroll: true });
      if (comandos.numeros) mudarCmd({ numeros: false });
    }, 250);
    return () => clearTimeout(t);
  }, [caminho]);
  return null;
}

/* ================================================================ painel */

function Chave({ chave, valor, rotulo, ajuda, icone }: { chave: ChavePref; valor: string; rotulo: string; ajuda?: string; icone?: ReactNode }) {
  const { p, alternar } = usePreferencias();
  const ligado = p[chave] === valor;
  const id = `ac-${chave}`;
  return (
    <div className="ac-linha">
      <button id={id} type="button" role="switch" aria-checked={ligado} className="ac-chave" onClick={() => alternar(chave, valor as never)} aria-describedby={ajuda ? `${id}-ajuda` : undefined}>
        <span className="ac-chave-icone" aria-hidden="true">{icone}</span>
        <span className="ac-chave-texto">{rotulo}</span>
        <span className="ac-interruptor" aria-hidden="true"><i /></span>
      </button>
      {ajuda && <p id={`${id}-ajuda`} className="ac-ajuda">{ajuda}</p>}
    </div>
  );
}

function Escolha<T extends string>({ rotulo, opcoes, atual, aoEscolher }: { rotulo: string; opcoes: Array<[T, string]>; atual: T; aoEscolher: (v: T) => void }) {
  return (
    <div className="ac-escolha" role="group" aria-label={rotulo}>
      <span className="ac-escolha-rotulo">{rotulo}</span>
      <div>
        {opcoes.map(([v, r]) => <button key={v || 'normal'} type="button" aria-pressed={atual === v} onClick={() => aoEscolher(v)}>{r}</button>)}
      </div>
    </div>
  );
}

function Secao({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <section className="ac-secao">
      <h3><span aria-hidden="true">{icone}</span>{titulo}</h3>
      {children}
    </section>
  );
}

export function AtalhosLista() {
  return (
    <table className="ac-atalhos">
      <tbody>
        <tr><td><kbd>Alt</kbd> + <kbd>1</kbd></td><td>Ir para o conteúdo</td></tr>
        <tr><td><kbd>Alt</kbd> + <kbd>2</kbd></td><td>Ir para o menu</td></tr>
        <tr><td><kbd>Alt</kbd> + <kbd>3</kbd></td><td>Abrir este painel</td></tr>
        <tr><td><kbd>Alt</kbd> + <kbd>4</kbd></td><td>Ler a página em voz alta (de novo para parar)</td></tr>
        <tr><td><kbd>Alt</kbd> + <kbd>5</kbd></td><td>Ligar ou desligar os comandos de voz</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Parar a leitura e fechar janelas</td></tr>
        <tr><td><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd></td><td>Próximo / anterior item</td></tr>
      </tbody>
    </table>
  );
}

export function ComandosLista() {
  return (
    <table className="ac-atalhos">
      <tbody>{AJUDA_COMANDOS.map(([fala, faz]) => <tr key={fala}><td>{fala}</td><td>{faz}</td></tr>)}</tbody>
    </table>
  );
}

export function ContatoAtendimento() {
  const { instalacao } = useEstado();
  const par = instalacao?.parametros;
  const tel = par?.telefoneContato;
  const soDigitos = tel?.replace(/\D/g, '');
  return (
    <>
      <p>Se preferir não usar o site, a equipe da Prefeitura registra a solicitação para você e entrega o protocolo.</p>
      <ul className="ac-contatos">
        {tel && <li><Phone size={16} aria-hidden="true" /> Telefone ou WhatsApp: <a href={`tel:${soDigitos}`}>{tel}</a>{soDigitos && soDigitos.length >= 10 && <> · <a href={`https://wa.me/55${soDigitos.replace(/^55/, '')}`} target="_blank" rel="noreferrer">abrir no WhatsApp (pode mandar áudio)</a></>}</li>}
        {par?.emailContato && <li>E-mail: <a href={`mailto:${par.emailContato}`}>{par.emailContato}</a></li>}
        {par?.enderecoAtendimento && <li>Presencial: {par.enderecoAtendimento}{par.horarioAtendimento ? ` · ${par.horarioAtendimento}` : ''}</li>}
        {!tel && !par?.emailContato && !par?.enderecoAtendimento && <li>Procure o atendimento da Prefeitura.</li>}
      </ul>
    </>
  );
}

function Painel({ aberto, fechar }: { aberto: boolean; fechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { p, definir } = usePreferencias();
  const cmd = useComandos();
  const { falando } = useFala();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  const temFala = falaDisponivel();
  const temReconhecimento = reconhecimentoDisponivel();

  return (
    <dialog ref={ref} className="painel-acess" aria-labelledby="pa-titulo" onClose={fechar} onClick={(e) => { if (e.target === ref.current) fechar(); }}>
      <div className="pa-cabeca">
        <Accessibility size={26} aria-hidden="true" />
        <div>
          <h2 id="pa-titulo">Acessibilidade</h2>
          <p>Ajuste o site do seu jeito. As escolhas ficam guardadas neste aparelho.</p>
        </div>
        <button type="button" className="icone-botao" aria-label="Fechar painel de acessibilidade" onClick={fechar} autoFocus><X size={20} /></button>
      </div>

      <div className="pa-corpo">
        <Secao icone={<Eye size={18} />} titulo="Enxergar melhor">
          <Escolha rotulo="Tamanho das letras" opcoes={TAMANHOS} atual={p.texto} aoEscolher={(v) => definir('texto', v)} />
          <Chave chave="contraste" valor="alto" rotulo="Alto contraste" icone={<Contrast size={18} />} ajuda="Preto e branco puro, bordas fortes." />
          <Chave chave="theme" valor="dark" rotulo="Modo escuro" icone={<Moon size={18} />} />
          <Chave chave="cores" valor="cinza" rotulo="Tons de cinza" icone={<Contrast size={18} />} ajuda="Tira as cores. As informações nunca dependem só da cor: sempre há texto junto." />
          <Chave chave="links" valor="destacados" rotulo="Destacar links e o item selecionado" icone={<Underline size={18} />} />
          <Chave chave="cursor" valor="grande" rotulo="Cursor do mouse grande" icone={<MousePointer2 size={18} />} />
          <Chave chave="guia" valor="on" rotulo="Guia de leitura" icone={<Ruler size={18} />} ajuda="Escurece a tela acima e abaixo da linha onde está o ponteiro." />
        </Secao>

        <Secao icone={<Volume2 size={18} />} titulo="Ouvir o conteúdo">
          {temFala ? (
            <>
              <button type="button" className="botao largo" onClick={() => (falando ? pararFala() : (fechar(), setTimeout(() => falar(textoDaPagina()), 150)))}>
                {falando ? <><Square size={16} aria-hidden="true" /> Parar a leitura</> : <><Volume2 size={18} aria-hidden="true" /> Ler esta página em voz alta</>}
              </button>
              <Chave chave="vozFoco" valor="on" rotulo="Ler o que eu tocar, selecionar ou focar" icone={<Volume2 size={18} />} ajuda="Toque num texto ou botão para ouvir. Com o teclado, cada item é lido ao passar com Tab. A fala aparece também escrita na parte de baixo da tela." />
              <Escolha rotulo="Velocidade da voz" opcoes={VELOCIDADES} atual={p.vozVelocidade} aoEscolher={(v) => definir('vozVelocidade', v)} />
              <p className="ac-ajuda">Usa um leitor de tela (NVDA, JAWS, TalkBack, VoiceOver)? O site funciona com ele: títulos, campos e botões têm nomes, e os avisos são anunciados.</p>
            </>
          ) : <p className="ac-ajuda">Este navegador não tem leitura em voz alta. Experimente o Chrome, o Edge ou o leitor de tela do seu aparelho.</p>}
        </Secao>

        <Secao icone={<Hand size={18} />} titulo="Libras e quem não ouve">
          <Chave chave="libras" valor="on" rotulo="Tradutor de Libras (VLibras)" icone={<Hand size={18} />} ajuda="Avatar do Governo Federal que traduz o texto para Libras. Carrega de vlibras.gov.br e precisa de internet. Depois de ligar, clique na mão azul e no texto." />
          <p className="ac-ajuda">O site não depende de som: avisos, prazos e respostas da Prefeitura aparecem sempre por escrito, e você pode acompanhar tudo pelo protocolo e pelo WhatsApp por mensagem de texto.</p>
        </Secao>

        <Secao icone={<Mic size={18} />} titulo="Sem digitar ou sem mouse">
          {temReconhecimento ? (
            <>
              <button type="button" className={`botao largo${cmd.ativo ? ' perigo' : ''}`} onClick={() => ligarComandos(!cmd.ativo)} aria-pressed={cmd.ativo}>
                {cmd.ativo ? <><MicOff size={18} aria-hidden="true" /> Desligar comandos de voz</> : <><Mic size={18} aria-hidden="true" /> Ligar comandos de voz</>}
              </button>
              <p className="ac-ajuda">Controle o site falando: “ir para registrar”, “mostrar números”, “número 3”, “continuar”. O navegador pede para usar o microfone; no Chrome, o áudio é processado pelo serviço de voz do Google.</p>
              <details id="acess-comandos" className="ac-detalhes"><summary>O que posso falar?</summary><ComandosLista /></details>
              <Chave chave="ditado" valor="on" rotulo="Microfone para ditar em qualquer campo" icone={<Mic size={18} />} ajuda="Ao tocar num campo de texto aparece o botão Ditar. Diga “vírgula”, “ponto final” ou “nova linha” para pontuar." />
            </>
          ) : <p className="ac-ajuda">Este navegador não reconhece voz. No celular, use o microfone do próprio teclado; no computador, o Chrome ou o Edge.</p>}
          <Chave chave="alvos" valor="grandes" rotulo="Botões e campos maiores" icone={<MousePointer2 size={18} />} ajuda="Mais fácil de acertar com o dedo, com tremor ou com mouse adaptado." />
          <details className="ac-detalhes"><summary><Keyboard size={16} aria-hidden="true" /> Atalhos de teclado</summary><AtalhosLista /><p className="ac-ajuda">Todo o site funciona só com o teclado. No Firefox, use <kbd>Alt</kbd> + <kbd>Shift</kbd> + número.</p></details>
        </Secao>

        <Secao icone={<BookOpen size={18} />} titulo="Leitura e atenção">
          <Chave chave="fonte" valor="leitura" rotulo="Fonte de leitura fácil" icone={<Type size={18} />} ajuda="Uma só fonte, sem itálico, alinhada à esquerda. Ajuda pessoas com dislexia." />
          <Chave chave="espacamento" valor="amplo" rotulo="Mais espaço entre letras e linhas" icone={<Type size={18} />} />
          <Chave chave="movimento" valor="reduzido" rotulo="Sem animações" icone={<Eye size={18} />} />
        </Secao>

        <Secao icone={<Phone size={18} />} titulo="Atendimento sem usar o site">
          <ContatoAtendimento />
        </Secao>
      </div>

      <div className="pa-pe">
        <button type="button" className="botao sec" onClick={() => { restaurarPadrao(); avisar('Ajustes de acessibilidade restaurados.'); }}><RotateCcw size={16} aria-hidden="true" /> Restaurar padrão</button>
        <a href="#/acessibilidade" onClick={fechar}>Sobre a acessibilidade do site</a>
      </div>
    </dialog>
  );
}

/** Tudo de acessibilidade que vale para o app inteiro. Renderizado uma vez em App. */
export function Acessibilidade() {
  const [aberto, setAberto] = useState(false);
  const { p } = usePreferencias();
  const opener = useRef<HTMLElement | null>(null);
  const abrir = useCallback(() => { opener.current = document.activeElement as HTMLElement; setAberto(true); }, []);
  const fechar = useCallback(() => { setAberto(false); setTimeout(() => opener.current?.focus(), 0); }, []);
  useEffect(() => {
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, [abrir]);
  const n = ajustesAtivos(p);
  return (
    <>
      <button type="button" className="botao-acess" onClick={abrir} aria-haspopup="dialog" title="Acessibilidade (Alt + 3)">
        <Accessibility size={28} aria-hidden="true" />
        <span className="so-leitor">Acessibilidade{n ? `: ${n} ajuste(s) ligado(s)` : ''}</span>
        {n > 0 && <span className="ba-selo" aria-hidden="true">{n}</span>}
      </button>
      <Painel aberto={aberto} fechar={fechar} />
      <BarraFala />
      <GuiaLeitura />
      <LeituraAoTocar />
      <DitadoFlutuante />
      <MotorComandos />
      <NumerosVoz />
      <Libras />
      <AtalhosTeclado abrir={abrir} />
      <AnunciadorRota />
    </>
  );
}
