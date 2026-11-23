// Capturas dos recursos de acessibilidade (painel, pagina e comandos de voz).
// Roda sozinho (node ferramentas/apresentacao/capturar-acessibilidade.mjs) ou no fim do capturar.mjs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirNavegador, novoContexto, ir, CAPTURAS } from './comum.mjs';

export async function capturarAcessibilidade(nav) {
  const foto = async (page, nome, opcoes = {}) => {
    await page.screenshot({ path: path.join(CAPTURAS, `${nome}.png`), ...opcoes });
    console.log('  ✓', nome);
  };
  const ctx = await novoContexto(nav);
  const page = await ctx.newPage();

  await ir(page, '/');
  await page.getByRole('button', { name: /^Acessibilidade/ }).last().click();
  await page.waitForTimeout(600);
  await foto(page, '25-acess-painel');
  await page.keyboard.press('Escape');

  await ir(page, '/acessibilidade');
  await page.waitForTimeout(500);
  await foto(page, '26-acess-pagina');

  // comandos de voz sem microfone: executa as frases direto, como se tivessem sido faladas
  await ir(page, '/nova');
  await page.fill('#desc', 'A lâmpada do poste em frente à escola está apagada há uma semana.');
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /acessibilidade\/painel/.test(n)).pop();
    const m = await import(new URL(url).pathname + new URL(url).search);
    m.executarFrase('mostrar números');
  });
  await page.waitForTimeout(500);
  await foto(page, '27-acess-numeros');
  await ctx.close();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nav = await abrirNavegador();
  await capturarAcessibilidade(nav);
  await nav.close();
}
