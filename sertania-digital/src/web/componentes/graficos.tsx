/**
 * Graficos em SVG puro: barras horizontais (uma serie, cor unica), linha com
 * duas series (legenda + rotulo direto), tooltip ao passar o mouse/tocar e
 * tabela equivalente para leitores de tela.
 */
import { useRef, useState, type ReactNode } from 'react';

function useDica() {
  const [dica, setDica] = useState<{ x: number; y: number; texto: ReactNode } | null>(null);
  const el = dica ? (
    <div className="dica" style={{ left: Math.min(dica.x + 12, window.innerWidth - 270), top: dica.y + 12 }} role="tooltip">
      {dica.texto}
    </div>
  ) : null;
  return { el, mostrar: (e: { clientX: number; clientY: number }, texto: ReactNode) => setDica({ x: e.clientX, y: e.clientY, texto }), esconder: () => setDica(null) };
}

export interface ItemBarra { nome: string; valor: number; detalhe?: string }

export function BarrasH({ itens, max = 10, sufixo = '', cor = 'var(--sequencial)', titulo }: { itens: ItemBarra[]; max?: number; sufixo?: string; cor?: string; titulo: string }) {
  const d = useDica();
  const lista = itens.slice(0, max);
  const resto = itens.slice(max);
  if (resto.length) lista.push({ nome: `Outros (${resto.length})`, valor: resto.reduce((a, b) => a + b.valor, 0) });
  const maior = Math.max(1, ...lista.map((i) => i.valor));
  const alt = 26;
  const larg = 400;
  const rotulo = 150;
  if (!lista.length) return <p className="mudo">Sem dados no período.</p>;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="grafico" viewBox={`0 0 ${larg} ${lista.length * alt + 4}`} role="img" aria-label={titulo}>
        {lista.map((i, n) => {
          const w = ((larg - rotulo - 50) * i.valor) / maior;
          const y = n * alt;
          return (
            <g key={i.nome} onMouseMove={(e) => d.mostrar(e, <><strong>{i.nome}</strong><br />{i.valor.toLocaleString('pt-BR')}{sufixo}{i.detalhe ? <><br />{i.detalhe}</> : null}</>)} onMouseLeave={d.esconder}>
              <rect x={0} y={y} width={larg} height={alt} fill="transparent" />
              <text x={rotulo - 8} y={y + alt / 2 + 4} textAnchor="end">{i.nome.length > 22 ? `${i.nome.slice(0, 21)}…` : i.nome}</text>
              <rect x={rotulo} y={y + 6} width={Math.max(w, 2)} height={alt - 12} rx={4} fill={cor} />
              <text x={rotulo + Math.max(w, 2) + 6} y={y + alt / 2 + 4} style={{ fill: 'var(--texto)' }}>{i.valor.toLocaleString('pt-BR')}{sufixo}</text>
            </g>
          );
        })}
      </svg>
      {d.el}
      <TabelaOculta titulo={titulo} linhas={lista.map((i) => [i.nome, `${i.valor}${sufixo}`])} />
    </figure>
  );
}

export function LinhaTempo({ pontos, series, titulo }: { pontos: Array<Record<string, number | string>>; series: Array<{ chave: string; nome: string; cor: string }>; titulo: string }) {
  const d = useDica();
  const ref = useRef<SVGSVGElement>(null);
  const [foco, setFoco] = useState<number | null>(null);
  if (pontos.length < 2) return <p className="mudo">Dados insuficientes para a série temporal.</p>;
  const L = 440, A = 210, ml = 28, mb = 24, mt = 10, mr = 78;
  const maior = Math.max(1, ...pontos.flatMap((p) => series.map((s) => Number(p[s.chave]) || 0)));
  const x = (i: number) => ml + (i * (L - ml - mr)) / (pontos.length - 1);
  const y = (v: number) => mt + (A - mt - mb) * (1 - v / maior);
  const ticks = [0, Math.round(maior / 2), maior];
  const passoRotulo = Math.ceil(pontos.length / 6);
  return (
    <figure style={{ margin: 0 }}>
      <div className="legenda">{series.map((s) => <span key={s.chave} style={{ ['--c' as string]: s.cor }}>{s.nome}</span>)}</div>
      <svg
        ref={ref}
        className="grafico"
        viewBox={`0 0 ${L} ${A}`}
        role="img"
        aria-label={titulo}
        onMouseMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * L;
          const i = Math.max(0, Math.min(pontos.length - 1, Math.round(((px - ml) / (L - ml - mr)) * (pontos.length - 1))));
          setFoco(i);
          const p = pontos[i]!;
          d.mostrar(e, <><strong>{String(p['rotulo'])}</strong>{series.map((s) => <div key={s.chave}>{s.nome}: {Number(p[s.chave]).toLocaleString('pt-BR')}</div>)}</>);
        }}
        onMouseLeave={() => { setFoco(null); d.esconder(); }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grade-l" x1={ml} x2={L - mr} y1={y(t)} y2={y(t)} />
            <text x={ml - 6} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {pontos.map((p, i) => (i % passoRotulo === 0 ? <text key={i} x={x(i)} y={A - 6} textAnchor="middle">{String(p['rotulo'])}</text> : null))}
        {series.map((s) => {
          const ult = pontos[pontos.length - 1]!;
          return (
            <g key={s.chave}>
              <polyline fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" points={pontos.map((p, i) => `${x(i)},${y(Number(p[s.chave]) || 0)}`).join(' ')} />
              <text x={L - mr + 6} y={y(Number(ult[s.chave]) || 0) + 4} style={{ fill: 'var(--texto-2)' }}>{s.nome}</text>
            </g>
          );
        })}
        {foco !== null && (
          <g>
            <line x1={x(foco)} x2={x(foco)} y1={mt} y2={A - mb} stroke="var(--texto-3)" strokeWidth={1} />
            {series.map((s) => <circle key={s.chave} cx={x(foco)} cy={y(Number(pontos[foco]![s.chave]) || 0)} r={4} fill={s.cor} stroke="var(--superficie)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {d.el}
      <TabelaOculta titulo={titulo} linhas={pontos.map((p) => [String(p['rotulo']), ...series.map((s) => String(p[s.chave]))])} cabecalho={['Período', ...series.map((s) => s.nome)]} />
    </figure>
  );
}

function TabelaOculta({ titulo, linhas, cabecalho }: { titulo: string; linhas: string[][]; cabecalho?: string[] }) {
  return (
    <details className="pequeno nao-imprimir">
      <summary className="mudo">Ver como tabela</summary>
      <table>
        <caption className="mudo" style={{ textAlign: 'left' }}>{titulo}</caption>
        {cabecalho && <thead><tr>{cabecalho.map((c) => <th key={c}>{c}</th>)}</tr></thead>}
        <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j} className={j ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

export function Kpi({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className="kpi">
      <span className="rot">{rotulo}</span>
      <span className="val" style={alerta ? { color: 'var(--critico)' } : undefined}>{valor}</span>
      {detalhe && <span className="det">{detalhe}</span>}
    </div>
  );
}

/** Agrupa a serie diaria em semanas para leitura mais limpa. */
export function porSemana(serie: Array<{ dia: string; registradas: number; concluidas: number }>) {
  const m = new Map<string, { registradas: number; concluidas: number }>();
  for (const s of serie) {
    const d = new Date(`${s.dia}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const k = d.toISOString().slice(0, 10);
    const g = m.get(k) ?? { registradas: 0, concluidas: 0 };
    g.registradas += s.registradas;
    g.concluidas += s.concluidas;
    m.set(k, g);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => ({ rotulo: `${k.slice(8, 10)}/${k.slice(5, 7)}`, ...g }));
}
