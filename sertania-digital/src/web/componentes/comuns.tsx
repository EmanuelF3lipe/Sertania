import { useState, type ReactNode } from 'react';
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
            <a href={`/api/gestao/anexos/${a.id}`} target="_blank" rel="noreferrer">📄 {a.nome}</a>
          ) : (
            <span>📎 {a.nome}</span>
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
            <span className="mudo">· {fmtData(e.criadoEm)} · {e.autor}</span>
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
