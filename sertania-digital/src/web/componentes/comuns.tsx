import { useState, type ReactNode } from 'react';
import { FileText, Paperclip } from 'lucide-react';
import { STATUS_TEXTO, type EventoDto, type Prioridade, type SlaDto, type Status, type AnexoDto } from '../../shared/dominio';
import { fmtData } from '../api';

export const COR_STATUS: Record<Status, string> = {
  RECEBIDA: 'var(--info)',
  ENCAMINHADA: 'var(--info)',
  AGUARDANDO_CIDADAO: 'var(--aviso)',
  AGENDADA: 'var(--info)',
  EM_EXECUCAO: 'var(--primaria)',
  IMPEDIDA: 'var(--serio)',
  CONCLUIDA: 'var(--ok)',
  CANCELADA: 'var(--texto-3)',
};

export function EtqStatus({ status, texto }: { status: Status; texto?: string }) {
  return (
    <span className="etq">
      <i className="p" style={{ background: COR_STATUS[status] }} aria-hidden="true" />
      {texto ?? STATUS_TEXTO[status]}
    </span>
  );
}

const PRIO_TEXTO: Record<Prioridade, string> = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: '▲ Alta', URGENTE: '⚠ Urgente' };
export function EtqPrioridade({ p }: { p: Prioridade }) {
  return <span className={`etq ${p}`}>{PRIO_TEXTO[p]}</span>;
}

export function Sla({ sla, compacto = false }: { sla: SlaDto; compacto?: boolean }) {
  if (!sla.prazoEm) return <span className="mudo">—</span>;
  const cor = sla.pausada ? 'var(--texto-3)' : sla.vencida ? 'var(--critico)' : sla.percentual >= 80 ? 'var(--aviso)' : 'var(--ok)';
  const texto = sla.pausada ? '⏸ Prazo pausado' : sla.vencida ? '⚠ Prazo vencido' : `Prazo: ${fmtData(sla.prazoEm, false)}`;
  return (
    <div title={`Prazo: ${fmtData(sla.prazoEm)} – ${sla.percentual}% consumido`}>
      {!compacto && <div className="pequeno" style={{ color: sla.vencida ? 'var(--critico)' : undefined }}>{texto}</div>}
      {compacto && <div className="pequeno">{sla.pausada ? '⏸ pausado' : sla.vencida ? '⚠ vencido' : fmtData(sla.prazoEm, false)}</div>}
      <div className="barra-sla" role="img" aria-label={`${Math.min(sla.percentual, 100)}% do prazo consumido`}>
        <i style={{ width: `${Math.min(sla.percentual, 100)}%`, background: cor }} />
      </div>
    </div>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok' | 'alerta'; children: ReactNode }) {
  return (
    <div className={`aviso ${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <p className="mudo" role="status">{texto}</p>;
}

export function Abas<T extends string>({ abas, atual, aoMudar }: { abas: Array<[T, string]>; atual: T; aoMudar: (a: T) => void }) {
  return (
    <div className="abas" role="tablist">
      {abas.map(([id, rotulo]) => (
        <button key={id} role="tab" aria-selected={atual === id} onClick={() => aoMudar(id)}>
          {rotulo}
        </button>
      ))}
    </div>
  );
}

export function ListaAnexos({ anexos, baixavel }: { anexos: AnexoDto[]; baixavel: boolean }) {
  if (!anexos.length) return null;
  return (
    <div className="miniaturas">
      {anexos.map((a) => (
        <figure key={a.id}>
          {baixavel && a.mime.startsWith('image/') ? (
            <a href={`/api/gestao/anexos/${a.id}`} target="_blank" rel="noreferrer">
              <img src={`/api/gestao/anexos/${a.id}`} alt={a.nome} loading="lazy" />
            </a>
          ) : baixavel ? (
            <a href={`/api/gestao/anexos/${a.id}`} target="_blank" rel="noreferrer" className="anexo-nome"><FileText size={16} aria-hidden="true" /> {a.nome}</a>
          ) : (
            <span className="anexo-nome"><Paperclip size={16} aria-hidden="true" /> {a.nome}</span>
          )}
          {a.origem === 'INTERNO' && <figcaption className="mudo">interno</figcaption>}
        </figure>
      ))}
    </div>
  );
}

export function LinhaDoTempo({ eventos, baixavel }: { eventos: EventoDto[]; baixavel: boolean }) {
  return (
    <ol className="tempo">
      {[...eventos].reverse().map((e) => (
        <li key={e.id}>
          <div className="linha pequeno">
            <strong>{e.paraStatus && e.deStatus !== e.paraStatus ? STATUS_TEXTO[e.paraStatus] : rotuloEvento(e.tipo)}</strong>
            <span className="mudo">{fmtData(e.criadoEm)}, por {e.autor}</span>
          </div>
          {e.textoPublico && <div>{e.textoPublico}</div>}
          {e.notaInterna && <div className="interno"><strong>Nota interna:</strong> {e.notaInterna}</div>}
          <ListaAnexos anexos={e.anexos} baixavel={baixavel} />
        </li>
      ))}
    </ol>
  );
}

function rotuloEvento(tipo: string): string {
  return ({ REGISTRO_EXECUCAO: 'Registro de execução', ATRIBUICAO: 'Responsável definido', CIDADAO: 'Resposta do cidadão', ENCAMINHAR: 'Encaminhada' } as Record<string, string>)[tipo] ?? tipo;
}

export function Copiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="botao sec peq"
      onClick={() => {
        void navigator.clipboard?.writeText(texto).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? 'Copiado ✓' : rotulo}
    </button>
  );
}

export function Estrelas({ nota }: { nota: number }) {
  return <span aria-label={`${nota} de 5`}>{'★'.repeat(nota)}<span className="mudo">{'★'.repeat(5 - nota)}</span></span>;
}

const ETAPAS = ['Recebida', 'Com o setor responsável', 'Em execução', 'Concluída'] as const;
const ETAPA_DO_STATUS: Record<Status, number> = {
  RECEBIDA: 0, ENCAMINHADA: 1, AGUARDANDO_CIDADAO: 1, AGENDADA: 2, EM_EXECUCAO: 2, IMPEDIDA: 2, CONCLUIDA: 3, CANCELADA: -1,
};
const NOTA_DO_STATUS: Partial<Record<Status, string>> = {
  AGUARDANDO_CIDADAO: 'esperando uma resposta sua',
  AGENDADA: 'atendimento agendado',
  IMPEDIDA: 'parada por um impedimento',
};

/** Onde o pedido esta, em 4 etapas. Para o cidadao entender sem conhecer os nomes internos de situacao. */
export function Jornada({ status }: { status: Status }) {
  const atual = ETAPA_DO_STATUS[status];
  if (atual < 0) return null;
  return (
    <ol className="jornada" aria-label="Andamento">
      {ETAPAS.map((e, i) => {
        const estado = i < atual ? 'feita' : i === atual ? 'atual' : 'futura';
        return (
          <li key={e} className={estado} aria-current={i === atual ? 'step' : undefined}>
            <span className="jo-marca" aria-hidden="true">{i < atual || (i === atual && status === 'CONCLUIDA') ? '✓' : i + 1}</span>
            <span className="jo-nome">{e}</span>
            {i === atual && NOTA_DO_STATUS[status] && <span className="jo-nota">{NOTA_DO_STATUS[status]}</span>}
            <span className="so-leitor">{estado === 'feita' ? ' (concluída)' : estado === 'atual' ? ' (etapa atual)' : ' (ainda não)'}</span>
          </li>
        );
      })}
    </ol>
  );
}
