import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Check, ClipboardList, Database, Eye, EyeOff, FileClock, Glasses, KeyRound, Landmark, LockKeyhole, MapPin, Minus, Pencil, Plug,
  BellRing, Copy, Plus, Search, ShieldAlert, ShieldCheck, Sparkles, Trash2, UserPlus, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import {
  ESCOPO_CARGO_INFO, ESCOPO_TEXTO, ESCOPOS_CARGO, PERMISSAO_INFO, TODAS_PERMISSOES, type CargoDto, type EscopoCargo, type Permissao, type UsuarioSessao,
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
      { id: 'equipe', rotulo: 'Equipe', icone: Users, perm: 'admin.usuarios', resumo: 'Servidores com acesso, cargo, lotações e pedidos de nova senha.' },
      { id: 'permissoes', rotulo: 'Cargos e permissões', icone: KeyRound, perm: 'admin.usuarios', resumo: 'Crie os cargos da Prefeitura e escolha o que cada um enxerga e pode fazer.' },
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
        {atual.id === 'permissoes' && <CargosPermissoes />}
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
          <div className={`cracha-faixa escopo-${usuario.escopo}`} />
          <span className="avatar">{iniciais(usuario.nome)}</span>
          <strong>{f.nome || usuario.nome}</strong>
          <span className="pequeno">{usuario.cargo}</span>
          <span className="pequeno mudo">{ESCOPO_TEXTO[usuario.escopo]}</span>
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
interface LotacaoMembro { secretariaId: number; setorId: number | null; secretaria: string; setor: string | null }
interface Membro {
  id: number; nome: string; email: string; telefone: string | null; cargoId: number | null; cargo: string | null; escopo: EscopoCargo | null; ativo: number;
  lotacoes: LotacaoMembro[]; ultimoAcessoEm: string | null; pediuSenhaEm: string | null; deveTrocarSenha: number;
}
type FormMembro = {
  id: number; nome: string; email: string; telefone: string; cargoId: string; secretarias: number[]; setores: number[]; origem: string;
  ativo: boolean; senha: string; gerar: boolean; exigirTroca: boolean;
};

const textoLotacao = (m: Membro) => {
  if (m.escopo === 'MUNICIPIO') return 'Município inteiro';
  if (!m.lotacoes.length) return 'Sem lotação';
  return m.lotacoes.map((l) => (l.setor ? `${l.secretaria} › ${l.setor}` : l.secretaria)).join('; ');
};

function Marcar({ marcado, aoMudar, children }: { marcado: boolean; aoMudar: () => void; children: ReactNode }) {
  return <label className="check marcar-item"><input type="checkbox" checked={marcado} onChange={aoMudar} /><span>{children}</span></label>;
}

function CamposLotacao({ f, mudar, cargos }: { f: FormMembro; mudar: (p: Partial<FormMembro>) => void; cargos: CargoDto[] }) {
  const { catalogo } = useEstado();
  if (!catalogo) return null;
  const cargo = cargos.find((c) => c.id === Number(f.cargoId));
  const alternar = (lista: number[], id: number) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  return (
    <fieldset className="grupo-campos">
      <legend>Cargo e lotação</legend>
      <div className="campo"><label htmlFor="m-c">Cargo</label>
        <select id="m-c" value={f.cargoId} onChange={(e) => mudar({ cargoId: e.target.value })}>
          <option value="">Escolha…</option>
          {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {cargo && <div className="ajuda">Alcance: <strong>{ESCOPO_CARGO_INFO[cargo.escopo].nome}</strong>. {ESCOPO_CARGO_INFO[cargo.escopo].descricao} <a href="#/config?secao=permissoes">Ver o que este cargo pode fazer</a></div>}
      </div>
      {cargo?.escopo === 'SETOR' && (
        <div className="campo">
          <span className="rotulo">Setores em que a pessoa trabalha</span>
          <div className="lista-lotacao">
            {catalogo.secretarias.map((s) => {
              const setores = catalogo.setores.filter((st) => st.secretariaId === s.id);
              if (!setores.length) return null;
              return (
                <div key={s.id} className="ll-grupo"><span className="ll-titulo">{s.nome}</span>
                  {setores.map((st) => <Marcar key={st.id} marcado={f.setores.includes(st.id)} aoMudar={() => mudar({ setores: alternar(f.setores, st.id) })}>{st.nome}</Marcar>)}
                </div>
              );
            })}
          </div>
          <div className="ajuda">Marque um ou mais. A pessoa vê as solicitações de todos os setores marcados.</div>
        </div>
      )}
      {cargo?.escopo === 'SECRETARIA' && (
        <div className="campo">
          <span className="rotulo">Secretarias</span>
          <div className="lista-lotacao">
            {catalogo.secretarias.map((s) => <Marcar key={s.id} marcado={f.secretarias.includes(s.id)} aoMudar={() => mudar({ secretarias: alternar(f.secretarias, s.id) })}>{s.nome}</Marcar>)}
          </div>
          <div className="ajuda">Marque uma ou mais. A pessoa vê as solicitações de todas as secretarias marcadas.</div>
        </div>
      )}
      {cargo?.escopo === 'MUNICIPIO' && (
        <div className="campo"><label htmlFor="m-o">Secretaria de origem (opcional)</label>
          <select id="m-o" value={f.origem} onChange={(e) => mudar({ origem: e.target.value })}><option value="">Nenhuma</option>{catalogo.secretarias.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
          <div className="ajuda">Só para identificação: com este cargo a pessoa vê o município inteiro.</div>
        </div>
      )}
    </fieldset>
  );
}

function Equipe() {
  const { usuario, catalogo } = useEstado();
  const { dados, recarregar } = useDados<Membro[]>('/admin/usuarios');
  const cargosApi = useDados<CargoDto[]>('/admin/cargos');
  const cargos = cargosApi.dados ?? [];
  const vazio: FormMembro = { id: 0, nome: '', email: '', telefone: '', cargoId: '', secretarias: [], setores: [], origem: '', ativo: true, senha: '', gerar: true, exigirTroca: true };
  const [form, setForm] = useState<FormMembro | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busca, setBusca] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [inativos, setInativos] = useState(false);
  const [entregar, setEntregar] = useState<{ nome: string; senha: string } | null>(null);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (dados ?? []).filter((m) => (inativos || m.ativo) && (!filtroCargo || String(m.cargoId) === filtroCargo)
      && (!b || `${m.nome} ${m.email} ${m.telefone ?? ''} ${m.cargo ?? ''} ${textoLotacao(m)}`.toLowerCase().includes(b)));
  }, [dados, busca, filtroCargo, inativos]);
  if (!dados || !cargosApi.dados) return <Carregando />;
  const pedidos = dados.filter((m) => m.pediuSenhaEm && m.ativo);

  const corpo = (f: FormMembro) => {
    const cargo = cargos.find((c) => c.id === Number(f.cargoId));
    const lotacoes = !cargo ? []
      : cargo.escopo === 'SETOR' ? f.setores.map((id) => ({ secretariaId: catalogo?.setores.find((s) => s.id === id)?.secretariaId ?? 0, setorId: id }))
        : cargo.escopo === 'SECRETARIA' ? f.secretarias.map((id) => ({ secretariaId: id, setorId: null }))
          : f.origem ? [{ secretariaId: Number(f.origem), setorId: null }] : [];
    return { nome: f.nome, email: f.email, telefone: f.telefone || null, cargoId: Number(f.cargoId), lotacoes, ativo: f.ativo };
  };
  const abrir = (m: Membro) => setForm({
    ...vazio, id: m.id, nome: m.nome, email: m.email, telefone: m.telefone ?? '', cargoId: String(m.cargoId ?? ''), ativo: !!m.ativo,
    secretarias: [...new Set(m.lotacoes.map((l) => l.secretariaId))], setores: m.lotacoes.map((l) => l.setorId).filter((x): x is number => x !== null),
    origem: String(m.lotacoes[0]?.secretariaId ?? ''),
  });
  const salvar = async () => {
    if (!form) return;
    setErroForm(null);
    if (!form.cargoId) return setErroForm('Escolha o cargo da pessoa.');
    try {
      if (form.id) {
        await api('PUT', `/admin/usuarios/${form.id}`, corpo(form));
        setMsg({ t: 'ok', m: `Dados de ${form.nome} atualizados.` });
      } else {
        const r = await post<{ senhaProvisoria: string | null }>('/admin/usuarios', { ...corpo(form), senha: form.gerar ? undefined : form.senha, exigirTroca: form.gerar || form.exigirTroca });
        if (r.senhaProvisoria) setEntregar({ nome: form.nome, senha: r.senhaProvisoria });
        else setMsg({ t: 'ok', m: `${form.nome} já pode entrar.` });
      }
      setForm(null); recarregar(); cargosApi.recarregar();
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
        <div className="com-icone busca"><Search size={16} aria-hidden="true" /><input aria-label="Procurar na equipe" placeholder="Procurar por nome, e-mail, cargo ou lotação" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <select aria-label="Filtrar por cargo" value={filtroCargo} onChange={(e) => setFiltroCargo(e.target.value)}><option value="">Todos os cargos</option>{cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        <label className="check pequeno"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /><span>Incluir desligados</span></label>
        <button className="botao direita" onClick={() => { setErroForm(null); setForm(vazio); }}><UserPlus size={17} /> Cadastrar servidor</button>
      </div>
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
      <p className="pequeno mudo" style={{ margin: 0 }}>{lista.length} {lista.length === 1 ? 'pessoa' : 'pessoas'}</p>

      <ul className="crachas">
        {lista.map((m) => (
          <li key={m.id} className={`cracha${m.ativo ? '' : ' desligado'}`}>
            <div className={`cracha-faixa escopo-${m.escopo ?? 'SETOR'}`}><span>{m.cargo ?? 'Sem cargo'}</span></div>
            <span className="avatar">{iniciais(m.nome)}</span>
            <strong>{m.nome}{m.id === usuario?.id && <span className="mudo"> (você)</span>}</strong>
            <span className="pequeno mudo cracha-email">{m.email}</span>
            <span className="pequeno">{textoLotacao(m)}</span>
            <div className="cracha-selos">
              {!m.ativo && <span className="etq">Desligado</span>}
              {m.ativo && m.pediuSenhaEm && <span className="etq etq-alerta">Pediu senha</span>}
              {m.ativo && !m.pediuSenhaEm && m.deveTrocarSenha === 1 && <span className="etq">Senha provisória</span>}
              <span className="pequeno mudo">{m.ultimoAcessoEm ? `Entrou ${fmtData(m.ultimoAcessoEm)}` : 'Ainda não entrou'}</span>
            </div>
            <div className="cracha-acoes">
              <button className="botao sec peq" onClick={() => { setErroForm(null); abrir(m); }}><Pencil size={15} /> Editar</button>
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
          <CamposLotacao f={form} mudar={(p) => setForm({ ...form, ...p })} cargos={cargos} />
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

// ------------------------------------------------------------------ Cargos e permissoes
const GRUPOS = [...new Set(Object.values(PERMISSAO_INFO).map((i) => i.grupo))];
type FormCargo = { id: number; nome: string; descricao: string; escopo: EscopoCargo; permissoes: Permissao[] };
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function EditorCargo({ inicial, aoFechar, aoSalvar }: { inicial: FormCargo; aoFechar: () => void; aoSalvar: (f: FormCargo) => Promise<void> }) {
  const [f, setF] = useState<FormCargo>(inicial);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const b = semAcento(busca.trim());
  const visiveis = TODAS_PERMISSOES.filter((p) => !b || semAcento(`${PERMISSAO_INFO[p].nome} ${PERMISSAO_INFO[p].descricao} ${PERMISSAO_INFO[p].grupo}`).includes(b));
  const marcar = (lista: Permissao[], ligar: boolean) => setF({ ...f, permissoes: ligar ? [...new Set([...f.permissoes, ...lista])] : f.permissoes.filter((p) => !lista.includes(p)) });
  const todasVisiveis = visiveis.length > 0 && visiveis.every((p) => f.permissoes.includes(p));
  const sensiveis = f.permissoes.filter((p) => PERMISSAO_INFO[p].sensivel);
  const salvar = async () => {
    setErro(null);
    setSalvando(true);
    try { await aoSalvar(f); } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  };
  return (
    <Gaveta titulo={inicial.id ? `Editar cargo: ${inicial.nome}` : 'Novo cargo'} aoFechar={aoFechar}
      rodape={<><button className="botao sec" onClick={aoFechar}>Cancelar</button><button className="botao" disabled={salvando || f.nome.trim().length < 2} onClick={() => void salvar()}>{inicial.id ? 'Salvar' : 'Criar cargo'}</button></>}>
      <fieldset className="grupo-campos">
        <legend>Cargo</legend>
        <div className="campo"><label htmlFor="c-n">Nome do cargo</label><input id="c-n" value={f.nome} maxLength={80} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Fiscal de obras" /></div>
        <div className="campo"><label htmlFor="c-d">Descrição (opcional)</label><input id="c-d" value={f.descricao} maxLength={300} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="O que esta pessoa faz" /></div>
      </fieldset>
      <fieldset className="grupo-campos">
        <legend>Alcance: o que este cargo enxerga</legend>
        <div className="alcances">
          {ESCOPOS_CARGO.map((e) => (
            <label key={e} className={`alcance${f.escopo === e ? ' marcado' : ''}`}>
              <input type="radio" name="alcance" checked={f.escopo === e} onChange={() => setF({ ...f, escopo: e })} />
              <span><strong>{ESCOPO_CARGO_INFO[e].nome}</strong><small>{ESCOPO_CARGO_INFO[e].descricao}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grupo-campos">
        <legend>Permissões <span className="contador">{f.permissoes.length} de {TODAS_PERMISSOES.length}</span></legend>
        <div className="perm-barra">
          <div className="com-icone busca"><Search size={16} aria-hidden="true" /><input aria-label="Procurar permissão" placeholder="Procurar permissão…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <label className="check pequeno"><input type="checkbox" checked={todasVisiveis} onChange={(e) => marcar(visiveis, e.target.checked)} /><span>{b ? 'Marcar as encontradas' : 'Selecionar todas'}</span></label>
        </div>
        {GRUPOS.map((g) => {
          const doGrupo = visiveis.filter((p) => PERMISSAO_INFO[p].grupo === g);
          if (!doGrupo.length) return null;
          const total = TODAS_PERMISSOES.filter((p) => PERMISSAO_INFO[p].grupo === g);
          const marcadas = total.filter((p) => f.permissoes.includes(p)).length;
          return (
            <details key={g} className="perm-grupo" open={!!b || marcadas > 0 || inicial.id === 0}>
              <summary>
                <span>{g}</span>
                <span className="contador">{marcadas}/{total.length}</span>
                <button type="button" className="link-botao pequeno" onClick={(ev) => { ev.preventDefault(); marcar(doGrupo, !doGrupo.every((p) => f.permissoes.includes(p))); }}>
                  {doGrupo.every((p) => f.permissoes.includes(p)) ? 'Desmarcar o grupo' : 'Marcar o grupo'}
                </button>
              </summary>
              <div className="perm-lista">
                {doGrupo.map((p) => (
                  <label key={p} className="check perm-item">
                    <input type="checkbox" checked={f.permissoes.includes(p)} onChange={(e) => marcar([p], e.target.checked)} />
                    <span><strong>{PERMISSAO_INFO[p].nome}{PERMISSAO_INFO[p].sensivel && <ShieldAlert size={14} className="m-sensivel" aria-label="ação sensível" />}</strong><small>{PERMISSAO_INFO[p].descricao}</small></span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
        {visiveis.length === 0 && <p className="sec">Nenhuma permissão com “{busca}”.</p>}
      </fieldset>
      {sensiveis.length > 0 && <Aviso tipo="alerta"><ShieldAlert size={16} aria-hidden="true" /> Ações sensíveis neste cargo: {sensiveis.map((p) => PERMISSAO_INFO[p].nome).join(', ')}. Toda mudança fica na auditoria.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Gaveta>
  );
}

function CargosPermissoes() {
  const { definirUsuario } = useEstado();
  const { dados, recarregar } = useDados<CargoDto[]>('/admin/cargos');
  const [editor, setEditor] = useState<FormCargo | null>(null);
  const [busca, setBusca] = useState('');
  const [modo, setModo] = useState<'lista' | 'comparar'>('lista');
  const [msg, setMsg] = useState<Msg>(null);
  if (!dados) return <Carregando />;
  const b = semAcento(busca.trim());
  const lista = dados.filter((c) => !b || semAcento(`${c.nome} ${c.descricao ?? ''}`).includes(b));
  const atualizarSessao = async () => {
    const r = await get<{ usuario: UsuarioSessao | null }>('/auth/eu').catch(() => null);
    if (r?.usuario) definirUsuario(r.usuario);
  };
  const salvar = async (f: FormCargo) => {
    const corpo = { nome: f.nome, descricao: f.descricao || null, escopo: f.escopo, permissoes: f.permissoes };
    if (f.id) await api('PUT', `/admin/cargos/${f.id}`, corpo);
    else await post('/admin/cargos', corpo);
    setMsg({ t: 'ok', m: f.id ? `Cargo “${f.nome}” atualizado. Vale a partir da próxima ação de cada pessoa.` : `Cargo “${f.nome}” criado. Agora é só escolhê-lo em Equipe.` });
    setEditor(null); recarregar(); await atualizarSessao();
  };
  const duplicar = async (c: CargoDto) => {
    try {
      const novo = await post<CargoDto>(`/admin/cargos/${c.id}/duplicar`);
      setMsg({ t: 'ok', m: `Criado “${novo.nome}”. Ajuste o nome e as permissões.` });
      recarregar();
      setEditor({ id: novo.id, nome: novo.nome, descricao: novo.descricao ?? '', escopo: novo.escopo, permissoes: novo.permissoes });
    } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };
  const excluir = async (c: CargoDto) => {
    if (!confirm(`Excluir o cargo “${c.nome}”? Isso não pode ser desfeito.`)) return;
    try { await api('DELETE', `/admin/cargos/${c.id}`); setMsg({ t: 'ok', m: `Cargo “${c.nome}” excluído.` }); recarregar(); } catch (e) { setMsg({ t: 'erro', m: (e as Error).message }); }
  };

  return (
    <div className="coluna" style={{ gap: 12 }}>
      <div className="equipe-barra">
        <div className="com-icone busca"><Search size={16} aria-hidden="true" /><input aria-label="Procurar cargo" placeholder="Procurar cargo…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <div className="alternar-modo" role="group" aria-label="Como mostrar">
          <button type="button" aria-pressed={modo === 'lista'} onClick={() => setModo('lista')}>Lista</button>
          <button type="button" aria-pressed={modo === 'comparar'} onClick={() => setModo('comparar')}>Comparar cargos</button>
        </div>
        <button className="botao direita" onClick={() => setEditor({ id: 0, nome: '', descricao: '', escopo: 'SETOR', permissoes: ['demanda.ver'] })}><Plus size={17} aria-hidden="true" /> Novo cargo</button>
      </div>
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}

      {modo === 'lista' ? (
        <ul className="lista-cargos">
          {lista.map((c) => (
            <li key={c.id}>
              <div className="lc-texto">
                <strong>{c.nome}</strong>
                <span className="pequeno sec">{c.descricao || 'Sem descrição'}</span>
                <span className="pequeno mudo">{c.permissoes.length} de {TODAS_PERMISSOES.length} permissões, {c.usuarios === 1 ? '1 pessoa' : `${c.usuarios} pessoas`}</span>
              </div>
              <span className={`selo-alcance escopo-${c.escopo}`}>{ESCOPO_CARGO_INFO[c.escopo].nome}</span>
              <div className="lc-acoes">
                <button className="icone-botao" aria-label={`Duplicar ${c.nome}`} title="Duplicar" onClick={() => void duplicar(c)}><Copy size={17} /></button>
                <button className="icone-botao" aria-label={`Excluir ${c.nome}`} title={c.usuarios ? 'Há pessoas com este cargo: mude o cargo delas antes' : 'Excluir'} disabled={c.usuarios > 0} onClick={() => void excluir(c)}><Trash2 size={17} /></button>
                <button className="botao sec peq" onClick={() => setEditor({ id: c.id, nome: c.nome, descricao: c.descricao ?? '', escopo: c.escopo, permissoes: c.permissoes })}><Pencil size={15} aria-hidden="true" /> Editar</button>
              </div>
            </li>
          ))}
          {lista.length === 0 && <li className="vazio">Nenhum cargo com esse nome. <button className="link-botao" onClick={() => setEditor({ id: 0, nome: busca, descricao: '', escopo: 'SETOR', permissoes: ['demanda.ver'] })}>Criar “{busca}”</button></li>}
        </ul>
      ) : (
        <div className="matriz-moldura">
          <table className="matriz">
            <thead>
              <tr>
                <th scope="col" className="m-acao">Permissão</th>
                {lista.map((c) => <th key={c.id} scope="col"><span className={`m-perfil escopo-${c.escopo}`}>{c.nome}</span><span className="m-info">{ESCOPO_CARGO_INFO[c.escopo].nome}</span></th>)}
              </tr>
            </thead>
            {GRUPOS.map((g) => (
              <tbody key={g}>
                <tr className="m-grupo"><th colSpan={lista.length + 1} scope="colgroup">{g}</th></tr>
                {TODAS_PERMISSOES.filter((perm) => PERMISSAO_INFO[perm].grupo === g).map((perm) => (
                  <tr key={perm}>
                    <th scope="row" className="m-acao"><span className="m-nome">{PERMISSAO_INFO[perm].nome}{PERMISSAO_INFO[perm].sensivel && <ShieldAlert size={14} className="m-sensivel" aria-label="sensível" />}</span></th>
                    {lista.map((c) => <td key={c.id} className={c.permissoes.includes(perm) ? 'm-sim' : ''}>{c.permissoes.includes(perm) ? <Check size={18} aria-label="sim" /> : <Minus size={16} aria-label="não" className="mudo" />}</td>)}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="ajuda"><ShieldAlert size={13} aria-hidden="true" /> marca ações sensíveis. Pelo menos uma pessoa ativa sempre precisa poder administrar a equipe, para ninguém ficar trancado do lado de fora.</p>
      {editor && <EditorCargo inicial={editor} aoFechar={() => setEditor(null)} aoSalvar={salvar} />}
    </div>
  );
}
