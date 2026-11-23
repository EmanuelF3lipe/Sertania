// Gera apresentacao/Sertania-Digital-apresentacao.pdf a partir das capturas.
// Uso: node ferramentas/apresentacao/montar-pdf.mjs  (rode antes capturar.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirNavegador, SAIDA } from './comum.mjs';
import { documento, slides } from './slides.mjs';

const html = documento(slides().join('\n'));
const arquivoHtml = path.join(SAIDA, 'apresentacao.html');
fs.writeFileSync(arquivoHtml, html);

const nav = await abrirNavegador();
const page = await nav.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(arquivoHtml).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const pdf = path.join(SAIDA, 'Sertania-Digital-apresentacao.pdf');
await page.pdf({ path: pdf, width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
await nav.close();
console.log('PDF:', pdf, `(${(fs.statSync(pdf).size / 1024 / 1024).toFixed(1)} MB)`);
