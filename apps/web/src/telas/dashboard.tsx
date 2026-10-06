import { useCallback, useEffect, useState } from 'react';
import { apiGet, ErroApi } from '../api/cliente';
import { Aviso, Estado } from './comuns';
import { formatarData } from './cidadao';

interface DashboardData {
  readonly total: number;
  readonly completed: number;
  readonly open: number;
  readonly waitingCitizen: number;
  readonly urgent: number;
  readonly byState?: readonly { state: string; total: number }[];
  readonly bySecretariat?: readonly { id: string; name: string; total: number; open: number }[];
  readonly byService?: readonly { name: string; total: number }[];
  readonly recent?: readonly {
    id: string;
    protocol: string;
    serviceName: string;
    secretariatName: string;
    state: string;
    createdAt: string;
    priority: string;
  }[];
}

const ESTADOS: Readonly<Record<string, string>> = {
  SUBMITTED: 'Recebidas',
  IN_REVIEW: 'Em análise',
  WAITING_CITIZEN: 'Aguardando cidadão',
  SCHEDULED: 'Programadas',
  IN_PROGRESS: 'Em atendimento',
  COMPLETED: 'Concluídas',
  CANCELED: 'Canceladas',
};

const PRIORIDADES: Readonly<Record<string, string>> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const carregar = useCallback(async () => {
    setError(null);
    try {
      setData(await apiGet<DashboardData>('/api/v1/analytics/dashboard'));
    } catch (reason: unknown) {
      setError(reason instanceof ErroApi ? reason.message : 'Não foi possível carregar os indicadores.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function atualizar() {
    setRefreshing(true);
    try {
      await carregar();
    } finally {
      setRefreshing(false);
    }
  }

  if (error !== null && data === null) return <Aviso tipo="erro">{error}</Aviso>;
  if (data === null) return <Estado titulo="Carregando indicadores da operação" />;

  const byState = data.byState ?? [];
  const bySecretariat = data.bySecretariat ?? [];
  const byService = data.byService ?? [];
  const recent = data.recent ?? [];
  const open = data.open ?? Math.max(data.total - data.completed, 0);
  const waitingCitizen = data.waitingCitizen ?? 0;
  const urgent = data.urgent ?? 0;
  const maxState = Math.max(...byState.map((item) => item.total), 1);
  const maxService = Math.max(...byService.map((item) => item.total), 1);

  return (
    <section className="painel-gerencial" aria-labelledby="titulo-dashboard">
      <div className="pagina-cabecalho painel-gerencial-cabecalho">
        <div>
          <span className="sobretitulo">Visão gerencial</span>
          <h2 id="titulo-dashboard">Painel da prefeitura</h2>
          <p className="dica">Acompanhe o volume, a prioridade e o ritmo de atendimento do seu escopo.</p>
        </div>
        <button className="botao-compacto secundario" type="button" onClick={() => void atualizar()} disabled={refreshing}>
          <span aria-hidden="true">↻</span> {refreshing ? 'Atualizando...' : 'Atualizar dados'}
        </button>
      </div>

      {error !== null && <Aviso tipo="erro">{error}</Aviso>}

      <div className="indicadores-gerenciais">
        <article className="indicador-gerencial indicador-destaque">
          <span className="indicador-icone" aria-hidden="true">Σ</span>
          <div><span className="sobretitulo">No seu escopo</span><strong>{data.total}</strong><span>solicitações registradas</span></div>
        </article>
        <article className="indicador-gerencial">
          <span className="indicador-icone indicador-verde" aria-hidden="true">↗</span>
          <div><span className="sobretitulo">Em aberto</span><strong>{open}</strong><span>precisam de acompanhamento</span></div>
        </article>
        <article className="indicador-gerencial">
          <span className="indicador-icone indicador-azul" aria-hidden="true">✓</span>
          <div><span className="sobretitulo">Concluídas</span><strong>{data.completed}</strong><span>atendimentos finalizados</span></div>
        </article>
        <article className="indicador-gerencial">
          <span className="indicador-icone indicador-amarelo" aria-hidden="true">◷</span>
          <div><span className="sobretitulo">Aguardando cidadão</span><strong>{waitingCitizen}</strong><span>dependem de informação</span></div>
        </article>
        <article className="indicador-gerencial indicador-alerta">
          <span className="indicador-icone indicador-vermelho" aria-hidden="true">!</span>
          <div><span className="sobretitulo">Prioridade urgente</span><strong>{urgent}</strong><span>exigem atenção imediata</span></div>
        </article>
      </div>

      <div className="dashboard-linhas">
        <article className="cartao painel-dados">
          <div className="painel-dados-cabecalho"><div><span className="sobretitulo">Fluxo de atendimento</span><h3>Solicitações por estado</h3></div><span className="painel-legenda">Total: {data.total}</span></div>
          <div className="barras-estados">
            {byState.length === 0 && <p className="dica">Ainda não há solicitações neste escopo.</p>}
            {byState.map((item) => (
              <div className="barra-estado" key={item.state}>
                <div className="barra-estado-label"><span>{ESTADOS[item.state] ?? item.state}</span><strong>{item.total}</strong></div>
                <div className="barra-estado-trilho"><span style={{ width: `${Math.max((item.total / maxState) * 100, item.total > 0 ? 4 : 0)}%` }} /></div>
              </div>
            ))}
          </div>
        </article>

        <article className="cartao painel-dados">
          <div className="painel-dados-cabecalho"><div><span className="sobretitulo">Visão por área</span><h3>Secretarias</h3></div><a className="link-pequeno" href="#/administracao/catalogo">Gerenciar catálogo →</a></div>
          <div className="lista-secretarias-dashboard">
            {bySecretariat.map((item) => (
              <div className="linha-secretaria-dashboard" key={item.id}>
                <span className="avatar-secretaria" aria-hidden="true">{item.name.charAt(0)}</span>
                <div><strong>{item.name}</strong><small>{item.open} em aberto · {item.total} no total</small></div>
                <span className="numero-secretaria">{item.total}</span>
              </div>
            ))}
            {bySecretariat.length === 0 && <p className="dica">Nenhuma secretaria no escopo atual.</p>}
          </div>
        </article>
      </div>

      <div className="dashboard-linhas dashboard-linhas-inferior">
        <article className="cartao painel-dados">
          <div className="painel-dados-cabecalho"><div><span className="sobretitulo">Demanda mais frequente</span><h3>Serviços procurados</h3></div></div>
          <div className="barras-servicos">
            {byService.map((item) => (
              <div className="barra-servico" key={item.name}><div><span>{item.name}</span><strong>{item.total}</strong></div><div className="barra-estado-trilho"><span style={{ width: `${Math.max((item.total / maxService) * 100, item.total > 0 ? 4 : 0)}%` }} /></div></div>
            ))}
            {byService.length === 0 && <p className="dica">Sem dados de serviço para exibir.</p>}
          </div>
        </article>
        <article className="cartao painel-dados">
          <div className="painel-dados-cabecalho"><div><span className="sobretitulo">Ação rápida</span><h3>Próximos passos</h3></div></div>
          <div className="atalhos-gerenciais">
            <a href="#/fila"><span aria-hidden="true">→</span><div><strong>Revisar a fila</strong><small>Veja pedidos que aguardam providência.</small></div></a>
            <a href="#/administracao/catalogo"><span aria-hidden="true">⌘</span><div><strong>Publicar um serviço</strong><small>Atualize o catálogo sem apagar o histórico.</small></div></a>
            <a href="#/administracao/servidores"><span aria-hidden="true">+</span><div><strong>Convidar servidor</strong><small>Crie um novo acesso com escopo definido.</small></div></a>
          </div>
        </article>
      </div>

      <article className="cartao painel-dados painel-recentes">
        <div className="painel-dados-cabecalho"><div><span className="sobretitulo">Agora</span><h3>Solicitações recentes</h3></div><a className="link-pequeno" href="#/fila">Abrir fila completa →</a></div>
        {recent.length === 0 ? <p className="dica">Não há solicitações recentes para o escopo atual.</p> : (
          <div className="tabela-recentes">
            {recent.map((item) => (
              <a className="linha-recente" href={`#/pedido/${item.id}`} key={item.id}>
                <span className="protocolo-recente">{item.protocol}</span>
                <span className="detalhe-recente"><strong>{item.serviceName}</strong><small>{item.secretariatName} · {formatarData(item.createdAt)}</small></span>
                <span className={`etiqueta ${classeEstado(item.state)}`}>{ESTADOS[item.state] ?? item.state}</span>
                <span className={`prioridade prioridade-${item.priority.toLowerCase()}`}>{PRIORIDADES[item.priority] ?? item.priority}</span>
              </a>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

function classeEstado(state: string): string {
  return state === 'COMPLETED' || state === 'CANCELED'
    ? 'etiqueta-fim'
    : state === 'WAITING_CITIZEN'
      ? 'etiqueta-espera'
      : 'etiqueta-ativa';
}
