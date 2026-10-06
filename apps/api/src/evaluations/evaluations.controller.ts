import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CurrentSession, type AuthenticatedRequest } from '../auth/session.guard';
import type { SessionClaims } from '../auth/session.service';
import { EvaluationsService } from './evaluations.service';

@Controller('api/v1/requests/:requestId/evaluation')
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get()
  async current(
    @Param('requestId') requestId: string,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.current({
      requestId,
      session,
      correlationId: request.correlationId ?? 'desconhecido',
    });
  }

  @Post()
  async create(
    @Param('requestId') requestId: string,
    @Body() body: { readonly rating?: unknown; readonly comment?: unknown } | undefined,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.evaluations.create({
      requestId,
      rating: body?.rating,
      comment: body?.comment,
      session,
      correlationId: request.correlationId ?? 'desconhecido',
    });
  }
}
