// Grava o video de apresentacao navegando pelo sistema (dados de demonstracao).
// Uso: com o "npm run dev" rodando e o ffmpeg no PATH:
//   node ferramentas/apresentacao/gravar-video.mjs
// Captura quadros pelo Chrome DevTools (screencast) e monta o MP4 com ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { abrirNavegador, novoContexto, BASE, SAIDA, CONTA_DEMO, esperar } from './comum.mjs';
import { CSS, MARCA, img } from './slides.mjs';

const LARG = 1280, ALT = 720;
const pastaQuadros = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-video-'));
const pastaCartelas = path.join(pastaQuadros, 'cartelas');
fs.mkdirSync(pastaCartelas);

// ------------------------------------------------------------ cartelas (telas de titulo)
const CSS_CARTELA = `
.cartela { width: ${LARG}px; height: ${ALT}px; display: flex; flex-direction: column; background: linear-gradient(140deg, #11643a 0%, #0b4a2a 60%, #072c19 100%); color: #fff; position: relative; overflow: hidden; }
.cartela .meio { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 96px; gap: 18px; position: relative; z-index: 1; }
.cartela .num { font-family: 'Zilla Slab'; font-weight: 700; font-size: 30px; color: #f0b400; letter-spacing: .04em; }
.cartela h1 { font-size: 74px; }
.cartela p { font-size: 28px; opacity: .92; max-width: 900px; line-height: 1.35; margin: 0; }
.cartela .marca svg { width: 76px; height: 76px; }
.cartela .sol { position: absolute; right: -140px; bottom: -170px; width: 520px; height: 520px; border-radius: 50%; background: radial-gradient(circle, rgba(240,180,0,.95) 0 46%, transparent 47%); }
.cartela .raios { position: absolute; right: -140px; bottom: -170px; width: 520px; height: 520px; border-radius: 50%; background: repeating-conic-gradient(from 0deg, rgba(240,180,0,.55) 0 4deg, transparent 4deg 15deg); -webkit-mask: radial-gradient(circle, transparent 50%, #000 51%, #000 70%, transparent 71%); }
.cartela .fones { display: flex; gap: 28px; margin-top: 10px; }
.cartela .fones img { width: 200px; border: 3px solid #fff; border-radius: 22px; box-shadow: 6px 6px 0 rgba(0,0,0,.35); }
@keyframes sobe { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
.cartela .meio > * { animation: sobe .6s ease-out both; }
.cartela .meio > *:nth-child(2) { animation-delay: .15s; } .cartela .meio > *:nth-child(3) { animation-delay: .3s; } .cartela .meio > *:nth-child(4) { animation-delay: .45s; }
`;
function cartela(nome, miolo) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}${CSS_CARTELA} body{margin:0}</style></head><body><div class="cartela"><div class="cordel"></div><div class="sol"></div><div class="raios"></div><div class="meio">${miolo}</div></div></body></html>`;
  const arq = path.join(pastaCartelas, `${nome}.html`);
  fs.writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

// ------------------------------------------------------------ gravacao por screencast
const nav = await abrirNavegador();
const ctx = await novoContexto(nav, { viewport: { width: LARG, height: ALT } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const quadros = [];
let n = 0;
cdp.on('Page.screencastFrame', async (f) => {
  n += 1;
  const arq = path.join(pastaQuadros, `q${String(n).padStart(6, '0')}.jpg`);
  fs.writeFileSync(arq, Buffer.from(f.data, 'base64'));
  quadros.push({ arq, t: f.metadata.timestamp ?? Date.now() / 1000 });
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* fim */ }
});

// Legenda e cursor desenhados sobre a pagina (somem do app real; so existem na gravacao).
async function camadas() {
  await page.evaluate(() => {
    if (document.getElementById('gv-legenda')) return;
    const st = document.createElement('style');
    st.textContent = `#gv-legenda{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1060px;background:rgba(8,40,24,.94);color:#fff;font:600 22px/1.35 'Atkinson Hyperlegible',system-ui,sans-serif;padding:14px 26px;border-radius:12px;border-left:8px solid #f0b400;box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:2147483646;opacity:0;transition:opacity .35s;text-align:left;pointer-events:none}
    #gv-legenda.on{opacity:1}
    #gv-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform .65s cubic-bezier(.3,.7,.2,1);transform:translate(640px,360px)}
    #gv-cursor svg{filter:drop-shadow(1px 2px 1px rgba(0,0,0,.45))}
    #gv-cursor.clique::after{content:'';position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid #f0b400;animation:gvp .45s ease-out}
    @keyframes gvp{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}`;
    document.head.appendChild(st);
    const l = document.createElement('div'); l.id = 'gv-legenda'; document.body.appendChild(l);
    const c = document.createElement('div'); c.id = 'gv-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 19z" fill="#fff" stroke="#0b3a22" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ultimo = (window).__gvCursor; if (ultimo) c.style.transform = `translate(${ultimo[0]}px,${ultimo[1]}px)`;
    document.body.appendChild(c);
  });
}
async function legenda(texto, segura = 0) {
  await camadas();
  await page.evaluate((t) => {
    const l = document.getElementById('gv-legenda');
    if (!t) { l.classList.remove('on'); return; }
    l.classList.remove('on');
    setTimeout(() => { l.textContent = t; l.classList.add('on'); }, 180);
  }, texto);
  await esperar(500 + segura);
}
async function moverCursor(x, y) {
  await camadas();
  await page.evaluate(([px, py]) => { (window).__gvCursor = [px, py]; document.getElementById('gv-cursor').style.transform = `translate(${px}px,${py}px)`; }, [x, y]);
  await esperar(700);
}
async function esconderLegenda() {
  await page.evaluate(() => document.getElementById('gv-legenda')?.classList.remove('on')).catch(() => undefined);
  await esperar(380);
}
async function clicar(loc, depois = 900, navega = false) {
  if (navega) await esconderLegenda();
  await loc.scrollIntoViewIfNeeded();
  const c = await loc.boundingBox();
  if (c) await moverCursor(c.x + Math.min(c.width / 2, 60), c.y + c.height / 2);
  await page.evaluate(() => { const c = document.getElementById('gv-cursor'); c.classList.remove('clique'); void c.offsetWidth; c.classList.add('clique'); });
  await loc.click();
  await esperar(depois);
}
async function digitar(loc, texto) {
  await clicar(loc, 200);
  await loc.pressSequentially(texto, { delay: 38 });
  await esperar(500);
}
async function rolar(dy, passos = 12) {
  for (let i = 0; i < passos; i++) { await page.mouse.wheel(0, dy / passos); await esperar(45); }
  await esperar(600);
}
async function irPara(rota, espera = 1200) {
  await esconderLegenda();
  await page.goto(`${BASE}/#${rota}`, { waitUntil: 'networkidle' });
  await esperar(espera);
  await camadas();
}
async function mostrarCartela(url, tempo) {
  await esconderLegenda();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await esperar(tempo);
}

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: LARG, maxHeight: ALT, everyNthFrame: 1 });
const inicio = Date.now();

// ============================================================ roteiro
await mostrarCartela(cartela('abertura', `<div class="marca">${MARCA}</div><h1>Sertânia Digital</h1><p>Cada pedido do cidadão, do protocolo à conclusão — com apoio de IA e decisão humana.</p><p style="font-size:20px;opacity:.75">Prefeitura Municipal de Sertânia – PE · Desafio de Transformação Digital</p>`), 5200);

// ---- 1. cidadao
await mostrarCartela(cartela('c1', `<span class="num">1 · O cidadão pede</span><h1>Simples, no celular,<br>sem precisar de conta.</h1>`), 3200);
await irPara('/');
await legenda('O portal da Prefeitura: qualquer pessoa registra e acompanha pedidos, sem criar conta.', 2600);
await rolar(520);
await legenda('Os serviços mais pedidos ficam a um toque, com o prazo de referência de cada um.', 2200);
await rolar(-520, 8);
await clicar(page.getByRole('link', { name: /Registrar solicitação/ }).first(), 1300, true);
await camadas();
await legenda('São 5 passos curtos. Enquanto a pessoa escreve, a IA já sugere o tipo de serviço.', 600);
await digitar(page.locator('#desc'), 'A lâmpada do poste em frente à escola está apagada há uma semana.');
await clicar(page.getByRole('button', { name: /Continuar/ }), 1200);
await legenda('A sugestão aparece pronta. A pessoa confere — e a equipe revisa depois.', 1200);
await clicar(page.locator('main button[aria-pressed]').first(), 1000);
await clicar(page.getByRole('button', { name: /Continuar/ }), 2400);
await legenda('Onde é? Pela localidade, pelo GPS ou tocando no mapa — inclusive nas comunidades rurais.', 1200);
const loc = page.locator('main select').first();
await clicar(loc, 300);
await loc.selectOption({ index: 1 });
await esperar(1600);
const mapa = page.locator('.leaflet-container').first();
const caixa = await mapa.boundingBox();
if (caixa) { await moverCursor(caixa.x + caixa.width * 0.55, caixa.y + caixa.height * 0.45); await page.mouse.click(caixa.x + caixa.width * 0.55, caixa.y + caixa.height * 0.45); }
await esperar(1400);
await legenda('Depois vêm fotos e contato, ambos opcionais. No fim: protocolo e código de acesso.', 2600);

await irPara('/acompanhar?protocolo=SER-2026-000001');
await legenda('Com o protocolo e o código, o cidadão acompanha cada passo — sem login.', 600);
await digitar(page.locator('#c'), 'DEMO01');
await clicar(page.getByRole('button', { name: /Consultar/ }), 1500);
await rolar(420);
await legenda('Ele vê a situação, o prazo e o histórico. Notas internas da equipe nunca aparecem aqui.', 2800);

await mostrarCartela(cartela('fones', `<span class="num">No celular</span><h1 style="font-size:54px">Funciona offline e envia quando o sinal volta.</h1><div class="fones"><img src="${img('21-celular-portal')}"><img src="${img('22-celular-nova')}"><img src="${img('23-celular-meu-dia')}"></div>`), 5000);

// ---- 2. equipe
await mostrarCartela(cartela('c2', `<span class="num">2 · A equipe atende</span><h1>Cada um vê o seu setor,<br>com prazo e responsável.</h1>`), 3200);
await irPara('/entrar');
await legenda('Uma entrada com dois caminhos: a equipe da prefeitura e o cidadão.', 1800);
await clicar(page.getByRole('button', { name: /Sou da equipe/ }), 900, true);
// Conta de demonstracao do proprio projeto, no servidor local de desenvolvimento.
await digitar(page.locator('#e'), CONTA_DEMO.email);
await digitar(page.locator('#s'), CONTA_DEMO.senha);
await clicar(page.getByRole('button', { name: /Entrar na área da equipe/ }), 2200, true);
await camadas();
await legenda('Meu dia: só o escopo da pessoa — setor, secretaria ou município — e o que pede atenção primeiro.', 3000);
await clicar(page.locator('.termometro a').nth(4), 1800, true);
await camadas();
await legenda('A fila tem recortes prontos: triagem, minhas, sem responsável, urgentes, vencidas.', 2400);
await clicar(page.locator('tr.clicavel').first(), 3000, true);
await camadas();
await legenda('A IA sugere serviço, prioridade e resumo. Quem decide é a pessoa — e a decisão fica auditada.', 3200);
await rolar(520);
await legenda('Comandos claros: encaminhar, agendar, iniciar, registrar impedimento e concluir com evidências.', 3000);

// ---- 3. gestao
await mostrarCartela(cartela('c3', `<span class="num">3 · A gestão acompanha</span><h1>Números para decidir,<br>no mapa e no tempo.</h1>`), 3200);
await irPara('/gestao/painel', 2200);
await legenda('Os 8 indicadores do desafio, com filtros por período, secretaria, serviço, situação e localidade.', 2600);
await rolar(760, 16);
await legenda('Todo gráfico vira tabela e exporta em CSV ou JSON, sem dados pessoais.', 2600);
await irPara('/gestao/mapa', 3500);
await legenda('O município no mapa: cor por situação, tamanho por prioridade e focos de recorrência.', 2000);
await clicar(page.locator('.leaflet-control-zoom-in').first(), 2200);
await irPara('/gestao/alertas', 1500);
await legenda('Alertas de prazo, recorrência e picos por localidade — e sugestões da IA esperando decisão.', 3200);

// ---- 4. configuracao
await mostrarCartela(cartela('c4', `<span class="num">4 · A administração configura</span><h1>Pessoas, perfis e regras<br>em um só lugar.</h1>`), 3200);
await irPara('/config?secao=equipe', 1500);
await legenda('A equipe em crachás. Pedidos de nova senha aparecem em destaque.', 2000);
await clicar(page.getByRole('button', { name: /Cadastrar servidor/ }), 1600);
await legenda('Servidor novo recebe senha provisória e cria a dele no primeiro acesso.', 2400);
await page.keyboard.press('Escape');
await esperar(700);
await irPara('/config?secao=permissoes', 1500);
await legenda('Quem pode o quê: a matriz de permissões de todos os perfis, lado a lado.', 2000);
await rolar(420);
await esperar(1200);
await irPara('/config?secao=auditoria', 1500);
await legenda('Cada ação fica numa auditoria encadeada por hash. Qualquer alteração direta é detectada.', 3000);
await clicar(page.getByRole('button', { name: 'Guia desta tela' }), 800);
await legenda('E em toda tela, o botão “?” abre um guia com os passos.', 2600);
await legenda('');

await mostrarCartela(cartela('fim', `<div class="marca">${MARCA}</div><h1>Sertânia Digital</h1><p>Registro · encaminhamento · execução · indicadores · mapa · IA supervisionada · LGPD · dados abertos</p><p style="font-size:20px;opacity:.75">Telas com dados de demonstração. Números não oficiais.</p>`), 5500);

await cdp.send('Page.stopScreencast');
const fim = Date.now();
await nav.close();
console.log(`Gravado: ${quadros.length} quadros em ${((fim - inicio) / 1000).toFixed(0)} s`);

// ------------------------------------------------------------ montagem com ffmpeg
const linhas = [];
for (let i = 0; i < quadros.length; i++) {
  const prox = quadros[i + 1]?.t ?? quadros[i].t + 0.5;
  const dur = Math.max(0.001, prox - quadros[i].t);
  linhas.push(`file '${quadros[i].arq.replace(/\\/g, '/')}'`, `duration ${dur.toFixed(4)}`);
}
linhas.push(`file '${quadros[quadros.length - 1].arq.replace(/\\/g, '/')}'`);
const lista = path.join(pastaQuadros, 'lista.txt');
fs.writeFileSync(lista, linhas.join('\n'));
const saida = path.join(SAIDA, 'Sertania-Digital-apresentacao.mp4');
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista,
  '-vf', `scale=${LARG}:${ALT}:force_original_aspect_ratio=decrease,pad=${LARG}:${ALT}:(ow-iw)/2:(oh-ih)/2:color=0x0b3a22,fps=30,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', saida], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('ffmpeg falhou');
fs.rmSync(pastaQuadros, { recursive: true, force: true });
console.log('Vídeo:', saida, `(${(fs.statSync(saida).size / 1024 / 1024).toFixed(1)} MB)`);
