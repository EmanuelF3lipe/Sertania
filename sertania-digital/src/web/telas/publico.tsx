import { useEffect, useState } from 'react';
import { RESULTADO_TEXTO, type DemandaDetalhe, type DemandaResumo, type UsuarioSessao } from '../../shared/dominio';
import { enviarFormulario, fmtData, fmtHoras, fmtNum, get, post } from '../api';
import { ir, useDados, useEstado, useRota } from '../nucleo';
import { Aviso, Carregando, EtqStatus, LinhaDoTempo, ListaAnexos, Sla } from '../componentes/comuns';
import { BarrasH, Kpi } from '../componentes/graficos';
import { enviadas, pendentes, type Enviada } from '../offline';

export function Inicio() {
  const { usuario, pode } = useEstado();
  const [locais, setLocais] = useState<{ pend: number; env: Enviada[] }>({ pend: 0, env: [] });
  useEffect(() => {
    Promise.all([pendentes(), enviadas()]).then(([p, e]) => setLocais({ pend: p.length, env: e.slice(-3).reverse() })).catch(() => undefined);
  }, []);
  return (
    <div className="estreito">
      <h1>Olá! Como a prefeitura pode ajudar?</h1>
      <p className="sec">Registre problemas na sua rua, distrito ou comunidade e acompanhe cada passo do atendimento.</p>
      <div className="coluna" style={{ margin: '20px 0' }}>
        <a className="botao grande" href="#/nova">📝<span>Registrar uma solicitação<small>Iluminação, buracos, lixo, água, saúde, escola e outros</small></span></a>
        <a className="botao grande sec" href="#/acompanhar">🔎<span>Acompanhar minha solicitação<small>Use o protocolo e o código de acesso</small></span></a>
        <a className="botao grande sec" href="#/transparencia">📊<span>Transparência<small>Números do atendimento e dados abertos</small></span></a>
        {!usuario && <a className="botao grande sec" href="#/entrar">👤<span>Entrar ou criar conta<small>Para ver todas as suas solicitações em um só lugar (opcional)</small></span></a>}
        {usuario?.papel === 'CIDADAO' && <a className="botao grande sec" href="#/minhas">📂<span>Minhas solicitações</span></a>}
        {pode('demanda.ver') && <a className="botao grande sec" href="#/gestao/fila">🏛<span>Área da equipe<small>Fila de atendimento, painéis e mapa</small></span></a>}
      </div>
      {locais.pend > 0 && <Aviso tipo="alerta">{locais.pend} solicitação(ões) aguardando internet para envio neste aparelho.</Aviso>}
      {locais.env.length > 0 && (
        <div className="cartao">
          <h3>Enviadas deste aparelho quando o sinal voltou</h3>
          {locais.env.map((e) => <p key={e.chave} className="pequeno">Protocolo <strong>{e.protocolo}</strong> · código <span className="codigo" style={{ fontSize: '1rem' }}>{e.codigo}</span></p>)}
        </div>
      )}
      <div className="cartao" style={{ marginTop: 16 }}>
        <h3>Precisa de ajuda para registrar?</h3>
        <p className="sec">Procure o atendimento da Prefeitura, a ouvidoria ou o posto do seu distrito. Um servidor registra para você e entrega o protocolo.</p>
      </div>
    </div>
  );
}

export function Acompanhar() {
  const { query } = useRota();
  const [protocolo, setProtocolo] = useState(query.get('protocolo') ?? '');
  const [codigo, setCodigo] = useState('');
  const [d, setD] = useState<DemandaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const buscar = async () => {
    setErro(null);
    setMsg(null);
    try {
      setD(await post<DemandaDetalhe>('/publico/acompanhar', { protocolo, codigo }));
    } catch (e) {
      setErro((e as Error).message);
      setD(null);
    }
  };

  return (
    <div className="estreito">
      <h1>Acompanhar solicitação</h1>
      <form className="cartao nao-imprimir" onSubmit={(e) => { e.preventDefault(); void buscar(); }}>
        <div className="grade g2">
          <div className="campo"><label htmlFor="p">Protocolo</label><input id="p" value={protocolo} onChange={(e) => setProtocolo(e.target.value.toUpperCase())} placeholder="SER-2026-000123" autoComplete="off" /></div>
          <div className="campo"><label htmlFor="c">Código de acesso</label><input id="c" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="6 letras/números" autoComplete="off" /></div>
        </div>
        <button className="botao">Consultar</button>
        <p className="ajuda">Demonstração: protocolo <strong>SER-2026-000001</strong> e código <strong>DEMO01</strong>.</p>
      </form>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {d && (
        <div className="cartao" style={{ marginTop: 16 }}>
          <div className="linha entre">
            <div><div className="mudo pequeno">Protocolo</div><div className="protocolo">{d.protocolo}</div></div>
            <EtqStatus status={d.status} />
          </div>
          <p><strong>{d.servico}</strong> · {d.secretaria}<br /><span className="sec">{[d.localidade, d.endereco].filter(Boolean).join(' · ')}</span></p>
          <p className="sec">{d.descricao}</p>
          <Sla sla={d.sla} />
          {d.agendadaPara && <Aviso>Atendimento previsto para <strong>{fmtData(d.agendadaPara, false)}</strong>.</Aviso>}
          {d.resultado && <Aviso tipo="ok">Resultado: <strong>{RESULTADO_TEXTO[d.resultado]}</strong></Aviso>}
          <ListaAnexos anexos={d.anexos} baixavel={false} />

          {d.status === 'AGUARDANDO_CIDADAO' && (
            <div className="cartao" style={{ margin: '16px 0', borderColor: 'var(--aviso)' }}>
              <h3>A equipe precisa de uma informação sua</h3>
              <p>{[...d.eventos].reverse().find((e) => e.paraStatus === 'AGUARDANDO_CIDADAO')?.textoPublico}</p>
              <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} aria-label="Sua resposta" />
              <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 5))} style={{ marginTop: 8 }} />
              <button className="botao" style={{ marginTop: 8 }} onClick={() => void enviarFormulario<DemandaDetalhe>('/publico/responder', { protocolo, codigo, texto: resposta }, arquivos).then((x) => { setD(x); setResposta(''); setMsg('Resposta enviada. Obrigado!'); }).catch((e: Error) => setErro(e.message))}>Enviar resposta</button>
            </div>
          )}
          {d.status === 'CONCLUIDA' && !d.avaliacao && (
            <div className="cartao" style={{ margin: '16px 0' }}>
              <h3>Como foi o atendimento?</h3>
              <div className="linha" role="radiogroup" aria-label="Nota de 1 a 5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={nota === n} className={`botao ${nota >= n ? '' : 'sec'}`} onClick={() => setNota(n)} aria-label={`${n} estrela(s)`}>★</button>
                ))}
              </div>
              <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentário (opcional)" style={{ marginTop: 8 }} />
              <button className="botao" disabled={!nota} style={{ marginTop: 8 }} onClick={() => void post('/publico/avaliar', { protocolo, codigo, nota, comentario }).then(() => { setMsg('Avaliação registrada. Obrigado!'); void buscar(); }).catch((e: Error) => setErro(e.message))}>Enviar avaliação</button>
            </div>
          )}
          {d.avaliacao && <p className="sec">Sua avaliação: {'★'.repeat(d.avaliacao.nota)}</p>}
          {msg && <Aviso tipo="ok">{msg}</Aviso>}
          <h3 style={{ marginTop: 16 }}>Histórico</h3>
          <LinhaDoTempo eventos={d.eventos} baixavel={false} />
          <button className="botao sec nao-imprimir" onClick={() => window.print()}>🖨 Imprimir</button>
        </div>
      )}
    </div>
  );
}

interface Transp { periodo: string; total: number; concluidas: number; abertas: number; noPrazoPct: number | null; tempoAtendimentoHoras: number | null; satisfacao: number | null; porSecretaria: Array<{ nome: string; total: number; concluidas: number }>; porLocalidade: Array<{ nome: string; total: number }> }

export function Transparencia() {
  const { dados, erro } = useDados<Transp>('/publico/transparencia');
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return <Carregando />;
  return (
    <>
      <h1>Transparência do atendimento</h1>
      <p className="sec">Números agregados ({dados.periodo}). Nenhum dado pessoal é exibido.</p>
      <div className="grade g4" style={{ marginBottom: 16 }}>
        <Kpi rotulo="Solicitações registradas" valor={fmtNum(dados.total, 0)} />
        <Kpi rotulo="Concluídas" valor={fmtNum(dados.concluidas, 0)} />
        <Kpi rotulo="Concluídas no prazo" valor={fmtNum(dados.noPrazoPct, 1, '%')} />
        <Kpi rotulo="Tempo típico de atendimento" valor={fmtHoras(dados.tempoAtendimentoHoras)} detalhe="mediana" />
        <Kpi rotulo="Satisfação média" valor={fmtNum(dados.satisfacao, 1, ' / 5')} />
      </div>
      <div className="grade g2">
        <div className="cartao"><h2>Por secretaria</h2><BarrasH titulo="Solicitações por secretaria" itens={dados.porSecretaria.map((s) => ({ nome: s.nome, valor: s.total, detalhe: `${s.concluidas} concluídas` }))} /></div>
        <div className="cartao"><h2>Por localidade</h2><BarrasH titulo="Solicitações por localidade" itens={dados.porLocalidade.map((s) => ({ nome: s.nome, valor: s.total }))} /></div>
      </div>
      <div className="cartao" style={{ marginTop: 16 }}>
        <h2>Dados abertos</h2>
        <p className="sec">Base agregada por mês, secretaria, serviço, localidade e situação, com supressão de grupos muito pequenos para evitar identificação de pessoas. Licença CC-BY 4.0.</p>
        <div className="linha">
          <a className="botao sec" href="/api/publico/dados-abertos?formato=csv">Baixar CSV</a>
          <a className="botao sec" href="/api/publico/dados-abertos" target="_blank" rel="noreferrer">Ver JSON</a>
          <a className="botao sec" href="#/api">Documentação da API</a>
        </div>
      </div>
    </>
  );
}

export function Entrar() {
  const { definirUsuario } = useEstado();
  const [modo, setModo] = useState<'entrar' | 'cadastro'>('entrar');
  const [f, setF] = useState({ nome: '', email: '', telefone: '', senha: '', consentimento: false });
  const [erro, setErro] = useState<string | null>(null);
  const enviar = async () => {
    setErro(null);
    try {
      const r = await post<{ csrf: string; usuario: UsuarioSessao }>(modo === 'entrar' ? '/auth/entrar' : '/auth/cadastro', modo === 'entrar' ? { email: f.email, senha: f.senha } : f);
      definirUsuario(r.usuario, r.csrf);
      ir(r.usuario.papel === 'CIDADAO' ? '/minhas' : '/gestao/fila');
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  return (
    <div className="estreito" style={{ maxWidth: 480 }}>
      <h1>{modo === 'entrar' ? 'Entrar' : 'Criar conta de cidadão'}</h1>
      <form className="cartao" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        {modo === 'cadastro' && <div className="campo"><label htmlFor="n">Nome completo</label><input id="n" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" /></div>}
        <div className="campo"><label htmlFor="e">E-mail</label><input id="e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" /></div>
        {modo === 'cadastro' && <div className="campo"><label htmlFor="t">Telefone (opcional)</label><input id="t" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} inputMode="tel" /></div>}
        <div className="campo"><label htmlFor="s">Senha</label><input id="s" type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} />{modo === 'cadastro' && <div className="ajuda">Mínimo de 8 caracteres, com letras e números.</div>}</div>
        {modo === 'cadastro' && <label className="check campo"><input type="checkbox" checked={f.consentimento} onChange={(e) => setF({ ...f, consentimento: e.target.checked })} /><span>Concordo com o uso dos meus dados para os atendimentos que eu solicitar (LGPD). Posso exportar ou excluir meus dados a qualquer momento.</span></label>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <button className="botao" style={{ width: '100%' }}>{modo === 'entrar' ? 'Entrar' : 'Criar conta'}</button>
        <p style={{ marginTop: 12 }}>
          <button type="button" className="botao sec peq" onClick={() => setModo(modo === 'entrar' ? 'cadastro' : 'entrar')}>{modo === 'entrar' ? 'Não tenho conta: criar' : 'Já tenho conta: entrar'}</button>
        </p>
      </form>
      <details className="cartao" style={{ marginTop: 16 }}>
        <summary><strong>Contas de demonstração</strong> (senha <code>Sertania2026</code>)</summary>
        <ul className="pequeno">
          {[
            ['cidadao@sertania.demo', 'Cidadã com conta'],
            ['atendimento@sertania.demo', 'Atendimento / triagem (todas as secretarias)'],
            ['gestor.infra@sertania.demo', 'Gestora da Secretaria de Infraestrutura'],
            ['gestor.iluminacao@sertania.demo', 'Gestor do setor de Iluminação'],
            ['campo.iluminacao@sertania.demo', 'Equipe de campo – Iluminação'],
            ['gestor.saude@sertania.demo', 'Gestora da Saúde'],
            ['admin@sertania.demo', 'Administração (SAD) – visão consolidada'],
            ['auditor@sertania.demo', 'Controle interno / auditoria'],
          ].map(([e, d]) => (
            <li key={e}><button type="button" className="botao sec peq" onClick={() => { setModo('entrar'); setF({ ...f, email: e!, senha: 'Sertania2026' }); }}>{e}</button> {d}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function MinhasDemandas() {
  const { usuario } = useEstado();
  const { dados, erro } = useDados<DemandaResumo[]>(usuario ? '/cidadao/demandas' : null);
  const [sel, setSel] = useState<DemandaDetalhe | null>(null);
  if (!usuario) return <Aviso>Entre com sua conta para ver suas solicitações. <a href="#/entrar">Entrar</a></Aviso>;
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return <Carregando />;
  return (
    <div className="estreito">
      <div className="linha entre"><h1>Minhas solicitações</h1><a className="botao" href="#/nova">+ Nova</a></div>
      {dados.length === 0 && <Aviso>Você ainda não tem solicitações. <a href="#/nova">Registrar a primeira</a></Aviso>}
      <div className="coluna">
        {dados.map((d) => (
          <button key={d.id} className="cartao" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => void get<DemandaDetalhe>(`/cidadao/demandas/${d.protocolo}`).then(setSel)}>
            <div className="linha entre"><strong>{d.protocolo}</strong><EtqStatus status={d.status} /></div>
            <div>{d.servico}</div>
            <div className="pequeno mudo">{fmtData(d.criadaEm)} · {d.localidade}</div>
          </button>
        ))}
      </div>
      {sel && (
        <div className="cartao" style={{ marginTop: 16 }}>
          <h2>{sel.protocolo}</h2>
          <Sla sla={sel.sla} />
          <LinhaDoTempo eventos={sel.eventos} baixavel />
          <p className="pequeno mudo">Para responder ou avaliar, use <a href={`#/acompanhar?protocolo=${sel.protocolo}`}>Acompanhar</a> com o código de acesso.</p>
        </div>
      )}
      <div className="cartao" style={{ marginTop: 24 }}>
        <h3>Meus dados (LGPD)</h3>
        <div className="linha">
          <a className="botao sec" href="/api/cidadao/meus-dados">Exportar meus dados</a>
          <button className="botao perigo" onClick={() => { if (confirm('Excluir sua conta? Suas solicitações continuam no histórico do serviço, mas sem seus dados pessoais. Esta ação não pode ser desfeita.')) void post('/cidadao/excluir-conta').then(() => { window.location.hash = '/'; window.location.reload(); }); }}>Excluir minha conta</button>
        </div>
      </div>
    </div>
  );
}
