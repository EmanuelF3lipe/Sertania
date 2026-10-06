/**
 * Area institucional.
 *
 * A fila usa os endpoints reais e nao copia regras de autorizacao para o
 * navegador. Os comandos possiveis sao derivados da tabela oficial de
 * transicoes em `@sertania/contracts`; a autorizacao final continua no
 * servidor e um conflito de versao pede recarregar o detalhe.
 */
import { useEffect, useRef, useState } from 'react';
import type { WorkflowCommand } from '@sertania/contracts';
import { apiGet, apiPost, ErroApi, limparCacheDeSessao } from '../api/cliente';
import { useSessao } from '../api/sessao';
import type { ContextoVinculo, DetalheOperacao, Pagina, PedidoOperacao } from '../api/tipos';
import { Aviso, Estado } from './comuns';
import { formatarData, formatarDataHora } from './cidadao';
import { GestaoServidores } from './gestao-servidores';
import { Configuracoes } from './configuracoes';
import { Dashboard } from './dashboard';
import { CatalogoAdministrativo } from './catalogo-administrativo';
import { MensagensPedido } from './mensagens';
import { AnexosPedido } from './anexos';
import { ResumoSla } from './sla';

const ROTULOS: Readonly<Record<string, string>> = {
  START_REVIEW: 'Iniciar analise',
  REQUEST_INFORMATION: 'Pedir informacao',
  SCHEDULE: 'Programar atendimento',
  START_EXECUTION: 'Iniciar atendimento',
  COMPLETE: 'Concluir pedido',
  CANCEL: 'Cancelar pedido',
  REOPEN: 'Reabrir pedido',
  DECIDE_REOPEN_APPROVE: 'Aprovar reabertura',
  DECIDE_REOPEN_DENY: 'Negar reabertura',
  RESCHEDULE_TO_REVIEW: 'Voltar para analise',
};

const COMANDOS_COM_JUSTIFICATIVA: readonly WorkflowCommand[] = [
  'REQUEST_INFORMATION',
  'COMPLETE',
  'CANCEL',
  'REOPEN',
  'DECIDE_REOPEN_APPROVE',
  'DECIDE_REOPEN_DENY',
  'RESCHEDULE_TO_REVIEW',
];

export function AreaOperacao({ rota }: { readonly rota: string }) {
  const { sessao, recarregar } = useSessao();
  const [contexto, definirContexto] = useState<string | null>(
    sessao?.contexts.find((item) => item.isCurrent)?.contextId ??
      sessao?.contexts[0]?.contextId ??
      null,
  );
  const contextoInicializado = useRef(false);

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

  useEffect(() => {
    if (
      sessao === null ||
      contextoInicializado.current ||
      sessao.contexts.length === 0 ||
      sessao.contexts.some((item) => item.isCurrent)
    ) {
      return;
    }
    const primeiro = sessao.contexts[0];
    if (primeiro === undefined) return;
    contextoInicializado.current = true;
    void trocarContexto(primeiro.contextId);
  }, [sessao]);

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
              <option key={item.contextId} value={item.contextId}>
                {item.secretariatName}
              </option>
            ))}
          </select>
        </section>
      )}
      {partes[0] === 'configuracoes' ? (
        <Configuracoes />
      ) : partes[0] === 'dashboard' ? (
        <Dashboard />
      ) : partes[0] === 'administracao' && partes[1] === 'servidores' ? (
        <GestaoServidores />
      ) : partes[0] === 'administracao' && partes[1] === 'catalogo' ? (
        <CatalogoAdministrativo />
      ) : partes[0] === 'pedido' && pedidoId !== undefined ? (
        <DetalheOperacaoTela id={pedidoId} contexto={atual} />
      ) : (
        <FilaOperacao contexto={atual} />
      )}
    </>
  );
}

function FilaOperacao({ contexto }: { readonly contexto: ContextoVinculo | undefined }) {
  const { sessao } = useSessao();
  const [dados, definirDados] = useState<Pagina<PedidoOperacao> | null>(null);
  const [estado, definirEstado] = useState('');
  const [prioridade, definirPrioridade] = useState('');
  const [classificacao, definirClassificacao] = useState('');
  const [busca, definirBusca] = useState('');
  const [escopo, definirEscopo] = useState('');
  const [pagina, definirPagina] = useState(0);
  const [erro, definirErro] = useState<string | null>(null);
  const [selecionados, definirSelecionados] = useState<readonly string[]>([]);
  const [loteExecutando, definirLoteExecutando] = useState(false);
  const [atualizacao, definirAtualizacao] = useState(0);
  const [ultimaAtualizacao, definirUltimaAtualizacao] = useState<string | null>(null);
  const limite = 20;
  const podeAtribuir =
    contexto?.roles.includes('SECRETARY_MANAGER') === true &&
    sessao?.userId !== null &&
    sessao?.userId !== undefined;

  useEffect(() => {
    let ativo = true;
    definirDados(null);
    definirErro(null);
    const params = new URLSearchParams({ limit: String(limite), offset: String(pagina * limite) });
    if (estado !== '') params.set('state', estado);
    if (prioridade !== '') params.set('priority', prioridade);
    if (classificacao !== '') params.set('classification', classificacao);
    if (busca.trim() !== '') params.set('search', busca.trim());
    if (escopo !== '') params.set('assignee', escopo);
    const carregar = () => {
      apiGet<Pagina<PedidoOperacao>>(`/api/v1/requests?${params.toString()}`)
        .then((resposta) => {
          if (!ativo) return;
          definirDados(resposta);
          definirUltimaAtualizacao(new Date().toISOString());
          definirSelecionados((atuais) =>
            atuais.filter((id) => resposta.items.some((item) => item.id === id)),
          );
        })
        .catch((error: unknown) => {
          if (ativo)
            definirErro(
              error instanceof ErroApi ? error.message : 'Nao foi possivel carregar a fila.',
            );
        });
    };
    carregar();
    const intervalo = window.setInterval(carregar, 60_000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [atualizacao, busca, classificacao, contexto?.contextId, escopo, estado, pagina, prioridade]);

  function limparFiltros() {
    definirEstado('');
    definirPrioridade('');
    definirClassificacao('');
    definirBusca('');
    definirEscopo('');
    definirPagina(0);
    definirSelecionados([]);
  }

  function aplicarFiltroRapido(valor: 'mine' | 'unassigned' | 'urgent' | 'all') {
    definirSelecionados([]);
    definirPagina(0);
    if (valor === 'mine') {
      definirEscopo('mine');
      definirPrioridade('');
    } else if (valor === 'unassigned') {
      definirEscopo('unassigned');
      definirPrioridade('');
    } else if (valor === 'urgent') {
      definirEscopo('');
      definirPrioridade('URGENT');
    } else {
      definirEscopo('');
      definirPrioridade('');
      definirEstado('');
      definirClassificacao('');
      definirBusca('');
    }
  }

  async function assumirSelecionados() {
    if (!podeAtribuir || sessao?.userId === null || sessao?.userId === undefined || dados === null) return;
    const itens = dados.items.filter((item) => selecionados.includes(item.id));
    if (itens.length === 0) return;
    definirLoteExecutando(true);
    definirErro(null);
    let falhas = 0;
    try {
      for (const item of itens) {
        try {
          const resposta = await apiPost<{ ok: boolean }>(`/api/v1/requests/${item.id}/assignment`, {
            expectedVersion: item.version,
            assigneeUserId: sessao.userId,
          });
          if (!resposta.ok) falhas += 1;
        } catch {
          falhas += 1;
        }
      }
      definirSelecionados([]);
      definirAtualizacao((valor) => valor + 1);
      if (falhas > 0) {
        definirErro(`${itens.length - falhas} pedido(s) assumido(s); ${falhas} nao puderam ser atualizados por conflito ou permissao.`);
      }
    } finally {
      definirLoteExecutando(false);
    }
  }

  function exportarCsv() {
    if (dados === null || dados.items.length === 0) return;
    const cabecalho = ['Protocolo', 'Servico', 'Estado', 'Prioridade', 'Recebido em'];
    const linhas = dados.items.map((item) => [
      item.protocol,
      item.serviceName,
      item.stateText,
      item.priority ?? 'NORMAL',
      String(item.createdAt ?? item.submittedAt ?? ''),
    ]);
    const escapar = (valor: string) => `"${valor.replaceAll('"', '""')}"`;
    const csv = [cabecalho, ...linhas].map((linha) => linha.map(escapar).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fila-sertania.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const totalPaginas = dados === null ? 0 : Math.ceil(dados.total / limite);

  return (
    <section className="fila-operacao" aria-labelledby="titulo-fila">
      <div className="pagina-cabecalho fila-cabecalho">
        <div>
          <span className="sobretitulo">Operação municipal</span>
          <h2 id="titulo-fila">Central de solicitações</h2>
          <p className="dica">{contexto?.secretariatName ?? 'Todos os contextos autorizados'} · controle, prioridade e histórico em um só lugar.</p>
        </div>
        <button className="botao-compacto secundario" type="button" onClick={limparFiltros}>Limpar filtros</button>
      </div>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="fila-indicadores">
        <div><span className="fila-indicador-ponto ponto-verde" /><span><strong>{dados?.total ?? '—'}</strong> solicitações encontradas</span></div>
        <div><span className="fila-indicador-ponto ponto-amarelo" /><span>Filtros aplicados: <strong>{[estado, prioridade, classificacao, busca.trim(), escopo].filter(Boolean).length}</strong></span></div>
        <div><span className="fila-indicador-ponto ponto-azul" /><span>Contexto: <strong>{contexto?.secretariatName ?? 'todos'}</strong></span></div>
      </div>
      <div className="fila-ferramentas" aria-label="Ferramentas da fila">
        <div className="fila-filtros-rapidos">
          <span className="filtro-rapido-label">Visao rapida</span>
          <button type="button" className={escopo === '' && prioridade === '' ? 'filtro-rapido ativo' : 'filtro-rapido'} onClick={() => aplicarFiltroRapido('all')}>Todos</button>
          {podeAtribuir && <button type="button" className={escopo === 'mine' ? 'filtro-rapido ativo' : 'filtro-rapido'} onClick={() => aplicarFiltroRapido('mine')}>Minha fila</button>}
          {podeAtribuir && <button type="button" className={escopo === 'unassigned' ? 'filtro-rapido ativo' : 'filtro-rapido'} onClick={() => aplicarFiltroRapido('unassigned')}>Sem responsavel</button>}
          <button type="button" className={prioridade === 'URGENT' ? 'filtro-rapido ativo' : 'filtro-rapido'} onClick={() => aplicarFiltroRapido('urgent')}>Urgentes</button>
        </div>
        <div className="fila-acoes">
          {podeAtribuir && selecionados.length > 0 && (
            <button type="button" disabled={loteExecutando} onClick={() => void assumirSelecionados()}>
              {loteExecutando ? 'Assumindo...' : `Assumir selecionados (${selecionados.length})`}
            </button>
          )}
          <button type="button" className="secundario" onClick={() => definirAtualizacao((valor) => valor + 1)}>Atualizar</button>
          <button type="button" className="secundario" disabled={dados === null || dados.items.length === 0} onClick={exportarCsv}>Exportar CSV</button>
          {ultimaAtualizacao !== null && <span className="fila-atualizada">Atualizado às {new Date(ultimaAtualizacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
      </div>
      <div className="fila-filtros cartao">
        <label className="filtro filtro-busca"><span>Buscar protocolo ou serviço</span><input type="search" value={busca} onChange={(event) => { definirBusca(event.target.value); definirPagina(0); }} placeholder="Ex.: SER-2026 ou iluminação" /></label>
        <label className="filtro"><span>Estado</span><select value={estado} onChange={(event) => { definirEstado(event.target.value); definirPagina(0); }}><option value="">Todos os estados</option><option value="SUBMITTED">Solicitação recebida</option><option value="IN_REVIEW">Em análise</option><option value="WAITING_CITIZEN">Aguardando cidadão</option><option value="SCHEDULED">Agendadas</option><option value="IN_PROGRESS">Em atendimento</option><option value="COMPLETED">Concluídas</option><option value="CANCELED">Canceladas</option></select></label>
        <label className="filtro"><span>Prioridade</span><select value={prioridade} onChange={(event) => { definirPrioridade(event.target.value); definirPagina(0); }}><option value="">Todas</option><option value="URGENT">Urgente</option><option value="HIGH">Alta</option><option value="NORMAL">Normal</option><option value="LOW">Baixa</option></select></label>
        <label className="filtro"><span>Classificação</span><select value={classificacao} onChange={(event) => { definirClassificacao(event.target.value); definirPagina(0); }}><option value="">Todas</option><option value="PUBLIC_APPROVED">Público</option><option value="INTERNAL">Interno</option><option value="RESTRICTED_PERSONAL">Restrito pessoal</option><option value="RESTRICTED_SENSITIVE">Restrito sensível</option></select></label>
      </div>
      {dados === null && erro === null && <Estado titulo="Carregando a fila" />}
      {dados !== null && dados.items.length === 0 && (
        <div className="estado-vazio estado-vazio-fila">
          <span className="estado-vazio-icone" aria-hidden="true">⌕</span><strong>Nenhuma solicitação encontrada</strong>
          <p>Ajuste os filtros ou aguarde novos pedidos chegarem à sua fila.</p>
          <button className="secundario" type="button" onClick={limparFiltros}>Remover filtros</button>
        </div>
      )}
      {dados !== null && dados.items.length > 0 && (
        <>
        <div className="tabela-cartao tabela-fila">
            <table>
              <caption className="sr-only">Solicitações da fila</caption>
              <thead>
                <tr>
                  {podeAtribuir && <th><input type="checkbox" checked={dados.items.length > 0 && dados.items.every((item) => selecionados.includes(item.id))} onChange={(event) => definirSelecionados(event.target.checked ? dados.items.map((item) => item.id) : [])} aria-label="Selecionar pedidos visiveis" /></th>}
                  <th>Protocolo</th>
                <th>Servico</th>
                <th>Prioridade</th>
                <th>Estado</th>
                <th>Progresso do prazo</th>
                <th>Recebido em</th>
                <th><span className="sr-only">Abrir</span></th>
              </tr>
            </thead>
              <tbody>
                {dados.items.map((item) => (
                  <tr key={item.id}>
                    {podeAtribuir && <td><input type="checkbox" checked={selecionados.includes(item.id)} onChange={(event) => definirSelecionados((atuais) => event.target.checked ? [...atuais, item.id] : atuais.filter((id) => id !== item.id))} aria-label={`Selecionar ${item.protocol}`} /></td>}
                    <td>
                    <a href={`#/pedido/${item.id}`}>
                      <strong>{item.protocol}</strong>
                    </a>
                  </td>
                  <td><span className="celula-servico">{item.serviceName ?? 'Serviço municipal'}<small>{item.classification === 'RESTRICTED_SENSITIVE' ? 'Acesso restrito' : 'Atendimento municipal'}</small></span></td>
                  <td><span className={`prioridade prioridade-${(item.priority ?? 'NORMAL').toLowerCase()}`}>{textoPrioridade(item.priority ?? 'NORMAL')}</span></td>
                  <td>
                    <span className={`etiqueta ${classeEstado(item.state)}`}>
                      {item.stateText ?? textoEstado(item.state)}
                    </span>
                  </td>
                  <td><ResumoSla sla={item.sla} /></td>
                  <td>{formatarData(String(item.createdAt ?? item.submittedAt ?? ''))}</td>
                  <td><a className="link-abrir-pedido" href={`#/pedido/${item.id}`} aria-label={`Abrir ${item.protocol}`}>→</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="paginacao-fila"><span>{dados.total === 0 ? '0' : pagina * limite + 1}–{Math.min((pagina + 1) * limite, dados.total)} de {dados.total}</span><div><button className="botao-icone" type="button" disabled={pagina === 0} onClick={() => definirPagina((valor) => Math.max(valor - 1, 0))} aria-label="Página anterior">←</button><span>Página {pagina + 1} de {Math.max(totalPaginas, 1)}</span><button className="botao-icone" type="button" disabled={pagina + 1 >= totalPaginas} onClick={() => definirPagina((valor) => valor + 1)} aria-label="Próxima página">→</button></div></div>
        </>
      )}
    </section>
  );
}

function textoPrioridade(priority: string): string {
  return ({ LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' } as Record<string, string>)[priority] ?? priority;
}

function DetalheOperacaoTela({
  id,
  contexto,
}: {
  readonly id: string;
  readonly contexto: ContextoVinculo | undefined;
}) {
  const { sessao } = useSessao();
  const [detalhe, definirDetalhe] = useState<DetalheOperacao | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [executando, definirExecutando] = useState(false);
  const [comando, definirComando] = useState<WorkflowCommand | null>(null);
  const [texto, definirTexto] = useState('');
  const [resultado, definirResultado] = useState('RESOLVED');
  const [agendamento, definirAgendamento] = useState('');
  const [agendamentoEstimado, definirAgendamentoEstimado] = useState(true);
  const exigeTexto = comando !== null && COMANDOS_COM_JUSTIFICATIVA.includes(comando);

  async function carregar() {
    try {
      definirErro(null);
      definirDetalhe(await apiGet<DetalheOperacao>(`/api/v1/requests/${id}`));
    } catch (error) {
      definirErro(error instanceof ErroApi ? error.message : 'Nao foi possivel carregar o pedido.');
    }
  }

  useEffect(() => {
    void carregar();
    const intervalo = window.setInterval(() => void carregar(), 60_000);
    return () => window.clearInterval(intervalo);
  }, [id, contexto?.contextId]);

  async function executar() {
    if (detalhe === null || comando === null) return;
    let dadosAgendamento: { readonly scheduledFor: string; readonly isEstimate: boolean } | null = null;
    if (comando === 'SCHEDULE') {
      const data = new Date(agendamento);
      if (agendamento.trim() === '' || Number.isNaN(data.getTime()) || data.getTime() <= Date.now()) {
        definirErro('Informe uma data e hora futuras para o atendimento.');
        return;
      }
      dadosAgendamento = {
        scheduledFor: data.toISOString(),
        isEstimate: agendamentoEstimado,
      };
    }
    definirExecutando(true);
    try {
      const resposta = await apiPost<{ ok: boolean; error?: string; version?: number }>(
        `/api/v1/requests/${id}/commands/${comando}`,
        {
          expectedVersion: detalhe.version,
          publicText: texto.trim() || (exigeTexto ? '' : 'Atualizacao registrada pela equipe responsavel.'),
          reason: comando === 'CANCEL' ? texto.trim() || undefined : undefined,
          outcome: comando === 'COMPLETE' ? resultado : undefined,
          justification: comando === 'COMPLETE' ? texto.trim() : undefined,
          ...(dadosAgendamento ?? {}),
        },
      );
      if (!resposta.ok) {
        definirErro(
          resposta.error === 'VERSION_CONFLICT'
            ? 'Este pedido mudou enquanto voce o analisava. Recarregue antes de agir.'
            : `A acao nao foi aplicada (${resposta.error ?? 'permissao negada'}).`,
        );
      } else {
        definirComando(null);
        definirTexto('');
        definirAgendamento('');
        await carregar();
      }
    } catch (error) {
      definirErro(
        error instanceof ErroApi && error.conflito
          ? 'Este pedido mudou enquanto voce o analisava. Recarregue antes de agir.'
          : error instanceof ErroApi
            ? error.message
            : 'Nao foi possivel registrar a providencia.',
      );
    } finally {
      definirExecutando(false);
    }
  }

  if (erro !== null && detalhe === null) return <Aviso tipo="erro">{erro}</Aviso>;
  if (detalhe === null) return <Estado titulo="Carregando o pedido" />;
  const comandos = (detalhe.allowedCommands ?? []).filter(
    (item) => item !== 'SUBMIT' && item !== 'PROVIDE_INFORMATION',
  ) as WorkflowCommand[];
  const podeAtribuir = contexto?.roles.includes('SECRETARY_MANAGER') === true;

  async function atribuirParaMim() {
    if (detalhe === null || sessao?.userId === null || sessao?.userId === undefined) return;
    definirExecutando(true);
    definirErro(null);
    try {
      const resposta = await apiPost<{ ok: boolean; error?: string }>(`/api/v1/requests/${id}/assignment`, {
        expectedVersion: detalhe.version,
        assigneeUserId: sessao.userId,
      });
      if (!resposta.ok) {
        definirErro(resposta.error === 'VERSION_CONFLICT' ? 'Este pedido mudou enquanto voce o analisava. Recarregue antes de agir.' : 'Nao foi possivel atribuir o pedido.');
      } else {
        await carregar();
      }
    } catch (error) {
      definirErro(error instanceof ErroApi ? error.message : 'Nao foi possivel atribuir o pedido.');
    } finally {
      definirExecutando(false);
    }
  }

  return (
    <section aria-labelledby="titulo-pedido-operacao">
      <a className="voltar-link" href="#/fila">
        ← Voltar para a fila
      </a>
      <div className="pagina-cabecalho">
        <div>
          <span className="sobretitulo">Pedido em atendimento</span>
          <h2 id="titulo-pedido-operacao">{detalhe.protocol}</h2>
        </div>
        <span className={`etiqueta ${classeEstado(detalhe.state)}`}>
          {detalhe.stateText ?? textoEstado(detalhe.state)}
        </span>
      </div>
      {erro !== null && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="operacao-grid">
          <article className="cartao">
            <span className="sobretitulo">Solicitacao</span>
            <h3>{detalhe.serviceName ?? 'Servico municipal'}</h3>
            <p className="dica">Classificacao: {detalhe.classification}</p>
              <div className="detalhe-operacional-meta">
                <span><b>Prioridade</b>{textoPrioridade(detalhe.priority ?? 'NORMAL')}</span>
                <span><b>Responsavel</b>{detalhe.assigneeUserId === null || detalhe.assigneeUserId === undefined ? 'Ainda nao atribuido' : detalhe.assigneeUserId === sessao?.userId ? 'Voce' : 'Servidor designado'}</span>
              </div>
              <ResumoSla sla={detalhe.sla} detalhado />
              {detalhe.scheduledFor !== null && (
                <Aviso tipo="info">
                  Atendimento {detalhe.scheduleIsEstimate ? 'previsto' : 'agendado'} para{' '}
                  <strong>{formatarDataHora(detalhe.scheduledFor)}</strong>.
                </Aviso>
              )}
              <p className="descricao-longa">{detalhe.description}</p>
          <h3>Historico</h3>
          <ul className="linha-do-tempo">
            {(detalhe.timeline ?? []).map((evento, index) => (
              <li key={`${evento.at}-${index}`}>
                <time dateTime={String(evento.at)}>{formatarData(String(evento.at))}</time>
                <div>{evento.text ?? 'Atualizacao registrada.'}</div>
              </li>
            ))}
          </ul>
        </article>
          <aside className="cartao painel-acao">
            <span className="sobretitulo">Providencia</span>
            <h3>O que precisa ser feito?</h3>
            {podeAtribuir && (
              <div className="bloco-atribuicao">
                <div><strong>{detalhe.assigneeUserId === sessao?.userId ? 'Pedido atribuido a voce' : 'Responsabilidade'}</strong><small>{detalhe.assigneeUserId === null || detalhe.assigneeUserId === undefined ? 'Ninguem assumiu este pedido ainda.' : detalhe.assigneeUserId === sessao?.userId ? 'Voce recebera o acompanhamento desta solicitacao.' : 'Ja existe um servidor designado.'}</small></div>
                {detalhe.assigneeUserId === sessao?.userId ? <span className="etiqueta etiqueta-ativa">Em sua fila</span> : <button className="secundario botao-compacto" type="button" disabled={executando} onClick={() => void atribuirParaMim()}>Assumir pedido</button>}
              </div>
            )}
          {comandos.length === 0 && (
            <p className="dica">Nao ha transicoes disponiveis para este estado.</p>
          )}
          <div className="acoes-vertical">
            {comandos.map((item) => (
              <button
                key={item}
                className={item === 'CANCEL' ? 'perigo' : ''}
                onClick={() => definirComando(item)}
              >
                {ROTULOS[item] ?? item}
              </button>
            ))}
          </div>
          {comando !== null && (
            <div className="form-acao" aria-label="Confirmar providencia">
              <label className="rotulo" htmlFor="texto-acao">
                Justificativa ou mensagem publica
              </label>
              <textarea
                id="texto-acao"
                value={texto}
                onChange={(event) => definirTexto(event.target.value)}
                placeholder="Escreva o que o cidadao precisa saber..."
              />
              {comando === 'COMPLETE' && (
                <label className="rotulo" htmlFor="resultado">
                  Resultado
                  <select
                    id="resultado"
                    value={resultado}
                    onChange={(event) => definirResultado(event.target.value)}
                  >
                    <option value="RESOLVED">Resolvido</option>
                    <option value="DENIED">Negado</option>
                    <option value="DUPLICATE">Duplicado</option>
                    <option value="OUT_OF_SCOPE">Fora de competencia</option>
                  </select>
                </label>
              )}
              {comando === 'SCHEDULE' && (
                <>
                  <label className="rotulo" htmlFor="agendamento">
                    Data e hora do atendimento
                    <input
                      id="agendamento"
                      type="datetime-local"
                      value={agendamento}
                      min={dataLocalMinima()}
                      onChange={(event) => definirAgendamento(event.target.value)}
                    />
                  </label>
                  <label className="campo-checkbox" htmlFor="agendamento-estimado">
                    <input
                      id="agendamento-estimado"
                      type="checkbox"
                      checked={agendamentoEstimado}
                      onChange={(event) => definirAgendamentoEstimado(event.target.checked)}
                    />
                    <span>Trata-se apenas de uma previsão</span>
                  </label>
                </>
              )}
              <div className="linha">
                <button className="secundario" onClick={() => definirComando(null)}>
                  Voltar
                </button>
                <button
                  onClick={() => void executar()}
                  disabled={executando || (exigeTexto && texto.trim().length < 5)}
                >
                  {executando ? 'Registrando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
      <MensagensPedido requestId={id} serverView />
      <AnexosPedido requestId={id} allowUpload={false} />
    </section>
  );
}

function textoEstado(state: string): string {
  const labels: Readonly<Record<string, string>> = {
    SUBMITTED: 'Solicitacao recebida',
    IN_REVIEW: 'Em analise',
    WAITING_CITIZEN: 'Aguardando cidadao',
    SCHEDULED: 'Atendimento programado',
    IN_PROGRESS: 'Em atendimento',
    COMPLETED: 'Concluida',
    CANCELED: 'Cancelada',
  };
  return labels[state] ?? state;
}

function dataLocalMinima(): string {
  const agora = new Date();
  const deslocado = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return deslocado.toISOString().slice(0, 16);
}
function classeEstado(state: string): string {
  return state === 'COMPLETED' || state === 'CANCELED'
    ? 'etiqueta-fim'
    : state === 'WAITING_CITIZEN'
      ? 'etiqueta-espera'
      : 'etiqueta-ativa';
}
