// Utilitarios compartilhados pelos scripts de apresentacao (capturas, PDF e video).
// Usa o Chrome instalado na maquina (channel: 'chrome'), sem baixar navegadores.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SAIDA = path.join(RAIZ, 'apresentacao');
export const CAPTURAS = path.join(SAIDA, 'capturas');
export const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
// Conta de demonstracao criada pelo seed do proprio projeto (banco de demonstracao local).
export const CONTA_DEMO = { email: 'admin@sertania.demo', senha: 'Sertania2026' };

fs.mkdirSync(CAPTURAS, { recursive: true });

export async function abrirNavegador() {
  return chromium.launch({ channel: 'chrome', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
}

/** Contexto com tema claro e preferencias limpas. */
export async function novoContexto(nav, opcoes = {}) {
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'pt-BR', timezoneId: 'America/Recife', ...opcoes });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('preferencias', JSON.stringify({ theme: 'light', contraste: '', texto: '', movimento: '' }));
      localStorage.setItem('primeiros-passos-fechado', '1');
      localStorage.removeItem('entrada');
    } catch { /* ignora */ }
  });
  return ctx;
}

export async function entrar(ctx) {
  const r = await ctx.request.post(`${BASE}/api/auth/entrar`, { data: CONTA_DEMO });
  if (!r.ok()) throw new Error(`Login de demonstracao falhou: ${r.status()}`);
}

export async function ir(page, rota, espera = 900) {
  await page.goto(`${BASE}/#${rota}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(espera);
}

export const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
