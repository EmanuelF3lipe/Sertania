import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos.css';
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
