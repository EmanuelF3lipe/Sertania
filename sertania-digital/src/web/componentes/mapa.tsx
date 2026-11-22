import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const CENTRO_SERTANIA: [number, number] = [-8.0733, -37.2646];

export interface PontoMapa {
  id: number | string;
  lat: number;
  lng: number;
  cor: string;
  raio?: number;
  rotulo: string;
  aoClicar?: () => void;
  tracejado?: boolean;
}

function corCss(v: string): string {
  if (!v.startsWith('var(')) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || '#11643a';
}

/** Mapa base (OpenStreetMap). Sem internet, os pontos continuam visiveis sobre fundo liso. */
export function Mapa({ pontos = [], circulos = [], selecao, aoSelecionar, baixo, zoom = 11, centro }: {
  pontos?: PontoMapa[];
  circulos?: PontoMapa[];
  selecao?: { lat: number; lng: number } | null;
  aoSelecionar?: (p: { lat: number; lng: number }) => void;
  baixo?: boolean;
  zoom?: number;
  centro?: [number, number];
}) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const marcador = useRef<L.CircleMarker | null>(null);
  const cb = useRef(aoSelecionar);
  cb.current = aoSelecionar;

  useEffect(() => {
    if (!div.current || mapa.current) return;
    const m = L.map(div.current, { center: centro ?? CENTRO_SERTANIA, zoom, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    camada.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    mapa.current = m;
    return () => {
      m.stop();
      m.off();
      m.remove();
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = camada.current;
    if (!g) return;
    g.clearLayers();
    for (const c of circulos)
      L.circle([c.lat, c.lng], { radius: c.raio ?? 300, color: corCss(c.cor), weight: 2, fillOpacity: 0.15, dashArray: c.tracejado ? '4 4' : undefined })
        .bindTooltip(c.rotulo)
        .addTo(g);
    for (const p of pontos) {
      const mk = L.circleMarker([p.lat, p.lng], { radius: p.raio ?? 6, color: '#ffffff', weight: 2, fillColor: corCss(p.cor), fillOpacity: 0.95, dashArray: p.tracejado ? '2 2' : undefined })
        .bindTooltip(p.rotulo)
        .addTo(g);
      if (p.aoClicar) mk.on('click', p.aoClicar);
    }
  }, [pontos, circulos]);

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (marcador.current) {
      marcador.current.remove();
      marcador.current = null;
    }
    if (selecao) {
      marcador.current = L.circleMarker([selecao.lat, selecao.lng], { radius: 10, color: '#ffffff', weight: 3, fillColor: corCss('var(--critico)'), fillOpacity: 1 }).addTo(m);
      m.setView([selecao.lat, selecao.lng], Math.max(m.getZoom(), 15), { animate: false });
    }
  }, [selecao]);

  useEffect(() => {
    if (centro && mapa.current) mapa.current.setView(centro, zoom, { animate: false });
  }, [centro, zoom]);

  return <div ref={div} className={`mapa${baixo ? ' baixo' : ''}`} role="application" aria-label="Mapa de Sertânia" />;
}
