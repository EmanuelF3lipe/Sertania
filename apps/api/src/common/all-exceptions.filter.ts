/**
 * Filtro de erro da API (especificacao secao 16).
 *
 * Respostas de erro incluem codigo estavel, mensagem segura e identificador de
 * correlacao. Nao expõem stack trace nem SQL.
 *
 * A distincao que importa: erro de DOMINIO (regra de negocio ou autorizacao)
 * tem resposta propria e previsivel, com status 4xx. Erro de INFRAESTRUTURA
 * vira 500 sem detalhe. Tratar os dois igual faria o cidadao ver "erro do
 * sistema" quando o problema e, por exemplo, um conflito de versao que ele
 * mesmo resolve recarregando a tela.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  API_ERROR_CODES,
  DomainError,
  type ApiErrorBody,
  type ApiErrorCode,
} from '@sertania/contracts';

/** Codigo de dominio para o status HTTP correspondente. */
const DOMAIN_STATUS: Readonly<Record<string, number>> = {
  ILLEGAL_TRANSITION: HttpStatus.CONFLICT,
  VERSION_CONFLICT: HttpStatus.CONFLICT,
  OUTCOME_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  REOPEN_WINDOW_CLOSED: HttpStatus.UNPROCESSABLE_ENTITY,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  ATTACHMENT_NOT_AVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  SMALL_GROUP_SUPPRESSED: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Erro');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { correlationId?: string }>();
    const correlationId = request.correlationId ?? 'desconhecido';

    const { status, code, message } = this.classify(exception);

    const body: ApiErrorBody = {
      code,
      // A mensagem so e repassada quando vem de `DomainError` ou de
      // `HttpException` controlado. Qualquer outra coisa nao pode vazar
      // detalhe de infraestrutura.
      message,
      correlationId,
    };
    response.status(status).json(body);

    if (status >= 500) {
      // Erro de infraestrutura entra no log com detalhe, mas nunca na resposta.
      this.logger.error(`${request.method} ${request.url} -> ${String(exception)}`);
    }
  }

  private classify(exception: unknown): {
    status: number;
    // O codigo pode ser o do dominio ou o mapeado pelo status. A uniao com
    // `string` e redundante para o compilador, mas o campo aceita ambos.
    code: string;
    message: string;
  } {
    if (exception instanceof DomainError) {
      const status = DOMAIN_STATUS[exception.code] ?? HttpStatus.CONFLICT;
      return { status, code: exception.code, message: exception.message };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const asBody =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)
          : {};
      const code = typeof asBody['code'] === 'string' ? asBody['code'] : mapStatusToCode(status);
      const message =
        typeof asBody['message'] === 'string'
          ? asBody['message']
          : Array.isArray(asBody['message'])
            ? 'Dados invalidos'
            : exception.message;
      return { status, code, message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: API_ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'Nao foi possivel concluir a operacao. Tente novamente.',
    };
  }
}

function mapStatusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return API_ERROR_CODES.VALIDATION_FAILED;
    case 401:
      return API_ERROR_CODES.UNAUTHENTICATED;
    case 403:
      return API_ERROR_CODES.FORBIDDEN;
    case 404:
      return API_ERROR_CODES.NOT_FOUND;
    case 409:
      return API_ERROR_CODES.CONFLICT;
    case 422:
      return API_ERROR_CODES.VALIDATION_FAILED;
    case 429:
      return API_ERROR_CODES.RATE_LIMITED;
    default:
      return API_ERROR_CODES.SERVICE_UNAVAILABLE;
  }
}
