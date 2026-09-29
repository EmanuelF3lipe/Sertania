/**
 * Ponto de entrada da API (especificacao secao 12 e 13).
 *
 * Cabecalhos de seguranca e rate limit sao aplicados aqui, no HTTP. As regras de
 * autorizacao estao na camada de dominio; o que se resolve aqui e transporte.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ProtocolService } from './requests/protocol.service';
import { S3StorageClient } from './storage/s3-storage.client';
import { ClamAvClient } from './storage/clamav.client';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** Requisicao com identificador de correlacao para amarrar log e resposta. */
type RequestWithId = import('express').Request & { correlationId?: string };

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // A lista de veiculos nao e usada para decisao de acesso. Nenhuma funcao
    // privilegiada depende de do dispositivo: quem opera no celular e quem
    // opera no computador tem exatamente as mesmas permissoes.
    logger: ['error', 'warn', 'log'],
  });

  // Correlation id por requisicao, para amarrar log e resposta de erro sem
  // expor stack trace ao cliente.
  app.use((request: RequestWithId, _response: import('express').Response, next: () => void) => {
    request.correlationId = randomUUID();
    next();
  });

  // Cabecalhos de seguranca. A CSP e a primeira defesa contra injecao de
  // script na interface.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      // Descarta campo desconhecido em vez de aceita-lo em silencio: um campo
      // extra num corpo de requisicao costuma ser tentativa de adulterar.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-CSRF-Token'],
  });

  // Filtro global de erro: erro de dominio vira 4xx previsivel, erro de
  // infraestrutura vira 500 sem detalhe. Resposta sempre traz codigo estavel,
  // mensagem segura e identificador de correlacao.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Prepara o schema de protocolo e os buckets privados antes de atender.
  const protocol = app.get(ProtocolService);
  await protocol.ensureSequenceTable();

  const storage = app.get(S3StorageClient);
  for (const bucket of storage.buckets) {
    await storage.createBucketIfAbsent(bucket);
    await storage.denyPublicAccess(bucket);
  }
  logger.log(`Armazenamento pronto com buckets privados: ${storage.buckets.join(', ')}`);

  // Registra a disponibilidade do antivirus. Falha aqui nao impede o sistema
  // de subir, mas fica visivel: anexos permanecem bloqueados ate a inspecao.
  const clamav = app.get(ClamAvClient);
  try {
    const version = await clamav.version();
    logger.log(`Antivirus disponivel: ${version}`);
  } catch {
    logger.warn('Antivirus indisponivel: anexos permanecem bloqueados ate a inspecao');
  }

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port, '127.0.0.1');
  logger.log(`API em execucao em http://127.0.0.1:${port}`);
}

void bootstrap();
