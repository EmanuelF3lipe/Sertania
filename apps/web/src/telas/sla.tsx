import type { ProgressoSla } from '../api/tipos';

/**
 * Resumo visual do prazo. O componente apenas apresenta a fotografia enviada
 * pela API; nenhum percentual ou vencimento e calculado no navegador.
 */
export function ResumoSla({
  sla,
  detalhado = false,
}: {
  readonly sla: ProgressoSla | null;
  readonly detalhado?: boolean;
}) {
  if (sla === null || sla === undefined) {
    return (
      <div className={`sla-resumo${detalhado ? ' sla-resumo-detalhado' : ''}`}>
        <span className="sla-indisponivel">Prazo nao configurado</span>
      </div>
    );
  }

  const percentual = Math.min(100, Math.max(0, sla.progressPercent));
  const percentualTexto = percentual.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const situacao = sla.overdue
    ? 'Atrasado'
    : sla.paused
      ? 'Pausado'
      : sla.dueAt === null
        ? 'Encerrado'
        : 'Em andamento';
  const classeSituacao = sla.overdue ? 'atrasado' : sla.paused ? 'pausado' : 'normal';
  const prazo = sla.overdue
    ? `Venceu ${sla.dueAt === null ? 'fora do prazo' : formatarDataHora(sla.dueAt)}`
    : sla.paused
      ? 'Relogio congelado'
      : sla.dueAt === null
        ? 'Atendimento encerrado'
        : `Vence ${formatarDataHora(sla.dueAt)}`;

  return (
    <div className={`sla-resumo sla-resumo-${classeSituacao}${detalhado ? ' sla-resumo-detalhado' : ''}`}>
      <div className="sla-resumo-cabecalho">
        <span>
          <b>{detalhado ? 'Prazo de atendimento' : 'SLA'}</b>
          <strong>{percentualTexto}% consumido</strong>
        </span>
        <span className={`sla-status sla-status-${classeSituacao}`}>{situacao}</span>
      </div>
      <div
        className="sla-trilho"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentual}
        aria-label={`Prazo de atendimento: ${percentualTexto}% consumido`}
      >
        <span style={{ width: `${percentual}%` }} />
      </div>
      <div className="sla-resumo-meta">
        <span>
          {sla.dueAt === null && !sla.overdue
            ? 'Prazo encerrado'
            : sla.remainingMinutes > 0
              ? `${formatarMinutos(sla.remainingMinutes, sla.businessUnit)} restantes`
              : 'Sem saldo restante'}
        </span>
        <span>{prazo}</span>
      </div>
      {detalhado && (
        <p className="sla-atualizacao">
          Atualizado pelo servidor em {formatarDataHora(sla.asOf)}.{' '}
          {sla.publishedCommitment
            ? 'Compromisso municipal publicado.'
            : 'Prazo demonstrativo, ainda sem compromisso municipal publicado.'}
        </p>
      )}
    </div>
  );
}

function formatarDataHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return 'data indisponivel';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatarMinutos(minutos: number, businessUnit: boolean): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const restantes = minutos % 60;
  if (horas < 24) return restantes === 0 ? `${horas} h` : `${horas} h ${restantes} min`;
  const minutosPorDia = businessUnit ? 9 * 60 : 24 * 60;
  const dias = Math.floor(minutos / minutosPorDia);
  const horasRestantes = Math.floor((minutos % minutosPorDia) / 60);
  const sufixo = businessUnit ? ' uteis' : '';
  return horasRestantes === 0 ? `${dias} d${sufixo}` : `${dias} d${sufixo} ${horasRestantes} h`;
}
