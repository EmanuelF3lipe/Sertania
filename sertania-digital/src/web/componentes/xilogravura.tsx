/**
 * Paisagem em xilogravura do sertao: sol nascendo atras da serra, mandacarus e chao riscado a goiva.
 * E o unico elemento ilustrado do portal; o resto da pagina fica quieto.
 */
const raios = Array.from({ length: 17 }, (_, i) => {
  const a = Math.PI + (i * Math.PI) / 16;
  const ang = (d: number) => a + d;
  const p = (r: number, d: number) => `${(930 + r * Math.cos(ang(d))).toFixed(1)},${(214 + r * Math.sin(ang(d))).toFixed(1)}`;
  return `M${p(128, -0.045)} L${p(i % 2 ? 176 : 196, 0)} L${p(128, 0.045)} Z`;
});

/** Mandacaru: tronco com bracos em candelabro e as nervuras cavadas */
function Mandacaru({ x, base, alto, escala = 1 }: { x: number; base: number; alto: number; escala?: number }) {
  const w = 16 * escala;
  const r = w / 2;
  const tronco = `M${x - r} ${base} V${base - alto + r} a${r} ${r} 0 0 1 ${w} 0 V${base} Z`;
  const bw = 12 * escala;
  const br = bw / 2;
  const e1 = { x: x - r - 18 * escala, topo: base - alto * 0.78, junta: base - alto * 0.38 };
  const d1 = { x: x + r + 18 * escala, topo: base - alto * 0.92, junta: base - alto * 0.5 };
  const bracoPath = (b: { x: number; topo: number; junta: number }, lado: 1 | -1) =>
    `M${b.x - br} ${b.junta} V${b.topo + br} a${br} ${br} 0 0 1 ${bw} 0 V${b.junta - bw} ` +
    `H${lado < 0 ? x - r : b.x - br} V${b.junta} Z`;
  const ligacao = (b: { x: number; junta: number }, lado: 1 | -1) =>
    lado < 0 ? `M${b.x - br} ${b.junta} H${x - r + 1} V${b.junta - bw} H${b.x + br} Z` : `M${x + r - 1} ${b.junta} H${b.x + br} V${b.junta - bw} H${x + r - 1} Z`;
  return (
    <g className="xg-mandacaru">
      <path d={tronco} />
      <path d={bracoPath(e1, -1)} />
      <path d={ligacao(e1, -1)} />
      <path d={bracoPath(d1, 1)} />
      <path d={ligacao(d1, 1)} />
      <g className="xg-nervura">
        <path d={`M${x - r * 0.35} ${base - 4} V${base - alto + r + 4}`} />
        <path d={`M${x + r * 0.35} ${base - 4} V${base - alto + r + 4}`} />
        <path d={`M${e1.x} ${e1.junta - bw - 2} V${e1.topo + br + 2}`} />
        <path d={`M${d1.x} ${d1.junta - bw - 2} V${d1.topo + br + 2}`} />
      </g>
    </g>
  );
}

export function Xilogravura({ className = '' }: { className?: string }) {
  // riscos de goiva no chao: tracos curtos e inclinados, como na madeira
  const riscos = Array.from({ length: 70 }, (_, i) => {
    const x = (i * 173) % 1200;
    const y = 232 + ((i * 37) % 44);
    const l = 10 + ((i * 7) % 16);
    return `M${x} ${y} l${l} -3`;
  }).join(' ');
  return (
    <svg className={`xilogravura ${className}`} viewBox="0 0 1200 280" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      {/* sol e raios */}
      <g className="xg-sol">
        {raios.map((d, i) => <path key={i} d={d} />)}
        <circle cx="930" cy="214" r="118" />
      </g>
      <g className="xg-sol-sulco" fill="none">
        <path d="M842 214 a88 88 0 0 1 176 0" />
        <path d="M868 214 a62 62 0 0 1 124 0" />
        <path d="M894 214 a36 36 0 0 1 72 0" />
      </g>
      {/* serra ao fundo */}
      <path className="xg-serra" d="M0 196 L70 170 L120 182 L190 140 L250 168 L320 150 L400 178 L470 160 L560 186 L640 172 L720 196 L800 188 L880 206 L1000 196 L1080 168 L1140 182 L1200 160 V280 H0 Z" />
      <path className="xg-serra-sulco" fill="none" d="M190 140 L214 168 M320 150 L338 170 M470 160 L488 182 M1080 168 L1098 190 M1200 160 L1176 186" />
      {/* chao da caatinga */}
      <path className="xg-chao" d="M0 226 C160 210 300 222 420 216 C560 208 700 226 840 220 C980 214 1100 228 1200 218 V280 H0 Z" />
      <path className="xg-risco" fill="none" d={riscos} />
      <Mandacaru x={150} base={238} alto={128} escala={1.15} />
      <Mandacaru x={318} base={232} alto={78} escala={0.75} />
      <Mandacaru x={1082} base={236} alto={104} escala={0.95} />
      {/* carcara no ceu */}
      <path className="xg-ave" fill="none" d="M560 70 q12 -10 22 0 q10 -10 22 0 M640 96 q8 -7 15 0 q7 -7 15 0" />
    </svg>
  );
}
