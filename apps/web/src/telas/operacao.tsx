/**
 * Area institucional.
 *
 * A fila usa os endpoints reais e nao copia regras de autorizacao para o
 * navegador. Os comandos possiveis sao derivados da tabela oficial de
 * transicoes em `@sertania/contracts`; a autorizacao final continua no
 * servidor e um conflito de versao pede recarregar o detalhe.
 */
import { useEffect, useState } from 'react';
import type { WorkflowCommand } from '@sertania/contracts';
import { apiGet, apiPost, ErroApi, limparCacheDeSessao } from '../api/cliente';
import { useSessao } from '../api/sessao';
import type { ContextoVinculo, DetalheOperacao, Pagina, PedidoOperacao } from '../api/tipos';
import { Aviso, Estado } from './comuns';
import { formatarData } from './cidadao';
import { GestaoServidores } from './gestao-servidores';

const ROTULOS: Readonly<Record<string, string>> = {
  START_REVIEW: 'Iniciar analise',
  REQUEST_INFORMATION: 'Pedir informacao',
  SCHEDULE: 'Programar atendimento',
  START_EXECUTION: 'Iniciar atendimento',
  COMPLETE: 'Concluir pedido',
  CANCEL: 'Cancelar pedido',
  REOPEN: 'Reabrir pedido',
  RESCHEDULE_TO_REVIEW: 'Voltar para analise',
};

export function AreaOperacao({ rota }: { readonly rota: string }) {
  const { sessao, recarregar } = useSessao();
  const [contexto, definirContexto] = useState<string | null>(
    sessao?.contexts.find((item) => item.isCurrent)?.contextId ?? sessao?.contexts[0]?.contextId ?? null,
  );

  if (sessao === null) return <Estado titulo="Carregando seu contexto institucional" />;

  async function trocarContexto(membershipId: string) {
    try {
      await apiPost<{ ok: boolean }>('/api/v1/auth/context', { membershipId });
      limparCacheDeSessao();
      definirContexto(membershipId);
      await recarregar();
    } catch {
      // A mensagem fica no componente de fila depois da nova leitura. O
      // servidor sempre revalida o vinculo atual antes de trocar contexto.
      await recarregar();
    }
  }

  const atual = sessao.contexts.find((item) => item.contextId === contexto) ?? sessao.contexts[0];
  const partes = rota.split('/').filter(Boolean);
  const pedidoId = partes[1];

  return (
    <>
      {sessao.contexts.length > 1 && (
        <section className="contexto-barra" aria-label="Contexto institucional atual">
          <label htmlFor="contexto">Atuando em</label>
          <select
            id="contexto"
            value={atual?.contextId ?? ''}
            onChange={(event) => void trocarContexto(event.target.value)}
          >
            {sessao.contexts.map((item) => (
              <option key={item.contextId} value={item.contextId}>{item.secretariatName}</option>
            ))}
          </select>
        </section>
      )}
      {partes[0] === 'administracao' && partes[1] === 'servidores' ? (
        <GestaoServidores />
      ) : partes[0] === 'pedido' && pedidoId !== undefined ? (
        <DetalheOperacaoTela id={pedidoId} contexto={atual} />
      ) : (
        <FilaOperacao contexto={atual} />
      )}
    </>
  );
}

function FilaOperacao({ contexto }: { readonly contexto: ContextoVinculo | undefined }) {
  const [dados, definirDados] = useState<Pagina<PedidoOperacao> | null>(null);
  const [estado, definirEstado] = useState('');
  const [erro, definirErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const query = estado === '' ? '' : `&state=${encodeURIComponent(estado)}`;
    apiGet<Pagina<PedidoOperacao>>(`/api/v1/requests?limit=50${query}`)
      .then((resposta) => { if (ativo) definirDados(resposta); })
      .catch((error: unknown) => {
        if (ativo) definirErro(error instanceof ErroApi ? error.message : 'Nao foi possivel carregar a fila.');
      });
    return () => { ativo = false; };
  }, [estado, contexto?.contextId]);

  return (
    <section aria-labelledby="titulo-fila">
      <div className="pagina-cabecalho">
        <div>
          <span className="sobretitulo">Operacao municipal</span>
          <h2 id="titulo-fila">Fila de atendimento</h2>
          <p className="dica">{contexto?.secretariatName ?? 'Todos os contextos autorizados'}</p>
        </div>
        <label className="filtro">
          <span>Filtrar estado</span>
          <select value={estado} onChange={(event) => definirEstado(event.target.value)}>
            <option value="">Todos os pedidos</option>
            <option value="SUBMITTED">Solicitacao recebida</option>
            <option value="IN_REVIEW">Em analise</option>
            <option value="WAITING_CITIZEN">Aguardando cidadao</option>
            <option value="IN_PROGRESS">Em atendimento</option>
          </select>
        </label>
      </div>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      {dados === null && erro === null && <Estado titulo="Carregando a fila" />}
      {dados !== null && dados.items.length === 0 && (
        <div className="estado-vazio">
          <strong>Nenhum pedido nesta fila</strong>
          <p>Novas solicitacoes aparecerao aqui quando forem recebidas.</p>
        </div>
      )}
      {dados !== null && dados.items.length > 0 && (
        <div className="tabela-cartao">
          <table>
            <caption className="sr-only">Solicitacoes da fila</caption>
            <thead><tr><th>Protocolo</th><th>Servico</th><th>Estado</th><th>Recebido em</th></tr></thead>
            <tbody>
              {dados.items.map((item) => (
                <tr key={item.id}>
                  <td><a href={`#/pedido/${item.id}`}><strong>{item.protocol}</strong></a></td>
                  <td>{item.serviceName ?? 'Servico municipal'}</td>
                  <td><span className={`etiqueta ${classeEstado(item.state)}`}>{item.stateText ?? textoEstado(item.state)}</span></td>
                  <td>{formatarData(String(item.createdAt ?? item.submittedAt ?? ''))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DetalheOperacaoTela({ id, contexto }: { readonly id: string; readonly contexto: ContextoVinculo | undefined }) {
  const [detalhe, definirDetalhe] = useState<DetalheOperacao | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [executando, definirExecutando] = useState(false);
  const [comando, definirComando] = useState<WorkflowCommand | null>(null);
  const [texto, definirTexto] = useState('');
  const [resultado, definirResultado] = useState('RESOLVED');

  async function carregar() {
    try {
      definirErro(null);
      definirDetalhe(await apiGet<DetalheOperacao>(`/api/v1/requests/${id}`));
    } catch (error) {
      definirErro(error instanceof ErroApi ? error.message : 'Nao foi possivel carregar o pedido.');
    }
  }

  useEffect(() => { void carregar(); }, [id, contexto?.contextId]);

  async function executar() {
    if (detalhe === null || comando === null) return;
    definirExecutando(true);
    try {
      const resposta = await apiPost<{ ok: boolean; error?: string; version?: number }>(
        `/api/v1/requests/${id}/commands/${comando}`,
        {
          expectedVersion: detalhe.version,
          publicText: texto.trim() || 'Atualizacao registrada pela equipe responsavel.',
          reason: texto.trim() || undefined,
          outcome: comando === 'COMPLETE' ? resultado : undefined,
          justification: comando === 'COMPLETE' ? texto.trim() : undefined,
        },
      );
      if (!resposta.ok) {
        definirErro(resposta.error === 'VERSION_CONFLICT'
          ? 'Este pedido mudou enquanto voce o analisava. Recarregue antes de agir.'
          : `A acao nao foi aplicada (${resposta.error ?? 'permissao negada'}).`);
      } else {
        definirComando(null);
        definirTexto('');
        await carregar();
      }
    } catch (error) {
      definirErro(error instanceof ErroApi && error.conflito
        ? 'Este pedido mudou enquanto voce o analisava. Recarregue antes de agir.'
        : error instanceof ErroApi ? error.message : 'Nao foi possivel registrar a providencia.');
    } finally {
      definirExecutando(false);
    }
  }

  if (erro !== null && detalhe === null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (detalhe === null) return <Estado titulo="Carregando o pedido" />;
  const comandos = (detalhe.allowedCommands ?? []).filter((item) => item !== 'SUBMIT' && item !== 'PROVIDE_INFORMATION') as WorkflowCommand[];

  return (
    <section aria-labelledby="titulo-pedido-operacao">
      <a className="voltar-link" href="#/fila">← Voltar para a fila</a>
      <div className="pagina-cabecalho">
        <div><span className="sobretitulo">Pedido em atendimento</span><h2 id="titulo-pedido-operacao">{detalhe.protocol}</h2></div>
        <span className={`etiqueta ${classeEstado(detalhe.state)}`}>{detalhe.stateText ?? textoEstado(detalhe.state)}</span>
      </div>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="operacao-grid">
        <article className="cartao">
          <span className="sobretitulo">Solicitacao</span>
          <h3>{detalhe.serviceName ?? 'Servico municipal'}</h3>
          <p className="dica">Classificacao: {detalhe.classification}</p>
          <p className="descricao-longa">{detalhe.description}</p>
          <h3>Historico</h3>
          <ul className="linha-do-tempo">
            {(detalhe.timeline ?? []).map((evento, index) => (
              <li key={`${evento.at}-${index}`}><time dateTime={String(evento.at)}>{formatarData(String(evento.at))}</time><div>{evento.text ?? 'Atualizacao registrada.'}</div></li>
            ))}
          </ul>
        </article>
        <aside className="cartao painel-acao">
          <span className="sobretitulo">Providencia</span>
          <h3>O que precisa ser feito?</h3>
          {comandos.length === 0 && <p className="dica">Nao ha transicoes disponiveis para este estado.</p>}
          <div className="acoes-vertical">
            {comandos.map((item) => <button key={item} className={item === 'CANCEL' ? 'perigo' : ''} onClick={() => definirComando(item)}>{ROTULOS[item] ?? item}</button>)}
          </div>
          {comando !== null && (
            <div className="form-acao" aria-label="Confirmar providencia">
              <label className="rotulo" htmlFor="texto-acao">Justificativa ou mensagem publica</label>
              <textarea id="texto-acao" value={texto} onChange={(event) => definirTexto(event.target.value)} placeholder="Escreva o que o cidadao precisa saber..." />
              {comando === 'COMPLETE' && <label className="rotulo" htmlFor="resultado">Resultado<select id="resultado" value={resultado} onChange={(event) => definirResultado(event.target.value)}><option value="RESOLVED">Resolvido</option><option value="DENIED">Negado</option><option value="DUPLICATE">Duplicado</option><option value="OUT_OF_SCOPE">Fora de competencia</option></select></label>}
              <div className="linha"><button className="secundario" onClick={() => definirComando(null)}>Voltar</button><button onClick={() => void executar()} disabled={executando || (comando === 'COMPLETE' && texto.trim().length < 5)}>{executando ? 'Registrando...' : 'Confirmar'}</button></div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function textoEstado(state: string): string {
  const labels: Readonly<Record<string, string>> = {
    SUBMITTED: 'Solicitacao recebida', IN_REVIEW: 'Em analise', WAITING_CITIZEN: 'Aguardando cidadao',
    SCHEDULED: 'Atendimento programado', IN_PROGRESS: 'Em atendimento', COMPLETED: 'Concluida', CANCELED: 'Cancelada',
  };
  return labels[state] ?? state;
}
function classeEstado(state: string): string { return state === 'COMPLETED' || state === 'CANCELED' ? 'etiqueta-fim' : state === 'WAITING_CITIZEN' ? 'etiqueta-espera' : 'etiqueta-ativa'; }
