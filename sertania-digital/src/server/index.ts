import { criarApp } from './app.js';
import { recalcularAlertas } from './ia/servico.js';
import { anonimizarVencidas } from './privacidade.js';
import { fazerBackup } from './rotas/admin.js';
import { auditar } from './auditoria.js';

const { app, ctx } = criarApp();

// Rotinas: alertas a cada 5 minutos; retencao (LGPD) e backup diarios.
setInterval(() => recalcularAlertas(ctx.banco), 5 * 60_000).unref();
setInterval(() => {
  const n = anonimizarVencidas(ctx.banco, ctx.config.retencaoDias);
  const b = fazerBackup(ctx);
  auditar(ctx.banco, { id: null, nome: 'Rotina diária' }, 'ROTINA_DIARIA', null, null, { anonimizadas: n, backup: b.arquivo });
}, 24 * 3600_000).unref();

app.listen(ctx.config.porta, () => {
  console.log(`Sertânia Digital – API em http://localhost:${ctx.config.porta} (IA: ${ctx.config.iaProvedor}, dados: ${ctx.config.pastaDados})`);
});
