import { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, FilePlus2, Landmark, LockKeyhole, Mail, Phone, Search, UserRound, UsersRound } from 'lucide-react';
import type { UsuarioSessao } from '../../shared/dominio';
import { post } from '../api';
import { ir, useEstado } from '../nucleo';
import { Aviso } from '../componentes/comuns';
import { MarcaSertania } from '../componentes/casca';

type Caminho = 'escolha' | 'equipe' | 'recuperar' | 'cidadao';

const DEMO: Array<[string, string]> = [
  ['admin@sertania.demo', 'Administração (SAD)'],
  ['atendimento@sertania.demo', 'Atendimento / triagem'],
  ['gestor.infra@sertania.demo', 'Gestora de secretaria'],
  ['gestor.iluminacao@sertania.demo', 'Gestor de setor'],
  ['campo.iluminacao@sertania.demo', 'Equipe de campo'],
  ['auditor@sertania.demo', 'Controle interno'],
  ['cidadao@sertania.demo', 'Cidadã com conta'],
];

/** Paisagem do sertao em traço de xilogravura: sol, serras e mandacarus. */
function Paisagem() {
  const cacto = 'M0 0v-46a7 7 0 0 1 14 0v46zM14 -22h7a4 4 0 0 0 4-4v-12a4 4 0 0 1 8 0v14a10 10 0 0 1-10 10h-9zM0 -14h-6a10 10 0 0 1-10-10v-8a4 4 0 0 1 8 0v6a4 4 0 0 0 4 4h4z';
  return (
    <svg className="paisagem" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b4a2a" />
          <stop offset="0.6" stopColor="#1f7a4a" />
          <stop offset="1" stopColor="#7cc79a" />
        </linearGradient>
      </defs>
      <rect width="1200" height="260" fill="url(#ceu)" />
      <g fill="#f0b400">
        {Array.from({ length: 13 }, (_, i) => {
          const ang = Math.PI + (i * Math.PI) / 12;
          const x = 880 + Math.cos(ang) * 120, y = 215 + Math.sin(ang) * 120;
          const x1 = 880 + Math.cos(ang - 0.07) * 92, y1 = 215 + Math.sin(ang - 0.07) * 92;
          const x2 = 880 + Math.cos(ang + 0.07) * 92, y2 = 215 + Math.sin(ang + 0.07) * 92;
          return <path key={i} d={`M${x1} ${y1}L${x} ${y}L${x2} ${y2}z`} />;
        })}
        <circle cx="880" cy="215" r="78" />
      </g>
      <path d="M0 205 C120 160 220 175 330 190 S540 150 640 185 S860 205 980 170 S1140 165 1200 180 V260 H0z" fill="#11643a" />
      <path d="M0 230 C160 205 300 215 420 225 S700 200 820 222 S1050 230 1200 212 V260 H0z" fill="#083a21" />
      <g fill="#062c19">
        <path transform="translate(140 228) scale(1.1)" d={cacto} />
        <path transform="translate(1010 226) scale(1.35)" d={cacto} />
        <path transform="translate(560 222) scale(0.7)" d={cacto} />
      </g>
    </svg>
  );
}

function CampoSenha({ id, valor, aoMudar, novo }: { id: string; valor: string; aoMudar: (v: string) => void; novo?: boolean }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="com-icone">
      <LockKeyhole size={17} aria-hidden="true" />
      <input id={id} type={ver ? 'text' : 'password'} value={valor} onChange={(e) => aoMudar(e.target.value)} autoComplete={novo ? 'new-password' : 'current-password'} required />
      <button type="button" className="olho" onClick={() => setVer(!ver)} aria-label={ver ? 'Esconder a senha' : 'Ver a senha'} aria-pressed={ver}>{ver ? <EyeOff size={17} /> : <Eye size={17} />}</button>
    </div>
  );
}

export function Entrar() {
  const { definirUsuario, instalacao } = useEstado();
  const [caminho, setCaminho] = useState<Caminho>(() => {
    try { const c = localStorage.getItem('entrada'); return c === 'equipe' || c === 'cidadao' ? c : 'escolha'; } catch { return 'escolha'; }
  });
  const [contaCidadao, setContaCidadao] = useState<'entrar' | 'criar'>('entrar');
  const [f, setF] = useState({ nome: '', email: '', telefone: '', senha: '', consentimento: false });
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const par = instalacao?.parametros;

  const irPara = (c: Caminho) => {
    setCaminho(c); setErro(null); setOk(null);
    if (c === 'equipe' || c === 'cidadao') { try { localStorage.setItem('entrada', c); } catch { /* ignora */ } }
  };
  const enviar = async (tipo: 'entrar' | 'criar' | 'recuperar') => {
    setErro(null); setOk(null); setEnviando(true);
    try {
      if (tipo === 'recuperar') {
        await post('/auth/esqueci', { email: f.email });
        setOk('Pronto. Se este e-mail for de alguém da equipe, o pedido já está com a administração, que vai gerar uma senha provisória e entregar a você pessoalmente.');
        return;
      }
      const r = await post<{ csrf: string; usuario: UsuarioSessao }>(tipo === 'entrar' ? '/auth/entrar' : '/auth/cadastro', tipo === 'entrar' ? { email: f.email, senha: f.senha } : f);
      definirUsuario(r.usuario, r.csrf);
      ir(r.usuario.deveTrocarSenha ? '/trocar-senha' : r.usuario.papel === 'CIDADAO' ? '/minhas' : '/equipe');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  const campoEmail = (
    <div className="campo"><label htmlFor="e">E-mail</label><div className="com-icone"><Mail size={17} aria-hidden="true" /><input id="e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" required /></div></div>
  );

  return (
    <div className="portal-entrada">
      <header className="entrada-cena">
        <Paisagem />
        <a href="#/" className="entrada-marca"><MarcaSertania tamanho={46} /><span><strong>{par?.nomeSistema ?? 'Sertânia Digital'}</strong><small>{par?.orgao ?? 'Prefeitura Municipal de Sertânia – PE'}</small></span></a>
        <div className="faixa-cordel tinta" aria-hidden="true" />
      </header>

      <main className="entrada-corpo" id="conteudo" tabIndex={-1}>
        {caminho === 'escolha' && (
          <section className="entrada-cartao">
            <h1>Como você quer entrar?</h1>
            <p className="sec">Escolha o seu caminho. Dá para trocar depois.</p>
            <div className="portas">
              <button className="porta" onClick={() => irPara('equipe')}>
                <span className="porta-ic"><Landmark size={26} aria-hidden="true" /></span>
                <span><strong>Sou da equipe da prefeitura</strong><small>Atendimento, setores, secretarias, campo e gestão.</small></span>
                <ArrowRight size={20} aria-hidden="true" className="porta-seta" />
              </button>
              <button className="porta" onClick={() => irPara('cidadao')}>
                <span className="porta-ic cidadao"><UsersRound size={26} aria-hidden="true" /></span>
                <span><strong>Sou cidadão ou cidadã</strong><small>Fazer e acompanhar pedidos. A conta é opcional.</small></span>
                <ArrowRight size={20} aria-hidden="true" className="porta-seta" />
              </button>
            </div>
          </section>
        )}

        {caminho === 'equipe' && (
          <section className="entrada-cartao">
            <button className="link-botao voltar" onClick={() => irPara('escolha')}><ArrowLeft size={16} /> Trocar caminho</button>
            <span className="selo"><Landmark size={14} aria-hidden="true" /> Área da equipe</span>
            <h1>Bom trabalho por aqui.</h1>
            <p className="sec">Entre com o e-mail institucional e a senha que você criou.</p>
            <form onSubmit={(e) => { e.preventDefault(); void enviar('entrar'); }}>
              {campoEmail}
              <div className="campo"><label htmlFor="s">Senha</label><CampoSenha id="s" valor={f.senha} aoMudar={(v) => setF({ ...f, senha: v })} /></div>
              {erro && <Aviso tipo="erro">{erro}</Aviso>}
              <button className="botao largo" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar na área da equipe'}</button>
            </form>
            <div className="entrada-rodape">
              <button className="link-botao" onClick={() => irPara('recuperar')}>Perdi o acesso à minha senha</button>
              <span className="pequeno mudo">Ainda sem conta? Ela é criada pela administração do sistema.</span>
            </div>
          </section>
        )}

        {caminho === 'recuperar' && (
          <section className="entrada-cartao">
            <button className="link-botao voltar" onClick={() => irPara('equipe')}><ArrowLeft size={16} /> Voltar</button>
            <h1>Pedir uma nova senha</h1>
            <p className="sec">O sistema não manda senha por e-mail. O pedido vai para a administração, que gera uma senha provisória e entrega a você. No primeiro acesso, você cria a sua.</p>
            <form onSubmit={(e) => { e.preventDefault(); void enviar('recuperar'); }}>
              {campoEmail}
              {erro && <Aviso tipo="erro">{erro}</Aviso>}
              {ok && <Aviso tipo="ok">{ok}</Aviso>}
              <button className="botao largo" disabled={enviando}>Enviar pedido à administração</button>
            </form>
            {(par?.telefoneContato || par?.emailContato) && <p className="ajuda" style={{ marginTop: 12 }}>Com pressa? Fale com a administração: {[par.telefoneContato, par.emailContato].filter(Boolean).join(' · ')}.</p>}
          </section>
        )}

        {caminho === 'cidadao' && (
          <section className="entrada-cartao">
            <button className="link-botao voltar" onClick={() => irPara('escolha')}><ArrowLeft size={16} /> Trocar caminho</button>
            <div className="sem-conta">
              <h1>Você não precisa de conta</h1>
              <p className="sec">Todo pedido gera um protocolo e um código. Com eles você acompanha tudo, de qualquer celular.</p>
              <div className="linha">
                <a className="botao" href="#/nova"><FilePlus2 size={18} /> Fazer um pedido</a>
                <a className="botao sec" href="#/acompanhar"><Search size={18} /> Acompanhar pedido</a>
              </div>
            </div>
            <div className="conta-opcional">
              <h2>Prefere ter uma conta?</h2>
              <p className="pequeno sec">Com conta, todos os seus pedidos ficam reunidos em “Minhas solicitações”.</p>
              <div className="sublinhas" role="tablist" aria-label="Conta de cidadão">
                <button role="tab" aria-selected={contaCidadao === 'entrar'} onClick={() => { setContaCidadao('entrar'); setErro(null); }}>Já tenho conta</button>
                <button role="tab" aria-selected={contaCidadao === 'criar'} onClick={() => { setContaCidadao('criar'); setErro(null); }}>Quero criar</button>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); void enviar(contaCidadao); }}>
                {contaCidadao === 'criar' && <div className="campo"><label htmlFor="n">Nome completo</label><div className="com-icone"><UserRound size={17} aria-hidden="true" /><input id="n" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" required /></div></div>}
                {campoEmail}
                {contaCidadao === 'criar' && <div className="campo"><label htmlFor="t">Telefone (opcional)</label><div className="com-icone"><Phone size={17} aria-hidden="true" /><input id="t" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} inputMode="tel" autoComplete="tel" /></div></div>}
                <div className="campo">
                  <label htmlFor="s">Senha</label>
                  <CampoSenha id="s" valor={f.senha} aoMudar={(v) => setF({ ...f, senha: v })} novo={contaCidadao === 'criar'} />
                  {contaCidadao === 'criar' && <div className="ajuda">Pelo menos 8 caracteres, misturando letras e números.</div>}
                </div>
                {contaCidadao === 'criar' && <label className="check campo"><input type="checkbox" checked={f.consentimento} onChange={(e) => setF({ ...f, consentimento: e.target.checked })} /><span className="pequeno">Autorizo o uso dos meus dados só para os atendimentos que eu pedir (LGPD). Posso baixar ou apagar meus dados quando quiser.</span></label>}
                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                <button className="botao sec largo" disabled={enviando}>{contaCidadao === 'entrar' ? 'Entrar' : 'Criar minha conta'}</button>
              </form>
            </div>
          </section>
        )}

        {instalacao?.demonstracao && caminho !== 'recuperar' && (
          <details className="entrada-demo">
            <summary>Ambiente de demonstração — contas de teste (senha <code>Sertania2026</code>)</summary>
            <div>
              {DEMO.map(([e, d]) => (
                <button key={e} type="button" onClick={() => { const cid = e.startsWith('cidadao'); irPara(cid ? 'cidadao' : 'equipe'); setContaCidadao('entrar'); setF({ ...f, email: e, senha: 'Sertania2026' }); }}>
                  <strong>{d}</strong><span>{e}</span>
                </button>
              ))}
            </div>
          </details>
        )}
        <p className="entrada-versao">v{instalacao?.versao ?? '—'}</p>
      </main>
    </div>
  );
}
