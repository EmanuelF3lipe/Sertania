import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Check, ClipboardList, Database, Eye, EyeOff, FileClock, Glasses, KeyRound, Landmark, LockKeyhole, MapPin, Minus, Pencil, Plug,
  BellRing, RotateCcw, Search, ShieldAlert, ShieldCheck, Sparkles, UserPlus, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import {
  ESCOPO_PAPEL, ESCOPO_TEXTO, PAPEIS, PAPEL_TEXTO, PERMISSAO_INFO, TODAS_PERMISSOES, type Papel, type Permissao, type UsuarioSessao,
} from '../../shared/dominio';
import { api, fmtData, post } from '../api';
import { get } from '../api';
import { abrirPainelAcessibilidade } from '../acessibilidade/painel';
import { ir, useDados, useEstado, usePreferencias, useRota, type Parametros } from '../nucleo';
import { Aviso, Carregando, Copiar } from '../componentes/comuns';
import { iniciais } from '../componentes/casca';
import { AvisosMensagens } from './avisos';
import { Auditoria, CatalogoAdmin, Dados, Diagnostico, Integracao, Localidades, PrimeirosPassos, Privacidade } from './admin';

type Secao = 'perfil' | 'seguranca' | 'leitura' | 'orgao' | 'estrutura' | 'localidades' | 'diagnostico' | 'equipe' | 'permissoes' | 'auditoria' | 'dados' | 'integracao' | 'ia' | 'avisos' | 'privacidade';
interface ItemIndice { id: Secao; rotulo: string; icone: LucideIcon; perm?: Permissao; resumo: string }
const INDICE: Array<{ grupo: string; itens: ItemIndice[] }> = [
  {
    grupo: 'Você', itens: [
      { id: 'perfil', rotulo: 'Meus dados', icone: UserRound, resumo: 'Nome, telefone e como você aparece para a equipe.' },
      { id: 'seguranca', rotulo: 'Senha e acesso', icone: ShieldCheck, resumo: 'Troque sua senha. As outras sessões abertas são encerradas.' },
      { id: 'leitura', rotulo: 'Leitura', icone: Glasses, resumo: 'Tema, tamanho das letras, contraste e animações neste aparelho.' },
    ],
  },
  {
    grupo: 'Prefeitura', itens: [
      { id: 'orgao', rotulo: 'Órgão', icone: Landmark, perm: 'admin.usuarios', resumo: 'Como o sistema se apresenta ao cidadão e à equipe.' },
      { id: 'estrutura', rotulo: 'Secretarias e serviços', icone: Building2, perm: 'admin.catalogo', resumo: 'Quem atende o quê, com prazo e palavras-chave para a IA.' },
      { id: 'localidades', rotulo: 'Localidades e feriados', icone: MapPin, perm: 'admin.catalogo', resumo: 'Sede, distritos, comunidades rurais e os dias que não contam prazo.' },
      { id: 'diagnostico', rotulo: 'Linha de base', icone: ClipboardList, perm: 'admin.diagnostico', resumo: 'Os números reais de antes do sistema, com fonte e validação.' },
    ],
  },
  {
    grupo: 'Pessoas e acesso', itens: [
      { id: 'equipe', rotulo: 'Equipe', icone: Users, perm: 'admin.usuarios', resumo: 'Servidores com acesso, lotação e pedidos de nova senha.' },
      { id: 'permissoes', rotulo: 'Quem pode o quê', icone: KeyRound, perm: 'admin.usuarios', resumo: 'A matriz de permissões de todos os perfis, lado a lado.' },
    ],
  },
  {
    grupo: 'Dados e conformidade', itens: [
      { id: 'auditoria', rotulo: 'Auditoria', icone: FileClock, perm: 'auditoria.ver', resumo: 'O registro encadeado de cada ação feita no sistema.' },
      { id: 'dados', rotulo: 'Backup e exportação', icone: Database, perm: 'admin.backup', resumo: 'Cópias de segurança e todos os dados em formato aberto.' },
      { id: 'integracao', rotulo: 'Integrações', icone: Plug, perm: 'admin.integracao', resumo: 'Chaves para outros sistemas usarem a API, sem dados pessoais.' },
      { id: 'avisos', rotulo: 'Avisos e mensagens', icone: BellRing, perm: 'admin.integracao', resumo: 'WhatsApp, SMS e e-mail ao cidadão, pesquisa de satisfação e relatório mensal.' },
      { id: 'ia', rotulo: 'Consumo da IA', icone: Sparkles, perm: 'admin.integracao', resumo: 'Tokens gastos com a IA externa (Claude) e o limite mensal.' },
      { id: 'privacidade', rotulo: 'Privacidade', icone: LockKeyhole, perm: 'admin.privacidade', resumo: 'Retenção, anonimização e direitos do titular (LGPD).' },
    ],
  },
];
const ANTIGAS: Record<string, Secao> = { geral: 'perfil', perfis: 'permissoes' };

export function Configuracoes() {
  const { pode } = useEstado();
  const { query } = useRota();
  const indice = INDICE.map((g) => ({ ...g, itens: g.itens.filter((i) => !i.perm || pode(i.perm)) })).filter((g) => g.itens.length);
  const todos = indice.flatMap((g) => g.itens);
  const pedido = (query.get('secao') ?? query.get('aba') ?? '') as string;
  const atual = todos.find((i) => i.id === (ANTIGAS[pedido] ?? pedido)) ?? todos[0]!;
  return (
    <div className="config">
      <nav className="config-indice" aria-label="Seções das configurações">
        {indice.map((g) => (
          <div key={g.grupo}>
            <span className="ci-grupo">{g.grupo}</span>
            {g.itens.map((i) => (
              <a key={i.id} href={`#/config?secao=${i.id}`} aria-current={atual.id === i.id ? 'page' : undefined}><i.icone size={17} aria-hidden="true" /> {i.rotulo}</a>
            ))}
          </div>
        ))}
      </nav>
      <div className="config-painel">
        <header className="config-cab">
          <span className="config-ic"><atual.icone size={22} aria-hidden="true" /></span>
          <div><h1>{atual.rotulo}</h1><p className="sec">{atual.resumo}</p></div>
        </header>
        {atual.id === 'perfil' && <MeusDados />}
        {atual.id === 'seguranca' && <Seguranca />}
        {atual.id === 'leitura' && <Leitura />}
        {atual.id === 'orgao' && <Orgao />}
        {atual.id === 'estrutura' && <CatalogoAdmin />}
        {atual.id === 'localidades' && <Localidades />}
        {atual.id === 'diagnostico' && <Diagnostico />}
        {atual.id === 'equipe' && <Equipe />}
        {atual.id === 'permissoes' && <QuemPodeOQue />}
        {atual.id === 'auditoria' && <Auditoria />}
        {atual.id === 'dados' && <Dados />}
        {atual.id === 'integracao' && <Integracao />}
        {atual.id === 'ia' && <ConsumoIa />}
        {atual.id === 'avisos' && <AvisosMensagens />}
        {atual.id === 'privacidade' && <Privacidade />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ apoio
function Janela({ titulo, aoFechar, children, rodape }: { titulo: string; aoFechar: () => void; children: ReactNode; rodape: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [aoFechar]);
  return (
    <div className="janela-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="janela" role="dialog" aria-modal="true" aria-labelledby="janela-titulo">
        <div className="faixa-cordel" aria-hidden="true" />
        <div className="janela-cab"><h2 id="janela-titulo">{titulo}</h2><button className="icone-botao" aria-label="Fechar" onClick={aoFechar}><X size={18} /></button></div>
        <div className="janela-corpo">{children}</div>
        <div className="janela-rodape">{rodape}</div>
      </div>
    </div>
  );
}

/** Gaveta lateral para formularios longos (cadastro e edicao de servidor). */
function Gaveta({ titulo, aoFechar, children, rodape }: { titulo: string; aoFechar: () => void; children: ReactNode; rodape: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [aoFechar]);
  return (
    <div className="gaveta-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <aside className="gaveta" role="dialog" aria-modal="true" aria-labelledby="gaveta-titulo">
        <div className="gaveta-cab"><h2 id="gaveta-titulo">{titulo}</h2><button className="icone-botao" aria-label="Fechar" onClick={aoFechar}><X size={18} /></button></div>
        <div className="gaveta-corpo">{children}</div>
        <div className="gaveta-rodape">{rodape}</div>
      </aside>
    </div>
  );
}

function SenhaVisivel({ id, valor, aoMudar, placeholder, auto = 'new-password' }: { id: string; valor: string; aoMudar: (v: string) => void; placeholder?: string; auto?: string }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="com-icone">
      <LockKeyhole size={16} aria-hidden="true" />
      <input id={id} type={ver ? 'text' : 'password'} value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={placeholder} autoComplete={auto} />
      <button type="button" className="olho" onClick={() => setVer(!ver)} aria-label={ver ? 'Esconder a senha' : 'Ver a senha'}>{ver ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
  );
}

type Msg = { t: 'ok' | 'erro'; m: string } | null;

// ------------------------------------------------------------------ Voce
function MeusDados() {
  const { usuario, definirUsuario, pode } = useEstado();
  const perfil = useDados<{ nome: string; email: string; telefone: string | null; ultimoAcessoEm: string | null; criadoEm: string }>('/auth/perfil');
  const [f, setF] = useState({ nome: '', telefone: '' });
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { if (perfil.dados) setF({ nome: perfil.dados.nome, telefone: perfil.dados.telefone ?? '' }); }, [perfil.dados]);
  if (!usuario) return null;
  const salvar = async () => {
    setMsg(null);
    try {
      const r = await api<{ usuario: UsuarioSessao }>('PUT', '/auth/perfil', f);
      definirUsuario(r.usuario);
      setMsg({ t: 'ok', m: 'Salvo.' });
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };
  return (
    <div className="coluna" style={{ gap: 16 }}>
      {pode('admin.usuarios') && <PrimeirosPassos />}
      <div className="config-duas">
        <div className="cartao">
          <div className="campo"><label htmlFor="g-n">Nome completo</label><input id="g-n" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" /></div>
          <div className="campo"><label htmlFor="g-t">Telefone</label><input id="g-t" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} inputMode="tel" /></div>
          <div className="campo"><label htmlFor="g-e">E-mail de acesso</label><input id="g-e" value={usuario.email} disabled /><div className="ajuda">Para mudar o e-mail, fale com a administração.</div></div>
          {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
          <button className="botao" onClick={() => void salvar()}>Salvar meus dados</button>
        </div>
        <div className="cracha cracha-grande">
          <div className={`cracha-faixa papel-${usuario.papel}`} />
          <span className="avatar">{iniciais(usuario.nome)}</span>
          <strong>{f.nome || usuario.nome}</strong>
          <span className="pequeno">{PAPEL_TEXTO[usuario.papel]}</span>
          <span className="pequeno mudo">{ESCOPO_TEXTO[ESCOPO_PAPEL[usuario.papel]]}</span>
          <span className="pequeno mudo">{perfil.dados?.ultimoAcessoEm ? `Entrou por último em ${fmtData(perfil.dados.ultimoAcessoEm)}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

function Seguranca() {
  const { usuario, definirUsuario } = useEstado();
  const [s, setS] = useState({ atual: '', nova: '', confirma: '' });
  const [msg, setMsg] = useState<Msg>(null);
  if (!usuario) return null;
  const trocar = async () => {
    setMsg(null);
    if (s.nova !== s.confirma) return setMsg({ t: 'erro', m: 'A nova senha e a repetição estão diferentes.' });
    try {
      const r = await post<{ csrf: string; usuario: UsuarioSessao }>('/auth/trocar-senha', { atual: s.atual, nova: s.nova });
      definirUsuario(r.usuario, r.csrf);
      setS({ atual: '', nova: '', confirma: '' });
      setMsg({ t: 'ok', m: 'Senha trocada. Se sua conta estava aberta em outro aparelho, ela foi desconectada lá.' });
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };
  const forca = !s.nova ? 0 : (s.nova.length >= 8 ? 1 : 0) + (/[a-zA-Z]/.test(s.nova) && /\d/.test(s.nova) ? 1 : 0) + (s.nova.length >= 12 || /[^a-zA-Z0-9]/.test(s.nova) ? 1 : 0);
  return (
    <form className="cartao" style={{ maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); void trocar(); }}>
      <input type="email" value={usuario.email} autoComplete="username" readOnly hidden />
      <div className="campo"><label htmlFor="g-sa">Senha atual</label><SenhaVisivel id="g-sa" valor={s.atual} aoMudar={(v) => setS({ ...s, atual: v })} auto="current-password" /></div>
      <div className="campo">
        <label htmlFor="g-sn">Nova senha</label><SenhaVisivel id="g-sn" valor={s.nova} aoMudar={(v) => setS({ ...s, nova: v })} />
        <div className="forca" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={forca >= n ? `f${forca}` : ''} />)}</div>
        <div className="ajuda">Pelo menos 8 caracteres, com letras e números. Frases longas são ainda melhores.</div>
      </div>
      <div className="campo"><label htmlFor="g-sc">Repita a nova senha</label><SenhaVisivel id="g-sc" valor={s.confirma} aoMudar={(v) => setS({ ...s, confirma: v })} /></div>
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      <button className="botao">Trocar senha</button>
    </form>
  );
}

function Leitura() {
  const { p, alternar } = usePreferencias();
  const opcoes = [
    ['theme', 'dark', 'Tema de noite', 'Fundo escuro, bom para pouca luz.'],
    ['texto', 'grande', 'Letras maiores', 'Aumenta todo o texto do sistema.'],
    ['contraste', 'alto', 'Contraste forte', 'Preto e branco puros, para baixa visão.'],
    ['movimento', 'reduzido', 'Sem animações', 'Desliga transições e movimentos.'],
  ] as const;
  return (
    <div className="opcoes-leitura">
      {opcoes.map(([k, v, r, d]) => (
        <label key={k} className={`opcao${p[k] === v ? ' ligada' : ''}`}>
          <input type="checkbox" role="switch" checked={p[k] === v} onChange={() => alternar(k, v)} />
          <span><strong>{r}</strong><small>{d}</small></span>
        </label>
      ))}
      <button type="button" className="botao sec" onClick={abrirPainelAcessibilidade}>Mais opções: leitura em voz alta, Libras, ditado e comandos de voz</button>
    </div>
  );
}

// ------------------------------------------------------------------ Prefeitura
// ------------------------------------------------------------------ consumo da IA
interface SomaIa { chamadas: number; falhas: number; entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number }
interface ResumoIa {
  provedor: 'local' | 'claude'; modelo: string; mes: string; limite: number; usado: number; atingido: boolean;
  doMes: SomaIa; porOperacao: Array<SomaIa & { operacao: string; rotulo: string }>; meses: Array<SomaIa & { mes: string }>;
  ultimas: Array<{ criadoEm: string; operacao: string; modelo: string; entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; ok: boolean; erro: string | null; demandaId: number | null }>;
}
const num = (n: number) => n.toLocaleString('pt-BR');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)}/${m.slice(0, 4)}`;
const SUGESTOES_LIMITE = [0, 500_000, 2_000_000, 10_000_000];

function ConsumoIa() {
  const { dados, erro, recarregar } = useDados<ResumoIa>('/admin/ia');
  const [limite, setLimite] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { if (dados) setLimite(String(dados.limite)); }, [dados]);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return <Carregando />;
  const pct = dados.limite > 0 ? Math.min(100, Math.round((dados.usado / dados.limite) * 100)) : 0;
  const maiorMes = Math.max(1, ...dados.meses.map((m) => m.total));
  const salvar = async () => {
    setMsg(null);
    const n = Number(limite.replace(/\D/g, '') || 0);
    try {
      await api('PUT', '/admin/ia', { limiteTokensMes: n });
      setMsg({ t: 'ok', m: n ? `Limite salvo: ${num(n)} tokens por mês.` : 'Sem limite mensal.' });
      recarregar();
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };
  return (
    <>
      <div className="cartao ia-provedor">
        <span className={`ia-selo ${dados.provedor}`}><Sparkles size={16} aria-hidden="true" /> {dados.provedor === 'claude' ? 'Claude (Anthropic)' : 'IA local'}</span>
        {dados.provedor === 'claude'
          ? <p>As sugestões de triagem e as narrativas de relatório usam o modelo <code>{dados.modelo}</code>. Antes do envio, CPF, telefone, e-mail e nome do solicitante são trocados por marcadores. Se a API falhar ou o limite for atingido, a IA local assume sozinha.</p>
          : <p>A IA roda no próprio servidor: não há custo nem envio de dados. O consumo abaixo só aumenta com <code>IA_PROVEDOR=claude</code> e <code>ANTHROPIC_API_KEY</code> no arquivo <code>.env</code>.</p>}
      </div>

      <div className="cartao">
        <h2 className="ia-tit">Este mês ({nomeMes(dados.mes)})</h2>
        {dados.limite > 0 ? (
          <div className="ia-medidor" role="meter" aria-valuemin={0} aria-valuemax={dados.limite} aria-valuenow={dados.usado} aria-label="Tokens usados no mês">
            <div className={`ia-barra${pct >= 100 ? ' cheia' : pct >= 80 ? ' alta' : ''}`} style={{ width: `${Math.max(pct, dados.usado ? 1 : 0)}%` }} />
            <span>{num(dados.usado)} de {num(dados.limite)} tokens ({pct}%)</span>
          </div>
        ) : <p className="sec">{num(dados.usado)} tokens usados. Nenhum limite mensal definido.</p>}
        {dados.atingido && <Aviso tipo="alerta">O limite do mês foi atingido: até o próximo mês (ou até você ampliar o limite), as sugestões usam a IA local.</Aviso>}
        {!dados.atingido && pct >= 80 && <Aviso tipo="alerta">Já foram usados {pct}% do limite do mês.</Aviso>}
        <div className="ia-numeros">
          <div><strong>{num(dados.doMes.chamadas)}</strong><span>chamadas</span></div>
          <div><strong>{num(dados.doMes.entrada)}</strong><span>tokens de entrada</span></div>
          <div><strong>{num(dados.doMes.saida)}</strong><span>tokens de saída</span></div>
          <div><strong>{num(dados.doMes.cacheLeitura + dados.doMes.cacheEscrita)}</strong><span>tokens de cache</span></div>
          <div><strong>{num(dados.doMes.falhas)}</strong><span>falhas (IA local assumiu)</span></div>
        </div>
        {dados.porOperacao.length > 0 && (
          <table className="ia-tabela">
            <thead><tr><th>Uso</th><th>Chamadas</th><th>Entrada</th><th>Saída</th><th>Total</th></tr></thead>
            <tbody>{dados.porOperacao.map((o) => <tr key={o.operacao}><td>{o.rotulo}</td><td>{num(o.chamadas)}</td><td>{num(o.entrada)}</td><td>{num(o.saida)}</td><td><strong>{num(o.total)}</strong></td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="config-duas">
        <div className="cartao">
          <h2 className="ia-tit">Limite mensal</h2>
          <p className="sec">Quando o total do mês chega ao limite, o sistema para de chamar o Claude e usa a IA local até o mês virar. Use 0 para não ter limite.</p>
          <div className="campo">
            <label htmlFor="ia-limite">Tokens por mês</label>
            <input id="ia-limite" inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value.replace(/\D/g, ''))} />
            <div className="ia-sugestoes">{SUGESTOES_LIMITE.map((v) => <button key={v} type="button" className="botao sec" onClick={() => setLimite(String(v))}>{v ? num(v) : 'Sem limite'}</button>)}</div>
            <div className="ajuda">Para estimar o custo, multiplique os tokens pelo preço do modelo na tabela da Anthropic. A mudança fica na auditoria.</div>
          </div>
          {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
          <button className="botao" onClick={() => void salvar()}>Salvar limite</button>
        </div>
        <div className="cartao">
          <h2 className="ia-tit">Últimos meses</h2>
          {dados.meses.length === 0 ? <p className="sec">Nenhuma chamada ao Claude registrada ainda.</p> : (
            <ul className="ia-meses">
              {dados.meses.map((m) => (
                <li key={m.mes}><span>{nomeMes(m.mes)}</span><div><i style={{ width: `${Math.round((m.total / maiorMes) * 100)}%` }} /></div><strong>{num(m.total)}</strong></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="cartao">
        <h2 className="ia-tit">Últimas chamadas</h2>
        {dados.ultimas.length === 0 ? <p className="sec">Nenhuma chamada registrada.</p> : (
          <div className="ia-rolagem">
            <table className="ia-tabela">
              <thead><tr><th>Quando</th><th>Uso</th><th>Entrada</th><th>Saída</th><th>Cache</th><th>Resultado</th></tr></thead>
              <tbody>{dados.ultimas.map((u, i) => (
                <tr key={i}><td>{fmtData(u.criadoEm)}</td><td>{u.operacao === 'TRIAGEM' ? 'Triagem' : 'Narrativa'}{u.demandaId ? `, nº ${u.demandaId}` : ''}</td><td>{num(u.entrada)}</td><td>{num(u.saida)}</td><td>{num(u.cacheLeitura + u.cacheEscrita)}</td><td>{u.ok ? 'ok' : <span title={u.erro ?? ''}>falhou, IA local assumiu</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Orgao() {
  const { recarregarInstalacao } = useEstado();
  const { dados, recarregar } = useDados<Parametros>('/admin/parametros');
  const [f, setF] = useState<Parametros | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { if (dados) setF(dados); }, [dados]);
  if (!f) return <Carregando />;
  const campo = (k: keyof Parametros, rotulo: string, ajuda?: string, ph?: string) => (
    <div className="campo"><label htmlFor={`o-${k}`}>{rotulo}</label><input id={`o-${k}`} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} />{ajuda && <div className="ajuda">{ajuda}</div>}</div>
  );
  const salvar = async () => {
    setMsg(null);
    try {
      await api('PUT', '/admin/parametros', f);
      setMsg({ t: 'ok', m: 'Salvo. O portal e a área da equipe já mostram os novos dados.' });
      recarregar(); recarregarInstalacao();
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };
  return (
    <div className="cartao">
      <div className="config-duas" style={{ gap: '0 20px' }}>
        {campo('nomeSistema', 'Nome do sistema', 'Aparece no topo, na entrada e no comprovante.')}
        {campo('orgao', 'Órgão', undefined, 'Prefeitura Municipal de …')}
        {campo('emailContato', 'E-mail de contato', 'Mostrado no guia das telas e na recuperação de senha.', 'atendimento@…')}
        {campo('telefoneContato', 'Telefone ou WhatsApp')}
        {campo('enderecoAtendimento', 'Onde é o atendimento presencial')}
        {campo('horarioAtendimento', 'Horário de atendimento', undefined, 'seg. a sex., 8h às 14h')}
      </div>
      <div className="campo"><label htmlFor="o-aviso">Recado na página do cidadão (opcional)</label><textarea id="o-aviso" style={{ minHeight: 60 }} value={f.avisoInicio} onChange={(e) => setF({ ...f, avisoInicio: e.target.value })} placeholder="Ex.: mutirão de iluminação na zona rural nesta semana." /></div>
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      <button className="botao" onClick={() => void salvar()}>Salvar</button>
    </div>
  );
}

// ------------------------------------------------------------------ Equipe (crachas)
interface Membro {
  id: number; nome: string; email: string; telefone: string | null; papel: Papel; secretariaId: number | null; setorId: number | null; ativo: number;
  secretaria: string | null; setor: string | null; ultimoAcessoEm: string | null; pediuSenhaEm: string | null; deveTrocarSenha: number;
}
const PAPEIS_EQUIPE = PAPEIS.filter((p) => p !== 'CIDADAO');
export const PAPEL_CURTO: Record<Papel, string> = {
  CIDADAO: 'Cidadão', ATENDENTE: 'Atendimento', CAMPO: 'Campo', GESTOR_SETOR: 'Gestão de setor', GESTOR_SECRETARIA: 'Gestão de secretaria', ADMIN_SAD: 'Administração', AUDITOR: 'Auditoria',
};
type FormMembro = { id: number; nome: string; email: string; telefone: string; papel: Papel; secretariaId: string; setorId: string; ativo: boolean; senha: string; gerar: boolean; exigirTroca: boolean };

function CamposLotacao({ f, mudar }: { f: FormMembro; mudar: (p: Partial<FormMembro>) => void }) {
  const { catalogo } = useEstado();
  if (!catalogo) return null;
  const precisaSetor = ['CAMPO', 'GESTOR_SETOR'].includes(f.papel);
  return (
    <fieldset className="grupo-campos">
      <legend>Função e lotação</legend>
      <div className="campo"><label htmlFor="m-p">Perfil</label><select id="m-p" value={f.papel} onChange={(e) => mudar({ papel: e.target.value as Papel })}>{PAPEIS_EQUIPE.map((p) => <option key={p} value={p}>{PAPEL_TEXTO[p]}</option>)}</select>
        <div className="ajuda">Enxerga: {(ESCOPO_TEXTO[ESCOPO_PAPEL[f.papel]] ?? "").toLowerCase()}.</div></div>
      <div className="campo"><label htmlFor="m-s">Secretaria{f.papel === 'GESTOR_SECRETARIA' ? ' (obrigatória)' : ''}</label><select id="m-s" value={f.secretariaId} onChange={(e) => mudar({ secretariaId: e.target.value, setorId: '' })}><option value="">Nenhuma</option>{catalogo.secretarias.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
      <div className="campo"><label htmlFor="m-st">Setor{precisaSetor ? ' (obrigatório)' : ''}</label><select id="m-st" value={f.setorId} onChange={(e) => mudar({ setorId: e.target.value })}><option value="">Nenhum</option>{catalogo.setores.filter((s) => !f.secretariaId || s.secretariaId === Number(f.secretariaId)).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
    </fieldset>
  );
}

function Equipe() {
  const { usuario } = useEstado();
  const { dados, recarregar } = useDados<Membro[]>('/admin/usuarios');
  const vazio: FormMembro = { id: 0, nome: '', email: '', telefone: '', papel: 'ATENDENTE', secretariaId: '', setorId: '', ativo: true, senha: '', gerar: true, exigirTroca: true };
  const [form, setForm] = useState<FormMembro | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busca, setBusca] = useState('');
  const [papel, setPapel] = useState('');
  const [inativos, setInativos] = useState(false);
  const [entregar, setEntregar] = useState<{ nome: string; senha: string } | null>(null);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (dados ?? []).filter((m) => (inativos || m.ativo) && (!papel || m.papel === papel)
      && (!b || `${m.nome} ${m.email} ${m.telefone ?? ''} ${m.secretaria ?? ''} ${m.setor ?? ''}`.toLowerCase().includes(b)));
  }, [dados, busca, papel, inativos]);
  if (!dados) return <Carregando />;
  const pedidos = dados.filter((m) => m.pediuSenhaEm && m.ativo);

  const corpo = (f: FormMembro) => ({
    nome: f.nome, email: f.email, telefone: f.telefone || null, papel: f.papel, ativo: f.ativo,
    secretariaId: f.secretariaId ? Number(f.secretariaId) : null, setorId: f.setorId ? Number(f.setorId) : null,
  });
  const salvar = async () => {
    if (!form) return;
    setErroForm(null);
    try {
      if (form.id) {
        await api('PUT', `/admin/usuarios/${form.id}`, corpo(form));
        setMsg({ t: 'ok', m: `Dados de ${form.nome} atualizados.` });
      } else {
        const r = await post<{ senhaProvisoria: string | null }>('/admin/usuarios', { ...corpo(form), senha: form.gerar ? undefined : form.senha, exigirTroca: form.gerar || form.exigirTroca });
        if (r.senhaProvisoria) setEntregar({ nome: form.nome, senha: r.senhaProvisoria });
        else setMsg({ t: 'ok', m: `${form.nome} já pode entrar.` });
      }
      setForm(null); recarregar();
    } catch (e) { setErroForm((e as Error).message); }
  };
  const novaSenha = async (m: { id: number; nome: string }) => {
    if (!confirm(`Gerar uma senha provisória para ${m.nome}? A senha atual para de funcionar e a pessoa é desconectada.`)) return;
    try {
      const r = await post<{ senhaProvisoria: string }>(`/admin/usuarios/${m.id}/senha-provisoria`);
      setEntregar({ nome: m.nome, senha: r.senhaProvisoria });
      setForm(null); recarregar();
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };

  return (
    <div className="coluna" style={{ gap: 16 }}>
      {pedidos.length > 0 && (
        <section className="pedidos-senha">
          <h2><KeyRound size={18} aria-hidden="true" /> Pedidos de nova senha</h2>
          <ul>{pedidos.map((p) => (
            <li key={p.id}><span><strong>{p.nome}</strong> <span className="mudo pequeno">pediu em {fmtData(p.pediuSenhaEm)}</span></span><button className="botao peq" onClick={() => void novaSenha(p)}>Gerar senha</button></li>
          ))}</ul>
        </section>
      )}

      <div className="equipe-barra">
        <div className="com-icone busca"><Search size={16} aria-hidden="true" /><input aria-label="Procurar na equipe" placeholder="Procurar por nome, e-mail, telefone ou setor" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <select aria-label="Filtrar por perfil" value={papel} onChange={(e) => setPapel(e.target.value)}><option value="">Todos os perfis</option>{PAPEIS_EQUIPE.map((p) => <option key={p} value={p}>{PAPEL_CURTO[p]}</option>)}</select>
        <label className="check pequeno"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /><span>Incluir desligados</span></label>
        <button className="botao direita" onClick={() => { setErroForm(null); setForm(vazio); }}><UserPlus size={17} /> Cadastrar servidor</button>
      </div>
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      <p className="pequeno mudo" style={{ margin: 0 }}>{lista.length} {lista.length === 1 ? 'pessoa' : 'pessoas'}</p>

      <ul className="crachas">
        {lista.map((m) => (
          <li key={m.id} className={`cracha${m.ativo ? '' : ' desligado'}`}>
            <div className={`cracha-faixa papel-${m.papel}`}><span>{PAPEL_CURTO[m.papel]}</span></div>
            <span className="avatar">{iniciais(m.nome)}</span>
            <strong>{m.nome}{m.id === usuario?.id && <span className="mudo"> (você)</span>}</strong>
            <span className="pequeno mudo cracha-email">{m.email}</span>
            <span className="pequeno">{[m.secretaria, m.setor].filter(Boolean).join(' › ') || 'Município inteiro'}</span>
            <div className="cracha-selos">
              {!m.ativo && <span className="etq">Desligado</span>}
              {m.ativo && m.pediuSenhaEm && <span className="etq etq-alerta">Pediu senha</span>}
              {m.ativo && !m.pediuSenhaEm && m.deveTrocarSenha === 1 && <span className="etq">Senha provisória</span>}
              <span className="pequeno mudo">{m.ultimoAcessoEm ? `Entrou ${fmtData(m.ultimoAcessoEm)}` : 'Ainda não entrou'}</span>
            </div>
            <div className="cracha-acoes">
              <button className="botao sec peq" onClick={() => { setErroForm(null); setForm({ ...vazio, id: m.id, nome: m.nome, email: m.email, telefone: m.telefone ?? '', papel: m.papel, secretariaId: String(m.secretariaId ?? ''), setorId: String(m.setorId ?? ''), ativo: !!m.ativo }); }}><Pencil size={15} /> Editar</button>
              {m.id !== usuario?.id && <button className="botao sec peq" onClick={() => void novaSenha(m)}><KeyRound size={15} /> Nova senha</button>}
            </div>
          </li>
        ))}
        {lista.length === 0 && <li className="vazio">Ninguém encontrado com esse filtro.</li>}
      </ul>

      {form && (
        <Gaveta titulo={form.id ? `Editar ${form.nome.split(' ')[0]}` : 'Cadastrar servidor'} aoFechar={() => setForm(null)}
          rodape={<><button className="botao sec" onClick={() => setForm(null)}>Cancelar</button><button className="botao" onClick={() => void salvar()}>{form.id ? 'Salvar' : 'Cadastrar'}</button></>}>
          <fieldset className="grupo-campos">
            <legend>Quem é</legend>
            <div className="campo"><label htmlFor="f-n">Nome completo</label><input id="f-n" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="campo"><label htmlFor="f-e">E-mail institucional (é o login)</label><input id="f-e" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nome@sertania.pe.gov.br" /></div>
            <div className="campo"><label htmlFor="f-t">Telefone (opcional)</label><input id="f-t" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} inputMode="tel" /></div>
          </fieldset>
          <CamposLotacao f={form} mudar={(p) => setForm({ ...form, ...p })} />
          {form.id === 0 ? (
            <fieldset className="grupo-campos">
              <legend>Primeira senha</legend>
              <label className="check campo"><input type="radio" name="senha-modo" checked={form.gerar} onChange={() => setForm({ ...form, gerar: true })} /><span>O sistema cria uma senha provisória<span className="ajuda" style={{ display: 'block' }}>Você entrega à pessoa, que cria a dela no primeiro acesso.</span></span></label>
              <label className="check campo"><input type="radio" name="senha-modo" checked={!form.gerar} onChange={() => setForm({ ...form, gerar: false })} /><span>Eu defino a senha agora</span></label>
              {!form.gerar && (
                <>
                  <div className="campo"><label htmlFor="f-s">Senha</label><SenhaVisivel id="f-s" valor={form.senha} aoMudar={(v) => setForm({ ...form, senha: v })} /></div>
                  <label className="check campo"><input type="checkbox" checked={form.exigirTroca} onChange={(e) => setForm({ ...form, exigirTroca: e.target.checked })} /><span>Obrigar a pessoa a criar uma senha própria ao entrar</span></label>
                </>
              )}
            </fieldset>
          ) : (
            <fieldset className="grupo-campos">
              <legend>Acesso</legend>
              <label className="opcao" style={{ marginBottom: 10 }}><input type="checkbox" role="switch" checked={form.ativo} disabled={form.id === usuario?.id} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /><span><strong>{form.ativo ? 'Pode entrar no sistema' : 'Desligado'}</strong><small>Desligar encerra as sessões abertas e mantém o histórico.</small></span></label>
              {form.id !== usuario?.id && <button className="botao sec peq" onClick={() => void novaSenha({ id: form.id, nome: form.nome })}><KeyRound size={15} /> Gerar senha provisória</button>}
            </fieldset>
          )}
          {erroForm && <Aviso tipo="erro">{erroForm}</Aviso>}
        </Gaveta>
      )}

      {entregar && (
        <Janela titulo="Senha para entregar" aoFechar={() => setEntregar(null)} rodape={<button className="botao" onClick={() => setEntregar(null)}>Já anotei</button>}>
          <p>Entregue a <strong>{entregar.nome}</strong> pessoalmente ou por mensagem direta. No primeiro acesso, o sistema pede uma senha nova.</p>
          <div className="linha"><code className="codigo">{entregar.senha}</code><Copiar texto={entregar.senha} /></div>
          <p className="ajuda">Ela não aparece de novo. Se perder, gere outra.</p>
        </Janela>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Quem pode o que (matriz)
interface PerfilDto { papel: Papel; nome: string; escopo: string; usuarios: number; padrao: Permissao[]; permissoes: Permissao[]; fixas: Permissao[]; personalizado: boolean }
const GRUPOS = [...new Set(Object.values(PERMISSAO_INFO).map((i) => i.grupo))];

function QuemPodeOQue() {
  const { definirUsuario } = useEstado();
  const { dados, recarregar } = useDados<PerfilDto[]>('/admin/perfis');
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, Permissao[]>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [salvando, setSalvando] = useState(false);
  if (!dados) return <Carregando />;

  const atual = (p: PerfilDto) => rascunho[p.papel] ?? p.permissoes;
  const alterados = dados.filter((p) => rascunho[p.papel] && [...rascunho[p.papel]!].sort().join() !== [...p.permissoes].sort().join());
  const alternar = (p: PerfilDto, perm: Permissao) => {
    if (p.fixas.includes(perm)) return;
    const a = atual(p);
    setRascunho({ ...rascunho, [p.papel]: a.includes(perm) ? a.filter((x) => x !== perm) : [...a, perm] });
  };
  const atualizarSessao = async () => {
    const r = await get<{ usuario: UsuarioSessao | null }>('/auth/eu').catch(() => null);
    if (r?.usuario) definirUsuario(r.usuario);
  };
  const salvar = async () => {
    setSalvando(true); setMsg(null);
    try {
      for (const p of alterados) await api('PUT', `/admin/perfis/${p.papel}`, { permissoes: rascunho[p.papel] });
      setMsg({ t: 'ok', m: `${alterados.length} ${alterados.length === 1 ? 'perfil atualizado' : 'perfis atualizados'}. Vale a partir da próxima ação de cada pessoa.` });
      setRascunho({}); setEditando(false); recarregar(); await atualizarSessao();
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); } finally { setSalvando(false); }
  };
  const restaurar = async (p: PerfilDto) => {
    if (!confirm(`Voltar “${PAPEL_CURTO[p.papel]}” às permissões de fábrica?`)) return;
    try { await api('DELETE', `/admin/perfis/${p.papel}`); recarregar(); await atualizarSessao(); } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };
  const sensiveisNovas = alterados.flatMap((p) => (rascunho[p.papel] ?? []).filter((x) => PERMISSAO_INFO[x].sensivel && !p.padrao.includes(x)).map((x) => `${PAPEL_CURTO[p.papel]}: ${PERMISSAO_INFO[x].nome}`));

  return (
    <div className="coluna" style={{ gap: 12 }}>
      <div className="linha entre">
        <p className="sec" style={{ margin: 0, maxWidth: '62ch' }}>Cada coluna é um perfil; cada linha, uma ação. O que cada perfil <em>enxerga</em> (setor, secretaria ou município) não muda aqui.</p>
        {!editando ? (
          <button className="botao" onClick={() => setEditando(true)}><Pencil size={16} /> Editar matriz</button>
        ) : (
          <div className="linha">
            <button className="botao sec" onClick={() => { setRascunho({}); setEditando(false); }}>Descartar</button>
            <button className="botao" disabled={!alterados.length || salvando} onClick={() => void salvar()}>Salvar {alterados.length ? `(${alterados.length})` : ''}</button>
          </div>
        )}
      </div>
      {editando && sensiveisNovas.length > 0 && <Aviso tipo="alerta"><ShieldAlert size={16} aria-hidden="true" /> Você está liberando ações sensíveis fora do padrão: {sensiveisNovas.join('; ')}. Isso fica registrado na auditoria.</Aviso>}
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}

      <div className="matriz-moldura">
        <table className={`matriz${editando ? ' editando' : ''}`}>
          <thead>
            <tr>
              <th scope="col" className="m-acao">Ação</th>
              {dados.map((p) => (
                <th key={p.papel} scope="col">
                  <span className={`m-perfil papel-${p.papel}`}>{PAPEL_CURTO[p.papel]}</span>
                  <span className="m-info">{p.usuarios} {p.usuarios === 1 ? 'pessoa' : 'pessoas'}</span>
                  {p.personalizado && !editando && <button className="link-botao pequeno" onClick={() => void restaurar(p)} title="Voltar ao padrão de fábrica"><RotateCcw size={12} /> padrão</button>}
                </th>
              ))}
            </tr>
          </thead>
          {GRUPOS.map((g) => (
            <tbody key={g}>
              <tr className="m-grupo"><th colSpan={dados.length + 1} scope="colgroup">{g}</th></tr>
              {TODAS_PERMISSOES.filter((perm) => PERMISSAO_INFO[perm].grupo === g).map((perm) => {
                const info = PERMISSAO_INFO[perm];
                return (
                  <tr key={perm}>
                    <th scope="row" className="m-acao">
                      <span className="m-nome">{info.nome}{info.sensivel && <ShieldAlert size={14} className="m-sensivel" aria-label="sensível" />}</span>
                      <span className="m-desc">{info.descricao}</span>
                    </th>
                    {dados.map((p) => {
                      const tem = atual(p).includes(perm);
                      const mudou = tem !== p.padrao.includes(perm);
                      const fixa = p.fixas.includes(perm);
                      return (
                        <td key={p.papel} className={`${mudou ? 'm-mudou' : ''}${tem ? ' m-sim' : ''}`}>
                          {editando ? (
                            <input type="checkbox" checked={tem} disabled={fixa} onChange={() => alternar(p, perm)} aria-label={`${PAPEL_CURTO[p.papel]}: ${info.nome}`} title={fixa ? 'Obrigatória para este perfil' : undefined} />
                          ) : tem ? <Check size={18} aria-label="sim" /> : <Minus size={16} aria-label="não" className="mudo" />}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="ajuda"><ShieldAlert size={13} aria-hidden="true" /> marca ações sensíveis. Células destacadas diferem do padrão de fábrica. A Administração sempre mantém “Equipe e perfis”, para ninguém ficar trancado do lado de fora.</p>
    </div>
  );
}
