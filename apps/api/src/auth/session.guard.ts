/**
 * Guarda de sessao e CSRF (especificacao secao 12 e 16).
 *
 * Aplica-se a TODA rota autenticada por cookie. Como o navegador envia o cookie
 * automaticamente, a protecao contra CSRF e obrigatoria em mutacao: sem ela,
 * qualquer site poderia acionar uma acao com a sessao da vitima.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import {
  CsrfService,
  isOriginAllowed,
  SESSION_COOKIE_NAME,
  SessionService,
  type SessionClaims,
} from './session.service';
import { API_ERROR_CODES } from '@sertania/contracts';

/** Rotas que nao exigem sessao: saude, e o inicio do login. */
export const PUBLIC_KEY = 'sertania:public';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

export interface AuthenticatedRequest extends Request {
  session?: SessionClaims;
  correlationId?: string;
}

/**
 * Le um cookie como texto.
 *
 * O `Request` do Express declara `cookies` como `any`, e um `any` atravessando a
 * aplicacao e o tipo de bug que passa pela revisao sem aparecer. Aqui o valor
 * entra como `unknown` e so vira `string` depois de conferido: um cookie
 * numerico, um array (o Express junta cookies repetidos com `,`) ou um objeto
 * sao recusados, e nao propagados como se fossem texto.
 */
export function lerCookie(request: Request, nome: string): string | undefined {
  const bruto: unknown = (request as { cookies?: Record<string, unknown> }).cookies?.[nome];
  return typeof bruto === 'string' && bruto.length > 0 ? bruto : undefined;
}

/** Rotas que exigem token CSRF. Padrao: toda mutacao. */
export const CSRF_EXEMPT_KEY = 'sertania:csrf-exempt';

export const CsrfExempt = (): MethodDecorator & ClassDecorator => SetMetadata(CSRF_EXEMPT_KEY, true);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SessionGuard implements CanActivate {
  private readonly logger = new Logger(SessionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly csrf: CsrfService,
    private readonly allowedOrigins: readonly string[],
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const raw = lerCookie(request, SESSION_COOKIE_NAME);
    const claims = await this.sessions.resolve(raw, Date.now());

    if (claims === null) {
      // Mensagem generica: nao revela se a sessao existiu.
      throw new HttpException(
        { code: API_ERROR_CODES.UNAUTHENTICATED, message: 'Faca login para continuar', correlationId: request.correlationId ?? '' },
        401,
      );
    }

    request.session = claims;

    // Token CSRF e conferencia de Origin em mutacao.
    if (!SAFE_METHODS.has(request.method)) {
      const exempt = this.reflector.getAllAndOverride<boolean>(CSRF_EXEMPT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (exempt !== true) {
        const origin = request.headers.origin;
        if (!isOriginAllowed(origin, this.allowedOrigins)) {
          this.logger.warn(`Origem recusada: ${String(origin)}`);
          throw new HttpException(
            { code: API_ERROR_CODES.FORBIDDEN, message: 'Origem nao autorizada', correlationId: request.correlationId ?? '' },
            403,
          );
        }
        const provided = request.headers['x-csrf-token'] as string | undefined;
        const sessionId = raw?.split('.')[0] ?? '';
        if (!this.csrf.verify(sessionId, provided)) {
          throw new HttpException(
            { code: API_ERROR_CODES.FORBIDDEN, message: 'Token de seguranca invalido', correlationId: request.correlationId ?? '' },
            403,
          );
        }
      }
    }

    return true;
  }
}

/** Injeta as claims da sessao no controller. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionClaims | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().session,
);
