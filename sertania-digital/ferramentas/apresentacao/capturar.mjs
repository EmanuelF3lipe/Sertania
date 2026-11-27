// Captura as telas do sistema (dados de demonstracao) para o PDF de apresentacao.
// Uso: com o "npm run dev" rodando, execute  node ferramentas/apresentacao/capturar.mjs
import path from 'node:path';
import { abrirNavegador, novoContexto, entrar, ir, CAPTURAS } from './comum.mjs';
import { capturarAcessibilidade } from './capturar-acessibilidade.mjs';

const nav = await abrirNavegador();
const foto = async (page, nome, opcoes = {}) => {
  await page.screenshot({ path: path.join(CAPTURAS, `${nome}.png`), ...opcoes });
  console.log('  ✓', nome);
};

// ------------------------------------------------------------ cidadao (sem login)
{
  const ctx = await novoContexto(nav);
  const page = await ctx.newPage();
  await ir(page, '/');
  await foto(page, '01-portal');

  await ir(page, '/nova');
  await page.fill('#desc', 'A lâmpada do poste em frente à escola está apagada há uma semana e a rua fica muito escura.');
  await page.waitForTimeout(1800);
  await foto(page, '02-nova-descricao');
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.waitForTimeout(800);
  await page.locator('main button[aria-pressed]').first().click();
  await page.waitForTimeout(400);
  await foto(page, '02b-nova-servico');
  await foto(page, '02c-recorte-servico', { clip: { x: 320, y: 100, width: 800, height: 640 } });
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.waitForTimeout(2500);
  await foto(page, '03-nova-local');
  await foto(page, '03c-recorte-local', { clip: { x: 320, y: 100, width: 800, height: 640 } });

  await ir(page, '/acompanhar?protocolo=SER-2026-000001');
  await page.fill('#c', 'DEMO01');
  await page.getByRole('button', { name: /Consultar/ }).click();
  await page.waitForTimeout(1500);
  await foto(page, '04-acompanhar');

  await ir(page, '/transparencia', 1500);
  await foto(page, '05-transparencia');

  await ir(page, '/entrar');
  await foto(page, '06-entrada');
  await foto(page, '06c-recorte-entrada', { clip: { x: 340, y: 0, width: 760, height: 620 } });
  await page.getByRole('button', { name: /Sou da equipe/ }).click();
  await page.waitForTimeout(400);
  await foto(page, '07-entrada-equipe');
  await foto(page, '07c-recorte-equipe', { clip: { x: 340, y: 0, width: 760, height: 620 } });
  await page.getByRole('button', { name: /Trocar caminho/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Sou cidadão/ }).click();
  await page.waitForTimeout(400);
  await foto(page, '07b-entrada-cidadao');
  await ctx.close();
}

// ------------------------------------------------------------ equipe (administracao de demonstracao)
{
  const ctx = await novoContexto(nav);
  await entrar(ctx);
  const page = await ctx.newPage();
  await ir(page, '/equipe', 1500);
  await foto(page, '08-meu-dia');

  await ir(page, '/gestao/fila', 1500);
  await foto(page, '09-fila');

  await ir(page, '/gestao/fila?visao=triagem', 1500);
  await page.locator('tr.clicavel').first().click();
  await page.waitForTimeout(4000);
  const analisar = page.getByRole('button', { name: /^Analisar$/ });
  if (await analisar.count()) { await analisar.click(); await page.waitForTimeout(2000); }
  await foto(page, '10-demanda');
  await page.getByRole('heading', { name: /Apoio da IA/ }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(400);
  await foto(page, '11-demanda-ia');

  await ir(page, '/gestao/painel', 2500);
  await foto(page, '12-indicadores');
  await page.evaluate(() => window.scrollBy(0, 820));
  await page.waitForTimeout(600);
  await foto(page, '13-indicadores-graficos');

  await ir(page, '/gestao/mapa', 4000);
  await foto(page, '14-mapa');

  await ir(page, '/gestao/alertas', 1500);
  await foto(page, '15-alertas');

  await ir(page, '/gestao/relatorios', 1500);
  await foto(page, '16-relatorios');

  await ir(page, '/config?secao=equipe', 1500);
  await foto(page, '17-config-equipe');
  await ir(page, '/config?secao=permissoes', 1500);
  await foto(page, '18-config-permissoes');
  await ir(page, '/config?secao=auditoria', 1500);
  await foto(page, '19-config-auditoria');
  await ir(page, '/config?secao=estrutura', 1500);
  await foto(page, '20-config-servicos');
  await ir(page, '/config?secao=ia', 1500);
  await foto(page, '24-config-ia');
  await ir(page, '/config?secao=avisos', 1500);
  await foto(page, '28-config-avisos');
  await ctx.close();
}

// ------------------------------------------------------------ celular
{
  const ctx = await novoContexto(nav, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await ir(page, '/');
  await foto(page, '21-celular-portal');
  await ir(page, '/nova');
  await page.fill('#desc', 'Buraco grande na rua principal do distrito, perto da escola.');
  await page.waitForTimeout(1800);
  await foto(page, '22-celular-nova');
  await entrar(ctx);
  await ir(page, '/equipe', 300);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await foto(page, '23-celular-meu-dia');
  await ctx.close();
}

await capturarAcessibilidade(nav);
await nav.close();
console.log('Capturas prontas em', CAPTURAS);
