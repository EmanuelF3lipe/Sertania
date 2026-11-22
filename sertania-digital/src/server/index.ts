import { criarApp } from './app.js';
import { recalcularAlertas } from './ia/servico.js';
import { anonimizarVencidas } from './privacidade.js';
import { fazerBackup } from './rotas/admin.js';
import { auditar } from './auditoria.js';

const { app, ctx, codigoPrimeiroAcesso } = criarApp();

// Rotinas: alertas a cada 5 minutos; retencao (LGPD) e backup diarios.
setInterval(() => recalcularAlertas(ctx.banco), 5 * 60_000).unref();
setInterval(() => {
  const n = anonimizarVencidas(ctx.banco, ctx.config.retencaoDias);
  const b = fazerBackup(ctx);
  auditar(ctx.banco, { id: null, nome: 'Rotina diária' }, 'ROTINA_DIARIA', null, null, { anonimizadas: n, backup: b.arquivo });
}, 24 * 3600_000).unref();

app.listen(ctx.config.porta, () => {
  console.log(`Sertânia Digital – API em http://localhost:${ctx.config.porta} (IA: ${ctx.config.iaProvedor}, dados: ${ctx.config.pastaDados})`);
  if (codigoPrimeiroAcesso) {
    console.log('\n' + '='.repeat(64));
    console.log('  PRIMEIRO ACESSO: ainda não existe administrador.');
    console.log('  Abra o sistema no navegador e informe o código de instalação:');
    console.log(`\n      ${codigoPrimeiroAcesso}\n`);
    console.log('  O código muda a cada reinício e deixa de valer após o uso.');
    console.log('='.repeat(64) + '\n');
  }
});
