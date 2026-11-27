import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { Banco } from './db.js';
import { lerConfig, origemMapa, type Config } from './config.js';
import { middlewareSessao } from './auth.js';
import { ErroHttp } from './erros.js';
import type { Ctx } from './contexto.js';
import { rotasPublicas } from './rotas/publico.js';
import { rotasAuth, rotasCidadao } from './rotas/auth.js';
import { rotasGestao } from './rotas/gestao.js';
import { rotasAdmin, rotasIntegracao } from './rotas/admin.js';
import { rotasAvisos } from './rotas/avisos.js';
import { openapi } from './openapi.js';
import { semear } from './seed.js';
import { garantirCargos } from './cargos.js';
import { marcarRecorrencia, recalcularAlertas } from './ia/servico.js';
import { prepararPrimeiroAcesso, rotasConfiguracao } from './rotas/configuracao.js';

export function criarApp(sobrescrever: Partial<Config> & { arquivoBanco?: string } = {}) {
  const { arquivoBanco, ...cfg } = sobrescrever;
  const config = lerConfig(cfg);
  const banco = new Banco(arquivoBanco ?? path.join(config.pastaDados, 'sertania.db'));
  const ctx: Ctx = { banco, config };
  if (!banco.get('SELECT id FROM secretarias LIMIT 1')) {
    semear(banco, { modo: config.modoInicial });
    for (const { id } of banco.all<{ id: number }>('SELECT id FROM demandas ORDER BY criada_em')) marcarRecorrencia(banco, id);
    recalcularAlertas(banco);
  }
  garantirCargos(banco);
  const codigoPrimeiroAcesso = prepararPrimeiroAcesso(ctx);

  // Tradutor de Libras do Governo Federal: so carrega quando a pessoa liga no painel de acessibilidade.
  // O carregador do vlibras.gov.br busca os arquivos no repositorio oficial do governo no jsDelivr (so esse caminho e liberado).
  const VLIBRAS = 'https://vlibras.gov.br https://*.vlibras.gov.br https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/';
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Envia so a ORIGEM (nunca o caminho) para outros sites: o servidor de mapas exige saber de qual site vem o pedido.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(self)');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data: blob: ${origemMapa(config.mapaTiles)} ${VLIBRAS}; font-src 'self' data: ${VLIBRAS}; style-src 'self' 'unsafe-inline' ${VLIBRAS}; script-src 'self' 'wasm-unsafe-eval' ${VLIBRAS}; connect-src 'self' ${VLIBRAS}; worker-src 'self' blob:; frame-src ${VLIBRAS}; media-src 'self' blob: ${VLIBRAS}; frame-ancestors 'none'`,
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
  app.use('/api/configuracao', rotasConfiguracao(ctx));
  app.use('/api/publico', rotasPublicas(ctx));
  app.use('/api/auth', rotasAuth(ctx));
  app.use('/api/cidadao', rotasCidadao(ctx));
  app.use('/api/gestao', rotasGestao(ctx));
  app.use('/api/admin/avisos', rotasAvisos(ctx));
  app.use('/api/admin', rotasAdmin(ctx));
  app.use('/api/integracao', rotasIntegracao(ctx));
  app.use('/api', (_req, _res, next) => next(new ErroHttp(404, 'Rota não encontrada', 'nao_encontrado')));

  // Interface web compilada (producao). Em desenvolvimento o Vite serve a interface.
  // Procura a interface compilada a partir deste arquivo, para funcionar de qualquer pasta.
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const web = [path.resolve(aqui, '../../web'), path.resolve(aqui, '../../dist/web'), path.resolve('dist/web')].find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (web) {
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

  return { app, ctx, codigoPrimeiroAcesso };
}
