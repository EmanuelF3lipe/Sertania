import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CurrentSession, type AuthenticatedRequest } from '../auth/session.guard';
import type { SessionClaims } from '../auth/session.service';
import { MessagesService } from './messages.service';

@Controller('api/v1/requests/:requestId/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  async list(
    @Param('requestId') requestId: string,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.messages.list({
      requestId,
      session,
      correlationId: request.correlationId ?? 'desconhecido',
    });
  }

  @Post()
  async send(
    @Param('requestId') requestId: string,
    @Body() body: { readonly body?: unknown; readonly visibility?: unknown } | undefined,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.messages.send({
      requestId,
      body: body?.body,
      visibility: body?.visibility,
      session,
      correlationId: request.correlationId ?? 'desconhecido',
    });
  }
}
