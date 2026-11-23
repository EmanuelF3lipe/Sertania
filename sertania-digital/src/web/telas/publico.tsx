import { useEffect, useState } from 'react';
import { RESULTADO_TEXTO, type DemandaDetalhe, type DemandaResumo, type UsuarioSessao } from '../../shared/dominio';
import { enviarFormulario, fmtData, fmtHoras, fmtNum, get, post } from '../api';
import { ir, useDados, useEstado, useRota } from '../nucleo';
import { Aviso, Carregando, EtqStatus, LinhaDoTempo, ListaAnexos, Sla } from '../componentes/comuns';
import { BarrasH, Kpi } from '../componentes/graficos';

export function Acompanhar() {
  const { query } = useRota();
  const [protocolo, setProtocolo] = useState(query.get('protocolo') ?? '');
  const { instalacao } = useEstado();
  const [codigo, setCodigo] = useState(() => {
    try { const c = sessionStorage.getItem('codigo-acesso') ?? ''; sessionStorage.removeItem('codigo-acesso'); return c; } catch { return ''; }
  });
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

  useEffect(() => {
    if (protocolo && codigo) void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="estreito">
      <h1>Acompanhar solicitação</h1>
      <form className="cartao nao-imprimir" onSubmit={(e) => { e.preventDefault(); void buscar(); }}>
        <div className="grade g2">
          <div className="campo"><label htmlFor="p">Protocolo</label><input id="p" value={protocolo} onChange={(e) => setProtocolo(e.target.value.toUpperCase())} placeholder="SER-2026-000123" autoComplete="off" /></div>
          <div className="campo"><label htmlFor="c">Código de acesso</label><input id="c" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="6 letras/números" autoComplete="off" /></div>
        </div>
        <button className="botao">Consultar</button>
        {instalacao?.demonstracao && <p className="ajuda">Demonstração: protocolo <strong>SER-2026-000001</strong> e código <strong>DEMO01</strong>.</p>}
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
