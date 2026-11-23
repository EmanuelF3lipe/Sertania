import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Accessibility, Bell, ChartColumn, Code, Eye, FileText, Globe, Headset, Inbox, KeyRound, LogOut, Map as MapaIcone, Menu, Moon, PanelLeftClose,
  PanelLeftOpen, Settings, Sun, Sunrise, UserRound, X, type LucideIcon,
} from 'lucide-react';
import { ESCOPO_PAPEL, PAPEL_TEXTO, type Permissao } from '../../shared/dominio';
import { ir, useEstado, usePreferencias, useRota } from '../nucleo';
import { abrirPainelAcessibilidade } from '../acessibilidade/painel';

export interface ItemMenu { href: string; rotulo: string; icone: LucideIcon; perm?: Permissao[] }
export interface SecaoMenu { rotulo: string; itens: ItemMenu[] }

/** Menu da equipe em secoes pelo que a pessoa vai fazer. Cada item so aparece com a permissao. */
export const MENU: SecaoMenu[] = [
  { rotulo: '', itens: [{ href: '/equipe', rotulo: 'Meu dia', icone: Sunrise }] },
  {
    rotulo: 'Atender', itens: [
      { href: '/gestao/fila', rotulo: 'Fila de solicitações', icone: Inbox, perm: ['demanda.ver'] },
      { href: '/gestao/assistido', rotulo: 'Registrar no balcão', icone: Headset, perm: ['demanda.registrar_assistido'] },
      { href: '/gestao/alertas', rotulo: 'Alertas e IA', icone: Bell, perm: ['painel.ver', 'demanda.triagem', 'demanda.executar'] },
    ],
  },
  {
    rotulo: 'Acompanhar', itens: [
      { href: '/gestao/painel', rotulo: 'Indicadores', icone: ChartColumn, perm: ['painel.ver'] },
      { href: '/gestao/mapa', rotulo: 'Mapa do município', icone: MapaIcone, perm: ['demanda.ver'] },
      { href: '/gestao/relatorios', rotulo: 'Relatórios', icone: FileText, perm: ['relatorio.gerar', 'painel.ver'] },
    ],
  },
  { rotulo: 'Ajustar', itens: [{ href: '/config', rotulo: 'Configurações', icone: Settings }] },
  {
    rotulo: 'Portal público', itens: [
      { href: '/', rotulo: 'Página do cidadão', icone: Globe },
      { href: '/transparencia', rotulo: 'Transparência', icone: Eye },
      { href: '/api', rotulo: 'API e integrações', icone: Code },
    ],
  },
];

/** Guia de cada tela: passos curtos, numerados. */
const GUIA: Array<[string, string, string[]]> = [
  ['/equipe', 'Meu dia', ['Os números contam só o seu escopo: setor, secretaria ou município.', 'Toque em um número para abrir a fila já filtrada.', '“Na frente da fila” mostra o que pede atenção primeiro.', 'Fixe os caminhos que você mais usa com o alfinete.']],
  ['/gestao/fila', 'Fila de solicitações', ['Use os recortes (triagem, minhas, vencidas…) para focar.', 'Abra a solicitação para encaminhar, agendar, executar ou concluir.', 'O prazo conta dias úteis e para enquanto se espera o cidadão.']],
  ['/gestao/demanda', 'Solicitação', ['A IA sugere serviço, prioridade e resumo. Nada muda sem a sua decisão.', 'Nota interna não aparece para o cidadão; texto público, sim.', 'Para concluir, informe o resultado e o porquê.']],
  ['/gestao/assistido', 'Registrar no balcão', ['Para pedidos feitos no balcão, por telefone, WhatsApp ou ouvidoria.', 'No final, entregue o protocolo e o código: com eles a pessoa acompanha sem conta.']],
  ['/gestao/alertas', 'Alertas e IA', ['Surgem alertas quando o prazo passa de 80%, vence, um problema se repete no mesmo lugar ou uma localidade dispara.', 'Marque como tratado depois de agir.']],
  ['/gestao/painel', 'Indicadores', ['Filtre por período, secretaria, setor, serviço, situação, localidade e canal.', 'Todo gráfico tem “Ver como tabela” e exporta sem dados pessoais.']],
  ['/gestao/mapa', 'Mapa do município', ['A cor é a situação; o tamanho, a prioridade.', 'Pedidos sem ponto no mapa ficam na posição aproximada da localidade.']],
  ['/gestao/relatorios', 'Relatórios', ['A IA escreve um rascunho; ele só vale depois da revisão de um gestor.', 'Use Imprimir para gerar o PDF.']],
  ['/config', 'Configurações', ['O índice à esquerda separa o que é seu, da prefeitura, das pessoas e dos dados.', 'Servidores novos recebem senha provisória e criam a sua no primeiro acesso.', 'Em Quem pode o quê, marque na matriz o que cada perfil faz.', 'Toda mudança fica na Auditoria.']],
];
const guiaDa = (c: string) => GUIA.find(([p]) => c === p || c.startsWith(p + '/')) ?? GUIA[0]!;

function titulos(caminho: string): { titulo: string; trilha: string } {
  for (const s of MENU) for (const i of s.itens) {
    if (i.href !== '/' && (caminho === i.href || caminho.startsWith(i.href + '/'))) return { titulo: i.rotulo, trilha: s.rotulo || 'Início' };
  }
  if (caminho.startsWith('/gestao/demanda')) return { titulo: 'Solicitação', trilha: 'Atender' };
  if (caminho === '/api') return { titulo: 'API e integrações', trilha: 'Portal público' };
  return { titulo: 'Área da equipe', trilha: '' };
}

function lerLocal(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarLocal(chave: string, v: string): void {
  try { localStorage.setItem(chave, v); } catch { /* sem armazenamento */ }
}

export function iniciais(nome: string): string {
  const p = nome.replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]![0] : '')).toUpperCase();
}

/** Marca: sol de xilogravura nascendo atras de um mandacaru, sobre a caatinga. */
export function MarcaSertania({ tamanho = 34 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden="true" className="marca-svg">
      <rect width="32" height="32" rx="7" fill="#0b3a22" />
      <g fill="#f0b400">
        <path d="M15 5.5h2l-1 4.5z" /><path d="M6.2 9.6l1.5-1.3 2.6 3.9z" /><path d="M25.8 9.6l-1.5-1.3-2.6 3.9z" />
        <path d="M2.8 16.6l.6-1.9 4.3 1.6z" /><path d="M29.2 16.6l-.6-1.9-4.3 1.6z" /><path d="M8.5 22.5a7.5 7.5 0 0 1 15 0z" />
      </g>
      <path d="M20.4 22.5v-9.2a1.6 1.6 0 0 1 3.2 0v9.2zM23.6 18h1.6a1 1 0 0 0 1-1v-2.4a.9.9 0 0 1 1.8 0v2.9a2.6 2.6 0 0 1-2.6 2.6h-1.8zM20.4 19.4h-1.4a2.3 2.3 0 0 1-2.3-2.3v-1.6a.9.9 0 0 1 1.8 0v1.3a.8.8 0 0 0 .8.8h1.1z" fill="#5dbb82" />
      <rect x="3.5" y="22.5" width="25" height="3" rx="1.2" fill="#3fb874" />
    </svg>
  );
}

/** Estrutura das telas da equipe: coluna de tinta com secoes, barra com titulo e carimbo de lotacao, guia da tela. */
export function Casca({ children }: { children: ReactNode }) {
  const { usuario, pode, sair, instalacao, catalogo } = useEstado();
  const { caminho } = useRota();
  const { p, alternar } = usePreferencias();
  const [estreito, setEstreito] = useState(() => lerLocal('menu-estreito') === '1');
  const [gaveta, setGaveta] = useState(false);
  const [guia, setGuia] = useState(false);
  const [conta, setConta] = useState(false);
  const refConta = useRef<HTMLDivElement>(null);

  useEffect(() => { setGaveta(false); setConta(false); }, [caminho]);
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (refConta.current && !refConta.current.contains(e.target as Node)) setConta(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setConta(false); setGuia(false); setGaveta(false); } };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, []);

  if (!usuario) return <>{children}</>;
  const alternarEstreito = () => setEstreito((r) => { gravarLocal('menu-estreito', r ? '0' : '1'); return !r; });
  const visivel = (i: ItemMenu) => i.href === '/config' || !i.perm || pode(...i.perm);
  const ativo = (href: string) => (href === '/' ? caminho === '/' : caminho === href || caminho.startsWith(href + '/') || (href === '/gestao/fila' && caminho.startsWith('/gestao/demanda')));
  const sigla = catalogo?.secretarias.find((s) => s.id === usuario.secretariaId)?.sigla;
  const setor = catalogo?.setores.find((s) => s.id === usuario.setorId)?.nome;
  const { titulo, trilha } = titulos(caminho);
  const [, tituloGuia, passos] = guiaDa(caminho);
  const nomeSistema = instalacao?.parametros.nomeSistema ?? 'Sertânia Digital';
  const escuro = p.theme === 'dark';

  return (
    <div className={`casca${estreito ? ' estreita' : ''}${gaveta ? ' gaveta-aberta' : ''}`}>
      <aside className="coluna-tinta" aria-label="Menu da equipe">
        <a className="ct-marca" href="#/equipe" title={nomeSistema}>
          <MarcaSertania tamanho={34} />
          <span><strong>{nomeSistema}</strong><small>Área da equipe</small></span>
        </a>
        <div className="faixa-cordel" aria-hidden="true" />
        <button className="ct-fechar icone-botao" aria-label="Fechar menu" onClick={() => setGaveta(false)}><X size={20} /></button>
        <nav className="ct-nav">
          {MENU.map((s) => {
            const itens = s.itens.filter(visivel);
            if (!itens.length) return null;
            return (
              <div key={s.rotulo || 'inicio'} className="ct-secao">
                {s.rotulo && <span className="ct-rotulo">{s.rotulo}</span>}
                {itens.map((i) => (
                  <a key={i.href} href={`#${i.href}`} className="ct-item" aria-current={ativo(i.href) ? 'page' : undefined} title={estreito ? i.rotulo : undefined}>
                    <i.icone size={19} aria-hidden="true" /><span>{i.rotulo}</span>
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <button className="ct-item ct-encolher" onClick={alternarEstreito} title={estreito ? 'Alargar menu' : 'Estreitar menu'}>
          {estreito ? <PanelLeftOpen size={19} aria-hidden="true" /> : <PanelLeftClose size={19} aria-hidden="true" />}<span>{estreito ? 'Alargar menu' : 'Estreitar menu'}</span>
        </button>
        <div className="ct-rodape"><span>{instalacao?.parametros.orgao}</span><code>v{instalacao?.versao ?? '—'}</code></div>
      </aside>
      {gaveta && <div className="veu" onClick={() => setGaveta(false)} aria-hidden="true" />}

      <div className="casca-corpo">
        <header className="barra-tela">
          <button className="icone-botao so-celular" aria-label="Abrir menu" onClick={() => setGaveta(true)}><Menu size={20} /></button>
          <div className="bt-titulo">
            {trilha && <span className="bt-trilha">{trilha}</span>}
            <strong>{titulo}</strong>
          </div>
          <div className="bt-acoes">
            <span className="carimbo-lotacao" title={`${PAPEL_TEXTO[usuario.papel]}${setor ? ' · ' + setor : ''}`}>
              <span className="cl-sigla">{sigla ?? 'PMS'}</span>
              <span className="cl-texto">{setor ?? (ESCOPO_PAPEL[usuario.papel] === 'MUNICIPIO' ? 'Município todo' : 'Secretaria')}</span>
            </span>
            <button className="icone-botao" aria-label="Acessibilidade: letras, contraste, voz e Libras" title="Acessibilidade (Alt + 3)" aria-haspopup="dialog" onClick={abrirPainelAcessibilidade}><Accessibility size={18} /></button>
            <button className="icone-botao" aria-label={escuro ? 'Usar tema de dia' : 'Usar tema de noite'} title={escuro ? 'Tema de dia' : 'Tema de noite'} onClick={() => alternar('theme', escuro ? 'light' : 'dark')}>
              {escuro ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="botao-guia" aria-expanded={guia} aria-label="Guia desta tela" title="Guia desta tela" onClick={() => setGuia(!guia)}>?</button>
            <div className="ancora" ref={refConta}>
              <button className="avatar" aria-label={`Conta de ${usuario.nome}`} aria-expanded={conta} onClick={() => setConta(!conta)}>{iniciais(usuario.nome)}</button>
              {conta && (
                <div className="cartela" role="menu">
                  <div className="cartela-pessoa"><span className="avatar">{iniciais(usuario.nome)}</span><span><strong>{usuario.nome}</strong><small>{PAPEL_TEXTO[usuario.papel]}</small></span></div>
                  <button role="menuitem" onClick={() => ir('/config?secao=perfil')}><UserRound size={16} /> Meus dados</button>
                  <button role="menuitem" onClick={() => ir('/config?secao=seguranca')}><KeyRound size={16} /> Trocar minha senha</button>
                  <button role="menuitem" onClick={() => void sair()} className="sair"><LogOut size={16} /> Sair do sistema</button>
                </div>
              )}
            </div>
          </div>
        </header>
        {children}
      </div>

      {guia && (
        <aside className="guia-tela" aria-label={`Guia: ${tituloGuia}`}>
          <div className="faixa-cordel" aria-hidden="true" />
          <div className="guia-corpo">
            <div className="linha entre"><h2>Guia: {tituloGuia}</h2><button className="icone-botao" aria-label="Fechar guia" onClick={() => setGuia(false)}><X size={18} /></button></div>
            <ol>{passos.map((d) => <li key={d}>{d}</li>)}</ol>
            <p className="pequeno mudo">
              Dúvida que o guia não resolve? Procure a administração do sistema
              {instalacao?.parametros.emailContato ? <>: <a href={`mailto:${instalacao.parametros.emailContato}`}>{instalacao.parametros.emailContato}</a></> : ''}
              {instalacao?.parametros.telefoneContato ? <> · {instalacao.parametros.telefoneContato}</> : ''}.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
