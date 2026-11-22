import { useEffect, useState } from 'react';
import {
  CANAL_TEXTO, PRIORIDADES, REGRAS, RESULTADOS, RESULTADO_TEXTO, STATUS, STATUS_TEXTO,
  type AnaliseIa, type Comando, type DemandaDetalhe, type DemandaResumo, type Prioridade, type Resultado,
} from '../../shared/dominio';
import { enviarFormulario, fmtData, get, post, qs } from '../api';
import { ir, useDados, useEstado, useRota } from '../nucleo';
import { Aviso, Carregando, EtqPrioridade, EtqStatus, LinhaDoTempo, ListaAnexos, Sla } from '../componentes/comuns';
import { Mapa } from '../componentes/mapa';

export function FiltrosDemanda({ f, setF, campos }: { f: Record<string, string>; setF: (f: Record<string, string>) => void; campos: string[] }) {
  const { catalogo } = useEstado();
  if (!catalogo) return null;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const c = (k: string) => campos.includes(k);
  return (
    <div className="filtros nao-imprimir">
      {c('busca') && <div><label htmlFor="f-b">Buscar</label><input id="f-b" value={f['busca'] ?? ''} onChange={(e) => set('busca', e.target.value)} placeholder="Protocolo ou texto" /></div>}
      {c('periodo') && <div><label htmlFor="f-de">De</label><input id="f-de" type="date" value={f['de'] ?? ''} onChange={(e) => set('de', e.target.value)} /></div>}
      {c('periodo') && <div><label htmlFor="f-ate">Até</label><input id="f-ate" type="date" value={f['ate'] ?? ''} onChange={(e) => set('ate', e.target.value)} /></div>}
      {c('secretaria') && (
        <div><label htmlFor="f-sc">Secretaria</label>
          <select id="f-sc" value={f['secretariaId'] ?? ''} onChange={(e) => setF({ ...f, secretariaId: e.target.value, setorId: '', servicoId: '' })}>
            <option value="">Todas</option>{catalogo.secretarias.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select></div>
      )}
      {c('setor') && (
        <div><label htmlFor="f-st">Setor</label>
          <select id="f-st" value={f['setorId'] ?? ''} onChange={(e) => set('setorId', e.target.value)}>
            <option value="">Todos</option>{catalogo.setores.filter((s) => !f['secretariaId'] || s.secretariaId === Number(f['secretariaId'])).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select></div>
      )}
      {c('servico') && (
        <div><label htmlFor="f-sv">Serviço</label>
          <select id="f-sv" value={f['servicoId'] ?? ''} onChange={(e) => set('servicoId', e.target.value)}>
            <option value="">Todos</option>{catalogo.servicos.filter((s) => (!f['secretariaId'] || s.secretariaId === Number(f['secretariaId'])) && (!f['setorId'] || s.setorId === Number(f['setorId']))).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select></div>
      )}
      {c('localidade') && (
        <div><label htmlFor="f-l">Localidade</label>
          <select id="f-l" value={f['localidadeId'] ?? ''} onChange={(e) => set('localidadeId', e.target.value)}>
            <option value="">Todas</option>{catalogo.localidades.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select></div>
      )}
      {c('status') && (
        <div><label htmlFor="f-s">Situação</label>
          <select id="f-s" value={f['status'] ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Todas</option><option value="ABERTAS">Em aberto</option>{STATUS.map((s) => <option key={s} value={s}>{STATUS_TEXTO[s]}</option>)}
          </select></div>
      )}
      {c('prioridade') && (
        <div><label htmlFor="f-p">Prioridade</label>
          <select id="f-p" value={f['prioridade'] ?? ''} onChange={(e) => set('prioridade', e.target.value)}>
            <option value="">Todas</option>{PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></div>
      )}
      {c('canal') && (
        <div><label htmlFor="f-c">Canal</label>
          <select id="f-c" value={f['canal'] ?? ''} onChange={(e) => set('canal', e.target.value)}>
            <option value="">Todos</option>{Object.entries(CANAL_TEXTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
      )}
      <div><button className="botao sec peq" onClick={() => setF({})}>Limpar filtros</button></div>
    </div>
  );
}

const VISOES: Array<[string, string]> = [['', 'Todas'], ['triagem', 'Para triagem'], ['minhas', 'Minhas'], ['sem_responsavel', 'Sem responsável'], ['urgentes', 'Urgentes'], ['vencidas', 'Prazo vencido']];

export function Fila() {
  const { pode } = useEstado();
  const [f, setF] = useState<Record<string, string>>({ status: 'ABERTAS' });
  const [visao, setVisao] = useState('');
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [f, visao]);
  const { dados, erro, carregando, recarregar } = useDados<{ total: number; itens: DemandaResumo[]; limite: number }>(`/gestao/demandas${qs({ ...f, visao, pagina })}`);
  useEffect(() => {
    const t = setInterval(recarregar, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className="linha entre">
        <h1>Fila de atendimento</h1>
        <div className="linha nao-imprimir">
          {pode('demanda.registrar_assistido') && <a className="botao" href="#/gestao/assistido">+ Atendimento assistido</a>}
          <a className="botao sec" href={`/api/gestao/exportar${qs({ ...f, formato: 'csv' })}`}>Exportar CSV</a>
          <button className="botao sec" onClick={recarregar}>↻ Atualizar</button>
        </div>
      </div>
      <div className="abas" role="tablist">
        {VISOES.map(([v, r]) => <button key={v} role="tab" aria-selected={visao === v} onClick={() => setVisao(v)}>{r}</button>)}
      </div>
      <FiltrosDemanda f={f} setF={setF} campos={['busca', 'periodo', 'secretaria', 'setor', 'servico', 'localidade', 'status', 'prioridade', 'canal']} />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <div className="cartao rolagem-x">
          <p className="pequeno mudo">{dados.total} solicitação(ões)</p>
          <table>
            <thead><tr><th>Protocolo</th><th>Serviço / local</th><th>Situação</th><th>Prioridade</th><th>Prazo</th><th>Responsável</th></tr></thead>
            <tbody>
              {dados.itens.map((d) => (
                <tr key={d.id} className="clicavel" tabIndex={0} onClick={() => ir(`/gestao/demanda/${d.id}`)} onKeyDown={(e) => e.key === 'Enter' && ir(`/gestao/demanda/${d.id}`)}>
                  <td><strong>{d.protocolo}</strong><div className="pequeno mudo">{fmtData(d.criadaEm)} · {CANAL_TEXTO[d.canal]}</div></td>
                  <td>{d.servico}{d.recorrente && <span className="etq" style={{ marginLeft: 6 }} title="Há registros semelhantes no mesmo local">↻ recorrente</span>}<div className="pequeno mudo">{d.setor} · {d.localidade ?? 'sem localidade'}</div></td>
                  <td><EtqStatus status={d.status} /></td>
                  <td><EtqPrioridade p={d.prioridade} /></td>
                  <td style={{ minWidth: 120 }}><Sla sla={d.sla} compacto /></td>
                  <td className="pequeno">{d.responsavel ?? <span className="mudo">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dados.total > dados.limite && (
            <div className="linha" style={{ marginTop: 12 }}>
              <button className="botao sec peq" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
              <span className="pequeno">Página {pagina} de {Math.ceil(dados.total / dados.limite)}</span>
              <button className="botao sec peq" disabled={pagina * dados.limite >= dados.total} onClick={() => setPagina(pagina + 1)}>Próxima →</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

type DetalheGestao = DemandaDetalhe & {
  similares: Array<{ id: number; protocolo: string; status: string; criada_em: string; distancia: number | null; semelhanca: number }>;
  sugestaoIa: (AnaliseIa & { id: number; status: string; criadoEm: string }) | null;
  notificacoes: Array<{ canal: string; destino: string; mensagem: string; criadoEm: string }>;
};

export function DetalheDemanda() {
  const { partes } = useRota();
  const id = Number(partes[2]);
  const { usuario, pode, catalogo } = useEstado();
  const { dados: d, erro, recarregar } = useDados<DetalheGestao>(`/gestao/demandas/${id}`);
  const [cmd, setCmd] = useState<Comando | null>(null);
  const [form, setForm] = useState<{ textoPublico: string; notaInterna: string; servicoId: string; resultado: Resultado | ''; agendadaPara: string; prioridade: Prioridade | '' }>({ textoPublico: '', notaInterna: '', servicoId: '', resultado: '', agendadaPara: '', prioridade: '' });
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; t: string } | null>(null);
  const [responsaveis, setResponsaveis] = useState<Array<{ id: number; nome: string }>>([]);
  const [nota, setNota] = useState({ texto: '', publico: false });
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [analisando, setAnalisando] = useState(false);

  useEffect(() => {
    if (d && pode('demanda.atribuir')) get<Array<{ id: number; nome: string }>>(`/gestao/responsaveis?setorId=${d.setorId}`).then(setResponsaveis).catch(() => setResponsaveis([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.setorId]);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!d || !catalogo) return <Carregando />;

  const executar = async () => {
    if (!cmd) return;
    setMsg(null);
    try {
      await post(`/gestao/demandas/${d.id}/comandos/${cmd}`, {
        versao: d.versao, textoPublico: form.textoPublico || undefined, notaInterna: form.notaInterna || undefined,
        servicoId: form.servicoId ? Number(form.servicoId) : undefined, resultado: form.resultado || undefined,
        agendadaPara: form.agendadaPara || undefined, prioridade: form.prioridade || undefined,
      });
      setCmd(null);
      setForm({ textoPublico: '', notaInterna: '', servicoId: '', resultado: '', agendadaPara: '', prioridade: '' });
      setMsg({ tipo: 'ok', t: `${REGRAS[cmd].rotulo}: feito. O cidadão foi avisado quando havia contato.` });
      recarregar();
    } catch (e) {
      setMsg({ tipo: 'erro', t: (e as Error).message });
    }
  };

  const abrirCmd = (c: Comando) => {
    setCmd(c);
    const s = d.sugestaoIa;
    setForm((f) => ({ ...f, servicoId: c === 'ENCAMINHAR' ? String(s?.status !== 'REJEITADA' && s?.classificacao[0]?.servicoId ? s.classificacao[0].servicoId : d.servicoId) : '', prioridade: c === 'ENCAMINHAR' && s ? s.prioridade : '' }));
  };

  const decidirIa = async (decisao: 'ACEITA' | 'AJUSTADA' | 'REJEITADA') => {
    if (!d.sugestaoIa) return;
    await post(`/gestao/ia/sugestoes/${d.sugestaoIa.id}/decidir`, { decisao }).catch((e: Error) => setMsg({ tipo: 'erro', t: e.message }));
    if (decisao !== 'REJEITADA' && d.comandos.includes('ENCAMINHAR')) abrirCmd('ENCAMINHAR');
    recarregar();
  };

  const regra = cmd ? REGRAS[cmd] : null;
  const local = d.lat !== null && d.lng !== null ? { lat: d.lat, lng: d.lng } : null;

  return (
    <>
      <p className="nao-imprimir"><a href="#/gestao/fila">← Voltar à fila</a></p>
      <div className="linha entre">
        <div>
          <h1 style={{ marginBottom: 4 }}>{d.protocolo}</h1>
          <div className="linha"><EtqStatus status={d.status} /><EtqPrioridade p={d.prioridade} />{d.recorrente && <span className="etq">↻ recorrente</span>}<span className="pequeno mudo">Ciclo {d.ciclo} · {CANAL_TEXTO[d.canal]} · aberta em {fmtData(d.criadaEm)}</span></div>
        </div>
        <button className="botao sec nao-imprimir" onClick={() => window.print()}>🖨 Imprimir</button>
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}

      <div className="grade g2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div className="coluna">
          <div className="cartao">
            <h2>{d.servico}</h2>
            <p className="pequeno sec">{d.secretaria} · {d.setor}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{d.descricao}</p>
            <p className="pequeno"><strong>Local:</strong> {[d.localidade, d.endereco, d.referencia].filter(Boolean).join(' · ') || '—'}</p>
            <Sla sla={d.sla} />
            {d.agendadaPara && <p className="pequeno">Agendada para <strong>{fmtData(d.agendadaPara, false)}</strong></p>}
            {d.resultado && <p className="pequeno">Resultado: <strong>{RESULTADO_TEXTO[d.resultado]}</strong></p>}
            {d.avaliacao && <p className="pequeno">Avaliação do cidadão: {'★'.repeat(d.avaliacao.nota)} {d.avaliacao.comentario}</p>}
            <ListaAnexos anexos={d.anexos.filter((a) => a.origem === 'CIDADAO')} baixavel />
          </div>

          <div className="cartao">
            <h3>Solicitante</h3>
            {d.solicitante?.anonima ? <p className="mudo">Registro anônimo.</p> : (
              <p className="pequeno">{d.solicitante?.nome ?? '—'}<br />{d.solicitante?.telefone ?? ''} {d.solicitante?.email ?? ''}</p>
            )}
            {d.dadosPessoaisOcultos && <p className="ajuda">Dados minimizados para o seu perfil (LGPD).</p>}
          </div>

          {local && <Mapa baixo selecao={local} />}

          {d.similares.length > 0 && (
            <div className="cartao">
              <h3>Registros semelhantes (90 dias, mesmo serviço e local)</h3>
              <table><tbody>{d.similares.map((s) => (
                <tr key={s.id} className="clicavel" onClick={() => ir(`/gestao/demanda/${s.id}`)}><td>{s.protocolo}</td><td className="pequeno">{STATUS_TEXTO[s.status as keyof typeof STATUS_TEXTO]}</td><td className="pequeno">{fmtData(s.criada_em, false)}</td><td className="pequeno num">{s.distancia !== null ? `${s.distancia} m` : `${Math.round(s.semelhanca * 100)}% texto`}</td></tr>
              ))}</tbody></table>
            </div>
          )}
        </div>

        <div className="coluna">
          {pode('ia.usar') && (
            <div className="cartao" style={{ borderColor: 'var(--info)' }}>
              <div className="linha entre"><h3>🤖 Apoio da IA</h3><button className="botao sec peq" disabled={analisando} onClick={() => { setAnalisando(true); void post(`/gestao/demandas/${d.id}/analisar`).finally(() => { setAnalisando(false); recarregar(); }); }}>{analisando ? 'Analisando…' : d.sugestaoIa ? 'Reanalisar' : 'Analisar'}</button></div>
              {!d.sugestaoIa && <p className="mudo pequeno">Nenhuma sugestão ainda.</p>}
              {d.sugestaoIa && (
                <>
                  <p className="pequeno"><strong>Resumo:</strong> {d.sugestaoIa.resumo}</p>
                  <p className="pequeno"><strong>Serviço sugerido:</strong></p>
                  <ol className="pequeno">{d.sugestaoIa.classificacao.map((c) => <li key={c.servicoId}>{c.servico} <span className="mudo">({c.secretaria}) – confiança {Math.round(c.confianca * 100)}%</span>{c.servicoId === d.servicoId ? ' ✓ atual' : ''}</li>)}</ol>
                  <p className="pequeno"><strong>Prioridade sugerida:</strong> {d.sugestaoIa.prioridade} <span className="mudo">– {d.sugestaoIa.motivoPrioridade}</span></p>
                  <p className="ajuda">Gerado por IA {d.sugestaoIa.provedor === 'claude' ? '(Claude, texto sem dados pessoais)' : '(local, sem envio externo)'} em {fmtData(d.sugestaoIa.criadoEm)}. É apenas sugestão: confira antes de usar.</p>
                  {d.sugestaoIa.status === 'PENDENTE' && pode('ia.decidir') ? (
                    <div className="linha">
                      <button className="botao peq" onClick={() => void decidirIa('ACEITA')}>Aceitar</button>
                      <button className="botao sec peq" onClick={() => void decidirIa('AJUSTADA')}>Usar com ajustes</button>
                      <button className="botao sec peq" onClick={() => void decidirIa('REJEITADA')}>Rejeitar</button>
                    </div>
                  ) : <p className="pequeno">Decisão humana: <strong>{d.sugestaoIa.status}</strong></p>}
                </>
              )}
            </div>
          )}

          {d.comandos.length > 0 && (
            <div className="cartao">
              <h3>Ações</h3>
              <div className="linha">{d.comandos.map((c) => <button key={c} className={`botao ${cmd === c ? '' : 'sec'} peq`} onClick={() => abrirCmd(c)}>{REGRAS[c].rotulo}</button>)}</div>
              {cmd && regra && (
                <div style={{ marginTop: 12 }}>
                  {regra.exigeSetor && (
                    <div className="campo"><label htmlFor="c-sv">Serviço / setor de destino</label>
                      <select id="c-sv" value={form.servicoId} onChange={(e) => setForm({ ...form, servicoId: e.target.value })}>
                        {catalogo.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome} — {catalogo.setores.find((x) => x.id === s.setorId)?.nome}</option>)}
                      </select></div>
                  )}
                  {cmd === 'ENCAMINHAR' && (
                    <div className="campo"><label htmlFor="c-p">Prioridade</label>
                      <select id="c-p" value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Prioridade })}>
                        <option value="">Manter ({d.prioridade})</option>{PRIORIDADES.map((p) => <option key={p}>{p}</option>)}
                      </select></div>
                  )}
                  {regra.exigeResultado && (
                    <div className="campo"><label htmlFor="c-r">Resultado</label>
                      <select id="c-r" value={form.resultado} onChange={(e) => setForm({ ...form, resultado: e.target.value as Resultado })}>
                        <option value="">Escolha…</option>{RESULTADOS.map((r) => <option key={r} value={r}>{RESULTADO_TEXTO[r]}</option>)}
                      </select></div>
                  )}
                  {regra.exigeData && <div className="campo"><label htmlFor="c-d">Data prevista</label><input id="c-d" type="date" value={form.agendadaPara} onChange={(e) => setForm({ ...form, agendadaPara: e.target.value })} /></div>}
                  <div className="campo"><label htmlFor="c-t">Mensagem ao cidadão {regra.exigeTexto ? '(obrigatória)' : '(opcional)'}</label><textarea id="c-t" value={form.textoPublico} onChange={(e) => setForm({ ...form, textoPublico: e.target.value })} placeholder="Linguagem simples, sem siglas internas" /></div>
                  <div className="campo"><label htmlFor="c-n">Nota interna (não aparece ao cidadão)</label><textarea id="c-n" style={{ minHeight: 60 }} value={form.notaInterna} onChange={(e) => setForm({ ...form, notaInterna: e.target.value })} /></div>
                  <div className="linha"><button className="botao" onClick={() => void executar()}>Confirmar: {regra.rotulo}</button><button className="botao sec" onClick={() => setCmd(null)}>Cancelar</button></div>
                </div>
              )}
            </div>
          )}

          {pode('demanda.atribuir') && d.status !== 'CONCLUIDA' && d.status !== 'CANCELADA' && (
            <div className="cartao">
              <h3>Responsável</h3>
              <select aria-label="Responsável" value={d.responsavelId ?? ''} onChange={(e) => void post(`/gestao/demandas/${d.id}/atribuir`, { responsavelId: e.target.value ? Number(e.target.value) : null, versao: d.versao }).then(recarregar).catch((er: Error) => setMsg({ tipo: 'erro', t: er.message }))}>
                <option value="">Sem responsável</option>
                {responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}{r.id === usuario?.id ? ' (eu)' : ''}</option>)}
              </select>
            </div>
          )}

          {pode('demanda.executar', 'demanda.triagem') && d.comandos.length > 0 && (
            <div className="cartao">
              <h3>Registro de execução / evidências</h3>
              <textarea value={nota.texto} onChange={(e) => setNota({ ...nota, texto: e.target.value })} placeholder="O que foi feito, material usado, impedimentos…" aria-label="Registro de execução" />
              <input type="file" multiple accept="image/*,application/pdf" capture="environment" onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 5))} style={{ marginTop: 8 }} />
              <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={nota.publico} onChange={(e) => setNota({ ...nota, publico: e.target.checked })} /><span>Mostrar este registro e as fotos ao cidadão</span></label>
              <button className="botao peq" style={{ marginTop: 8 }} disabled={!nota.texto && !arquivos.length} onClick={() => void enviarFormulario(`/gestao/demandas/${d.id}/anotacoes`, nota.publico ? { textoPublico: nota.texto, visivelCidadao: true } : { notaInterna: nota.texto }, arquivos).then(() => { setNota({ texto: '', publico: false }); setArquivos([]); recarregar(); }).catch((e: Error) => setMsg({ tipo: 'erro', t: e.message }))}>Registrar</button>
            </div>
          )}

          <div className="cartao">
            <h3>Histórico</h3>
            <LinhaDoTempo eventos={d.eventos} baixavel />
          </div>

          {d.notificacoes.length > 0 && (
            <details className="cartao pequeno">
              <summary>Avisos enviados ao cidadão ({d.notificacoes.length})</summary>
              <ul>{d.notificacoes.map((n, i) => <li key={i}>{fmtData(n.criadoEm)} · {n.canal} {n.destino}: {n.mensagem}</li>)}</ul>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
