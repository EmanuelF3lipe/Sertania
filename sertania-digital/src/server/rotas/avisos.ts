import { Router } from 'express';
import { z } from 'zod';
import { STATUS } from '../../shared/dominio.js';
import { ator, idParam, validar, type Ctx } from '../contexto.js';
import { exigir } from '../auth.js';
import { auditar } from '../auditoria.js';
import { naoEncontrado } from '../erros.js';
import { enviarTeste, lerPreferencias, processarFila, reenviar, resumoMensagens, salvarPreferencias } from '../avisos/fila.js';
import { lerConfigAvisos, pendenciasCanal, tipoCanal, type Via } from '../avisos/provedores.js';
import { mesAnterior, previaRelatorio, proximoRelatorio } from '../avisos/relatorio-mensal.js';

/** Configuracoes > Avisos e mensagens. Mesma permissao de Integracoes: envolve provedores externos. */
export function rotasAvisos(ctx: Ctx): Router {
  const r = Router();
  const b = ctx.banco;

  const estado = () => {
    const cfg = lerConfigAvisos();
    const canal = (via: Via) => {
      const pend = pendenciasCanal(cfg, via);
      return { tipo: tipoCanal(cfg, via), pronto: pend.length === 0, falta: pend[0] === 'desligado' ? [] : pend };
    };
    return {
      urlPublica: cfg.urlPublica,
      canais: { WHATSAPP: canal('WHATSAPP'), SMS: canal('SMS'), EMAIL: canal('EMAIL') },
      modelosWhatsapp: { situacao: !!cfg.meta.modeloSituacao, pesquisa: !!cfg.meta.modeloPesquisa },
      preferencias: lerPreferencias(b),
      proximoRelatorio: proximoRelatorio(),
      mesPrevia: mesAnterior().nome,
      ...resumoMensagens(b),
    };
  };

  r.get('/', (req, res) => {
    exigir(req, 'admin.integracao');
    res.json(estado());
  });

  r.put('/preferencias', (req, res) => {
    exigir(req, 'admin.integracao');
    const p = validar(z.object({
      situacoes: z.array(z.enum(STATUS)),
      pesquisaAtiva: z.boolean(),
      pesquisaHoras: z.number().int().min(0).max(168),
      relatorioMensalAtivo: z.boolean(),
      horaInicio: z.number().int().min(0).max(23),
      horaFim: z.number().int().min(1).max(24),
    }).refine((x) => x.horaFim > x.horaInicio, { message: 'o fim do horário precisa ser depois do início', path: ['horaFim'] }), req.body);
    const anterior = lerPreferencias(b);
    salvarPreferencias(b, p);
    auditar(b, ator(req), 'AVISOS_PREFERENCIAS', 'parametros', null, { anterior, novo: p });
    res.json(estado());
  });

  r.post('/teste', async (req, res) => {
    const u = exigir(req, 'admin.integracao');
    const { via, para } = validar(z.object({ via: z.enum(['WHATSAPP', 'SMS', 'EMAIL']), para: z.string().min(5).max(200) }), req.body);
    const resultado = await enviarTeste(lerConfigAvisos(), via, para);
    // o endereco digitado nao vai para a auditoria: so o canal e o resultado
    auditar(b, ator(req), 'AVISOS_TESTE', 'mensagem', null, { via, ok: resultado.ok, erro: resultado.erro ?? null, por: u.id });
    res.json(resultado);
  });

  r.post('/processar', async (req, res) => {
    exigir(req, 'admin.integracao');
    res.json({ resumo: await processarFila(b), ...estado() });
  });

  r.post('/:id/reenviar', (req, res) => {
    exigir(req, 'admin.integracao');
    const id = idParam(req);
    if (!reenviar(b, id)) throw naoEncontrado('Mensagem não encontrada ou ainda na fila');
    auditar(b, ator(req), 'AVISOS_REENVIAR', 'mensagem', id, {});
    res.json(estado());
  });

  r.post('/relatorio-previa', async (req, res) => {
    const u = exigir(req, 'admin.integracao');
    const previa = previaRelatorio(b, { id: u.id, email: u.email, secretariaId: u.secretariaId, municipio: true });
    const resumo = await processarFila(b);
    res.json({ assunto: previa.assunto, resumo, ...estado() });
  });

  return r;
}
