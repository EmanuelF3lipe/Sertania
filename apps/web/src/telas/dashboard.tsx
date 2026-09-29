import { useEffect, useState } from 'react';
import { apiGet, ErroApi } from '../api/cliente';
import { Aviso, Estado } from './comuns';

interface DashboardData {
  readonly total: number;
  readonly completed: number;
  readonly byState: readonly { state: string; total: number }[];
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<DashboardData>('/api/v1/analytics/dashboard')
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof ErroApi ? reason.message : 'Nao foi possivel carregar os indicadores.'));
  }, []);
  if (error !== null) return <Aviso tipo="erro">{error}</Aviso>;
  if (data === null) return <Estado titulo="Carregando indicadores" />;
  return (
    <section aria-labelledby="titulo-dashboard">
      <div className="pagina-cabecalho"><div><span className="sobretitulo">Visao gerencial</span><h2 id="titulo-dashboard">Dashboard</h2></div></div>
      <div className="dashboard-cards">
        <article className="cartao"><span className="sobretitulo">Solicitacoes</span><strong className="numero-indicador">{data.total}</strong><span>Total no escopo autorizado</span></article>
        <article className="cartao"><span className="sobretitulo">Concluidas</span><strong className="numero-indicador">{data.completed}</strong><span>Resolvidas no escopo autorizado</span></article>
      </div>
      <div className="cartao"><h3>Distribuicao por estado</h3><ul className="lista">{data.byState.map((item) => <li key={item.state}><strong>{item.state}</strong><span> {item.total}</span></li>)}</ul></div>
    </section>
  );
}
