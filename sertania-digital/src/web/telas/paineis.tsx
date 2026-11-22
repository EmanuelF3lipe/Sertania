import { useMemo, useState } from 'react';
import { STATUS_TEXTO, type AnaliseIa, type Status } from '../../shared/dominio';
import { api, fmtData, fmtHoras, fmtNum, post, qs } from '../api';
import { ir, useDados, useEstado, useRota } from '../nucleo';
import { Aviso, Carregando, COR_STATUS, EtqStatus } from '../componentes/comuns';
import { BarrasH, Kpi, LinhaTempo, porSemana } from '../componentes/graficos';
import { Mapa, type PontoMapa } from '../componentes/mapa';
import { FiltrosDemanda } from './gestao';

interface Grupo { nome: string; total: number; abertas: number; concluidas: number; vencidas: number }
interface Indicadores {
  geradoEm: string; total: number; abertas: number; encerradas: number; concluidas: number; vencidasAbertas: number;
  rastreabilidadePct: number | null;
  tempoEncaminhamentoHoras: { media: number | null; mediana: number | null; amostras: number };
  tempoPrimeiraRespostaHoras: { media: number | null; mediana: number | null };
  tempoAtendimentoHoras: { media: number | null; mediana: number | null; amostras: number };
  noPrazoPct: number | null; resolvidasPct: number | null; recorrenciaPct: number; reaberturaPct: number;
  satisfacao: { media: number | null; respostas: number; taxaResposta: number | null; distribuicao: Array<{ nota: number; total: number }> };
  porStatus: Grupo[]; porSecretaria: Grupo[]; porServico: Grupo[]; porLocalidade: Grupo[]; porTipoLocalidade: Grupo[]; porCanal: Grupo[]; porPrioridade: Grupo[];
  serie: Array<{ dia: string; registradas: number; concluidas: number }>;
  usoPaineis: Array<{ painel: string; acessos: number; usuarios: number }>;
  ia: { decididas: number; aceitas: number; ajustadas: number; rejeitadas: number; aceitacaoPct: number | null };
}

const TIPO_LOC: Record<string, string> = { SEDE: 'Sede', DISTRITO: 'Distritos', COMUNIDADE_RURAL: 'Comunidades rurais' };

export function ConteudoIndicadores({ i }: { i: Indicadores }) {
  return (
    <>
      <h2>Indicadores do desafio</h2>
      <div className="grade g4" style={{ marginBottom: 16 }}>
        <Kpi rotulo="Demandas com protocolo e histórico" valor={fmtNum(i.rastreabilidadePct, 1, '%')} detalhe={`${i.total} no período`} />
        <Kpi rotulo="Registro → encaminhamento" valor={fmtHoras(i.tempoEncaminhamentoHoras.mediana)} detalhe={`mediana · média ${fmtHoras(i.tempoEncaminhamentoHoras.media)}`} />
        <Kpi rotulo="Tempo de atendimento" valor={fmtHoras(i.tempoAtendimentoHoras.mediana)} detalhe={`mediana de ${i.tempoAtendimentoHoras.amostras} concluídas · média ${fmtHoras(i.tempoAtendimentoHoras.media)}`} />
        <Kpi rotulo="Concluídas dentro do prazo" valor={fmtNum(i.noPrazoPct, 1, '%')} detalhe={`${i.vencidasAbertas} em aberto com prazo vencido`} alerta={i.vencidasAbertas > 0 && (i.noPrazoPct ?? 100) < 70} />
        <Kpi rotulo="Taxa de recorrência" valor={fmtNum(i.recorrenciaPct, 1, '%')} detalhe={`reabertura: ${fmtNum(i.reaberturaPct, 1, '%')}`} />
        <Kpi rotulo="Satisfação do cidadão" valor={fmtNum(i.satisfacao.media, 1, ' / 5')} detalhe={`${i.satisfacao.respostas} avaliações · ${fmtNum(i.satisfacao.taxaResposta, 0, '%')} das concluídas`} />
        <Kpi rotulo="Em aberto" valor={fmtNum(i.abertas, 0)} detalhe={`${i.concluidas} concluídas · ${fmtNum(i.resolvidasPct, 0, '%')} resolvidas`} />
        <Kpi rotulo="Uso de painéis (30 dias)" valor={fmtNum(i.usoPaineis.reduce((a, b) => a + b.acessos, 0), 0)} detalhe={`${Math.max(0, ...i.usoPaineis.map((u) => u.usuarios))} gestor(es) distintos no painel mais usado`} />
      </div>
      <div className="grade g2">
        <div className="cartao"><h3>Registradas × concluídas por semana</h3><LinhaTempo titulo="Registradas e concluídas por semana" pontos={porSemana(i.serie)} series={[{ chave: 'registradas', nome: 'Registradas', cor: 'var(--serie-1)' }, { chave: 'concluidas', nome: 'Concluídas', cor: 'var(--serie-2)' }]} /></div>
        <div className="cartao"><h3>Por localidade</h3><BarrasH titulo="Demandas por localidade" itens={i.porLocalidade.map((g) => ({ nome: g.nome, valor: g.total, detalhe: `${g.abertas} em aberto · ${g.vencidas} vencidas` }))} /></div>
        <div className="cartao"><h3>Por tipo de serviço</h3><BarrasH titulo="Demandas por serviço" itens={i.porServico.map((g) => ({ nome: g.nome, valor: g.total, detalhe: `${g.abertas} em aberto` }))} /></div>
        <div className="cartao"><h3>Por secretaria</h3><BarrasH titulo="Demandas por secretaria" itens={i.porSecretaria.map((g) => ({ nome: g.nome, valor: g.total, detalhe: `${g.concluidas} concluídas · ${g.vencidas} vencidas` }))} /></div>
        <div className="cartao">
          <h3>Por situação</h3>
          <table><tbody>{i.porStatus.map((g) => <tr key={g.nome}><td><EtqStatus status={g.nome as Status} /></td><td className="num">{g.total}</td></tr>)}</tbody></table>
        </div>
        <div className="cartao">
          <h3>Território e canais</h3>
          <table>
            <thead><tr><th>Área</th><th className="num">Total</th><th className="num">Vencidas</th></tr></thead>
            <tbody>{i.porTipoLocalidade.map((g) => <tr key={g.nome}><td>{TIPO_LOC[g.nome] ?? g.nome}</td><td className="num">{g.total}</td><td className="num">{g.vencidas}</td></tr>)}</tbody>
          </table>
          <hr />
          <BarrasH titulo="Demandas por canal" itens={i.porCanal.map((g) => ({ nome: g.nome, valor: g.total }))} />
        </div>
        <div className="cartao"><h3>Distribuição das avaliações</h3><BarrasH titulo="Avaliações por nota" itens={i.satisfacao.distribuicao.map((d) => ({ nome: `${d.nota} estrela(s)`, valor: d.total }))} /></div>
        <div className="cartao">
          <h3>Supervisão da IA</h3>
          <p className="pequeno">{i.ia.decididas} sugestões decididas por pessoas: {i.ia.aceitas} aceitas, {i.ia.ajustadas} ajustadas, {i.ia.rejeitadas} rejeitadas.</p>
          <p className="pequeno">Taxa de aceitação sem ajuste: <strong>{fmtNum(i.ia.aceitacaoPct, 0, '%')}</strong>. Acompanhe para calibrar a confiança no apoio automático.</p>
          <h3 style={{ marginTop: 12 }}>Uso dos painéis (30 dias)</h3>
          <table><tbody>{i.usoPaineis.map((u) => <tr key={u.painel}><td>{u.painel}</td><td className="num">{u.acessos} acessos</td><td className="num">{u.usuarios} pessoas</td></tr>)}</tbody></table>
        </div>
      </div>
    </>
  );
}

export function Painel() {
  const [f, setF] = useState<Record<string, string>>({});
  const { dados, erro } = useDados<Indicadores>(`/gestao/indicadores${qs(f)}`);
  return (
    <>
      <div className="linha entre">
        <h1>Painel gerencial</h1>
        <div className="linha nao-imprimir">
          <a className="botao sec" href={`/api/gestao/exportar${qs({ ...f, formato: 'csv' })}`}>Exportar CSV</a>
          <a className="botao sec" href={`/api/gestao/exportar${qs({ ...f, formato: 'json' })}`}>Exportar JSON</a>
          <button className="botao sec" onClick={() => window.print()}>🖨 Imprimir</button>
        </div>
      </div>
      <Aviso tipo="alerta">Ambiente de demonstração: os números abaixo vêm de dados fictícios e <strong>não são estimativas oficiais</strong> do Município. A linha de base real é registrada no Diagnóstico.</Aviso>
      <FiltrosDemanda f={f} setF={setF} campos={['periodo', 'secretaria', 'setor', 'servico', 'localidade', 'status', 'canal']} />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? <Carregando /> : <ConteudoIndicadores i={dados} />}
    </>
  );
}

interface PontoApi { id: number; protocolo: string; status: Status; statusTexto: string; servico: string; secretaria: string; localidade: string | null; prioridade: string; lat: number; lng: number; aproximado: boolean; recorrente: boolean }
interface GrupoRec { raiz: number; total: number; servico: string; localidade: string | null; secretaria: string; ultimo: string; abertas: number; lat: number | null; lng: number | null }

export function MapaTela() {
  const [f, setF] = useState<Record<string, string>>({ status: 'ABERTAS' });
  const [mostrarRec, setMostrarRec] = useState(true);
  const { dados, erro } = useDados<{ pontos: PontoApi[]; recorrencias: GrupoRec[] }>(`/gestao/mapa${qs(f)}`);
  const pontos = useMemo<PontoMapa[]>(() => (dados?.pontos ?? []).map((p) => ({
    id: p.id, lat: p.lat, lng: p.lng, cor: COR_STATUS[p.status], raio: p.prioridade === 'URGENTE' || p.prioridade === 'ALTA' ? 8 : 6, tracejado: p.aproximado,
    rotulo: `${p.protocolo} · ${p.servico} · ${p.statusTexto}${p.aproximado ? ' (posição aproximada pela localidade)' : ''}`, aoClicar: () => ir(`/gestao/demanda/${p.id}`),
  })), [dados]);
  const circulos = useMemo<PontoMapa[]>(() => (mostrarRec ? (dados?.recorrencias ?? []) : []).filter((g) => g.lat !== null).map((g) => ({
    id: `r${g.raiz}`, lat: g.lat!, lng: g.lng!, cor: 'var(--critico)', raio: 250 + g.total * 40, rotulo: `Recorrência: ${g.servico}${g.localidade ? ` – ${g.localidade}` : ''} (${g.total} registros)`,
  })), [dados, mostrarRec]);
  const presentes = [...new Set((dados?.pontos ?? []).map((p) => p.status))];
  return (
    <>
      <h1>Mapa das demandas</h1>
      <FiltrosDemanda f={f} setF={setF} campos={['periodo', 'secretaria', 'servico', 'localidade', 'status', 'prioridade']} />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="linha" style={{ marginBottom: 8 }}>
        <div className="legenda" style={{ margin: 0 }}>
          {presentes.map((s) => <span key={s} style={{ ['--c' as string]: COR_STATUS[s] }}>{STATUS_TEXTO[s]}</span>)}
          <span style={{ ['--c' as string]: 'var(--critico)' }}>Foco de recorrência (círculo)</span>
        </div>
        <label className="check direita" style={{ margin: 0 }}><input type="checkbox" checked={mostrarRec} onChange={(e) => setMostrarRec(e.target.checked)} /><span>Mostrar focos de recorrência</span></label>
      </div>
      <Mapa pontos={pontos} circulos={circulos} />
      <p className="ajuda">{dados?.pontos.length ?? 0} pontos. Pontos tracejados usam a posição da localidade, pois o cidadão não marcou o local exato. Clique em um ponto para abrir a solicitação.</p>
      {dados && dados.recorrencias.length > 0 && (
        <div className="cartao" style={{ marginTop: 16 }}>
          <h2>Problemas recorrentes (3+ registros no mesmo local em 90 dias)</h2>
          <table><thead><tr><th>Serviço</th><th>Local</th><th className="num">Registros</th><th className="num">Em aberto</th><th>Último</th></tr></thead>
            <tbody>{dados.recorrencias.map((g) => <tr key={g.raiz} className="clicavel" onClick={() => ir(`/gestao/demanda/${g.raiz}`)}><td>{g.servico}</td><td>{g.localidade ?? '—'}</td><td className="num">{g.total}</td><td className="num">{g.abertas}</td><td className="pequeno">{fmtData(g.ultimo, false)}</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}

interface Alerta { id: number; tipo: string; severidade: 'ALTA' | 'MEDIA' | 'BAIXA'; titulo: string; descricao: string; secretaria: string | null; localidade: string | null; demanda_id: number | null; protocolo: string | null; status: string; atualizado_em: string; observacao: string | null }
type Sug = AnaliseIa & { id: number; demandaId: number; protocolo: string; status: string; criadoEm: string };

export function IaAlertas() {
  const { pode } = useEstado();
  const [status, setStatus] = useState('ABERTO');
  const alertas = useDados<Alerta[]>(`/gestao/alertas?status=${status}`);
  const sugestoes = useDados<Sug[]>('/gestao/ia/sugestoes');
  const [msg, setMsg] = useState<string | null>(null);
  const tratar = (id: number, s: string) => {
    const observacao = s === 'DESCARTADO' ? prompt('Motivo do descarte (fica na auditoria):') ?? undefined : undefined;
    void post(`/gestao/alertas/${id}`, { status: s, observacao }).then(alertas.recarregar).catch((e: Error) => setMsg(e.message));
  };
  const cor = { ALTA: 'var(--critico)', MEDIA: 'var(--aviso)', BAIXA: 'var(--info)' };
  return (
    <>
      <div className="linha entre">
        <h1>Alertas e IA</h1>
        {pode('alerta.tratar') && <button className="botao sec" onClick={() => void post('/gestao/alertas/recalcular').then(alertas.recarregar)}>↻ Recalcular alertas</button>}
      </div>
      <Aviso>A IA apenas <strong>sugere</strong>: classificação, prioridade, resumos, recorrências e alertas. Toda decisão é de uma pessoa e fica registrada na auditoria.</Aviso>
      {msg && <Aviso tipo="erro">{msg}</Aviso>}
      <div className="grade g2" style={{ alignItems: 'start' }}>
        <div className="cartao">
          <div className="linha entre"><h2>Alertas</h2>
            <select aria-label="Situação dos alertas" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
              <option value="ABERTO">Abertos</option><option value="RECONHECIDO">Reconhecidos</option><option value="RESOLVIDO">Resolvidos</option><option value="DESCARTADO">Descartados</option>
            </select>
          </div>
          {!alertas.dados ? <Carregando /> : alertas.dados.length === 0 ? <p className="mudo">Nenhum alerta.</p> : (
            <div className="coluna">
              {alertas.dados.map((a) => (
                <div key={a.id} className="cartao" style={{ borderLeft: `4px solid ${cor[a.severidade]}`, padding: 12 }}>
                  <div className="linha entre"><strong>{a.titulo}</strong><span className="etq">{a.severidade === 'ALTA' ? '⚠ Alta' : a.severidade === 'MEDIA' ? '● Média' : 'Baixa'}</span></div>
                  <p className="pequeno sec" style={{ margin: '4px 0' }}>{a.descricao}</p>
                  <div className="linha pequeno mudo">{a.secretaria} {a.localidade && `· ${a.localidade}`} · {fmtData(a.atualizado_em)}</div>
                  {a.observacao && <p className="pequeno">Obs.: {a.observacao}</p>}
                  <div className="linha" style={{ marginTop: 6 }}>
                    {a.demanda_id && <button className="botao sec peq" onClick={() => ir(`/gestao/demanda/${a.demanda_id}`)}>Abrir {a.protocolo}</button>}
                    {pode('alerta.tratar') && a.status === 'ABERTO' && <><button className="botao sec peq" onClick={() => tratar(a.id, 'RECONHECIDO')}>Reconhecer</button><button className="botao sec peq" onClick={() => tratar(a.id, 'DESCARTADO')}>Descartar</button></>}
                    {pode('alerta.tratar') && a.status === 'RECONHECIDO' && <button className="botao sec peq" onClick={() => tratar(a.id, 'RESOLVIDO')}>Marcar resolvido</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cartao">
          <h2>Sugestões aguardando decisão</h2>
          {!sugestoes.dados ? <Carregando /> : sugestoes.dados.length === 0 ? <p className="mudo">Nenhuma pendente.</p> : (
            <table><tbody>{sugestoes.dados.map((s) => (
              <tr key={s.id} className="clicavel" onClick={() => ir(`/gestao/demanda/${s.demandaId}`)}>
                <td><strong>{s.protocolo}</strong><div className="pequeno">{s.resumo}</div><div className="pequeno mudo">Sugere: {s.classificacao[0]?.servico ?? '—'} ({Math.round((s.classificacao[0]?.confianca ?? 0) * 100)}%) · {s.prioridade} · {s.provedor}</div></td>
              </tr>
            ))}</tbody></table>
          )}
        </div>
      </div>
    </>
  );
}

interface RelatorioLista { id: number; titulo: string; narrativaStatus: string; provedor: string; criadoEm: string; autor: string }
interface Relatorio { id: number; titulo: string; filtros: Record<string, string>; conteudo: Indicadores; narrativa: string; narrativa_status: string; provedor: string; criado_em: string }

export function Relatorios() {
  const { partes } = useRota();
  const { pode } = useEstado();
  const lista = useDados<RelatorioLista[]>('/gestao/relatorios');
  const [f, setF] = useState<Record<string, string>>({});
  const [titulo, setTitulo] = useState(`Relatório de atendimento – ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (partes[2]) return <VerRelatorio id={Number(partes[2])} />;
  return (
    <>
      <h1>Relatórios</h1>
      {pode('relatorio.gerar') && (
        <div className="cartao" style={{ marginBottom: 16 }}>
          <h2>Gerar novo relatório</h2>
          <div className="campo"><label htmlFor="r-t">Título</label><input id="r-t" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
          <FiltrosDemanda f={f} setF={setF} campos={['periodo', 'secretaria', 'setor', 'servico', 'localidade', 'status']} />
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <button className="botao" disabled={gerando} onClick={() => { setGerando(true); void post<{ id: number }>('/gestao/relatorios', { titulo, filtros: f }).then((r) => ir(`/gestao/relatorios/${r.id}`)).catch((e: Error) => setErro(e.message)).finally(() => setGerando(false)); }}>{gerando ? 'Gerando…' : 'Gerar relatório com análise'}</button>
          <p className="ajuda">A análise em texto é um rascunho produzido por IA a partir dos números; o gestor revisa e aprova antes de divulgar.</p>
        </div>
      )}
      <div className="cartao">
        <h2>Relatórios gerados</h2>
        {!lista.dados ? <Carregando /> : (
          <table><thead><tr><th>Título</th><th>Análise</th><th>Autor</th><th>Data</th></tr></thead>
            <tbody>{lista.dados.map((r) => <tr key={r.id} className="clicavel" onClick={() => ir(`/gestao/relatorios/${r.id}`)}><td>{r.titulo}</td><td><span className="etq">{r.narrativaStatus === 'REVISADO' ? '✓ revisada' : 'rascunho IA'}</span></td><td>{r.autor}</td><td className="pequeno">{fmtData(r.criadoEm)}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}

function VerRelatorio({ id }: { id: number }) {
  const { pode } = useEstado();
  const { dados: r, erro, recarregar } = useDados<Relatorio>(`/gestao/relatorios/${id}`);
  const [edicao, setEdicao] = useState<string | null>(null);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!r) return <Carregando />;
  return (
    <>
      <p className="nao-imprimir"><a href="#/gestao/relatorios">← Relatórios</a></p>
      <div className="linha entre"><h1>{r.titulo}</h1><button className="botao sec nao-imprimir" onClick={() => window.print()}>🖨 Imprimir / PDF</button></div>
      <p className="pequeno sec">Gerado em {fmtData(r.criado_em)} · Período: {r.filtros['de'] ?? 'início'} a {r.filtros['ate'] ?? 'hoje'} · Prefeitura Municipal de Sertânia</p>
      <div className="cartao" style={{ marginBottom: 16 }}>
        <div className="linha entre"><h2>Análise</h2><span className="etq">{r.narrativa_status === 'REVISADO' ? '✓ Revisada pelo gestor' : `Rascunho gerado por IA (${r.provedor}) – requer revisão`}</span></div>
        {edicao === null ? (
          <>
            {r.narrativa.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
            {pode('relatorio.gerar') && <button className="botao sec peq nao-imprimir" onClick={() => setEdicao(r.narrativa)}>Revisar texto</button>}
          </>
        ) : (
          <>
            <textarea value={edicao} onChange={(e) => setEdicao(e.target.value)} style={{ minHeight: 260 }} aria-label="Texto da análise" />
            <div className="linha" style={{ marginTop: 8 }}><button className="botao" onClick={() => void api('PATCH', `/gestao/relatorios/${id}`, { narrativa: edicao }).then(() => { setEdicao(null); recarregar(); })}>Salvar como revisado</button><button className="botao sec" onClick={() => setEdicao(null)}>Cancelar</button></div>
          </>
        )}
      </div>
      <ConteudoIndicadores i={r.conteudo} />
    </>
  );
}

