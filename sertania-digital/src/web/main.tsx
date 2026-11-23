import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/zilla-slab/700.css';
import './estilos-base.css';
import './estilos.css';
import './estilos-equipe.css';
import './estilos-acess.css';
import { App } from './App';
import { ProvedorEstado } from './nucleo';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProvedorEstado>
      <App />
    </ProvedorEstado>
  </StrictMode>,
);

// PWA: funciona com conexao fraca ou ausente (app shell em cache).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
