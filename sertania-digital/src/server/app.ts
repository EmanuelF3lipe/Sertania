import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { Banco } from './db.js';
import { lerConfig, type Config } from './config.js';
import { middlewareSessao } from './auth.js';
import { ErroHttp } from './erros.js';
import type { Ctx } from './contexto.js';
import { rotasPublicas } from './rotas/publico.js';
import { rotasAuth, rotasCidadao } from './rotas/auth.js';
import { rotasGestao } from './rotas/gestao.js';
import { rotasAdmin, rotasIntegracao } from './rotas/admin.js';
import { openapi } from './openapi.js';
import { semear } from './seed.js';
import { marcarRecorrencia, recalcularAlertas } from './ia/servico.js';

export function criarApp(sobrescrever: Partial<Config> & { arquivoBanco?: string; semDemonstracao?: boolean } = {}) {
  const { arquivoBanco, semDemonstracao, ...cfg } = sobrescrever;
  const config = lerConfig(cfg);
  const banco = new Banco(arquivoBanco ?? path.join(config.pastaDados, 'sertania.db'));
  const ctx: Ctx = { banco, config };
  if (!banco.get('SELECT id FROM secretarias LIMIT 1')) {
    semear(banco, { demonstracao: semDemonstracao !== true });
    for (const { id } of banco.all<{ id: number }>('SELECT id FROM demandas ORDER BY criada_em')) marcarRecorrencia(banco, id);
    recalcularAlertas(banco);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(middlewareSessao(banco));

  app.get('/api/saude', (_req, res) => {
    res.json({ ok: true, ia: config.iaProvedor, hora: new Date().toISOString() });
  });
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  app.use('/api/publico', rotasPublicas(ctx));
  app.use('/api/auth', rotasAuth(ctx));
  app.use('/api/cidadao', rotasCidadao(ctx));
  app.use('/api/gestao', rotasGestao(ctx));
  app.use('/api/admin', rotasAdmin(ctx));
  app.use('/api/integracao', rotasIntegracao(ctx));
  app.use('/api', (_req, _res, next) => next(new ErroHttp(404, 'Rota não encontrada', 'nao_encontrado')));

  // Interface web compilada (producao). Em desenvolvimento o Vite serve a interface.
  const web = path.resolve('dist/web');
  if (fs.existsSync(web)) {
    app.use(express.static(web, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(web, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((erro: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (erro instanceof ErroHttp) {
      res.status(erro.status).json({ erro: erro.message, codigo: erro.codigo });
      return;
    }
    if (erro instanceof multer.MulterError) {
      const msg = erro.code === 'LIMIT_FILE_SIZE' ? 'Arquivo muito grande (máximo 8 MB)' : erro.code === 'LIMIT_FILE_COUNT' ? 'Envie no máximo 5 arquivos' : 'Falha no envio do arquivo';
      res.status(400).json({ erro: msg, codigo: 'arquivo' });
      return;
    }
    if (erro instanceof SyntaxError) {
      res.status(400).json({ erro: 'JSON inválido', codigo: 'invalido' });
      return;
    }
    console.error('[erro]', erro);
    res.status(500).json({ erro: 'Erro interno. Tente novamente em instantes.', codigo: 'interno' });
  });

  return { app, ctx };
}
