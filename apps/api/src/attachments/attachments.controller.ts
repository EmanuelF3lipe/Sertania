import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CurrentSession, type AuthenticatedRequest } from '../auth/session.guard';
import type { SessionClaims } from '../auth/session.service';
import { ATTACHMENT_LIMITS } from './attachment-policy';
import { AttachmentsService, type UploadFile } from './attachments.service';

@Controller('api/v1/requests/:requestId/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  async list(
    @Param('requestId') requestId: string,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attachments.list({
      requestId,
      session,
      correlationId: request.correlationId ?? 'desconhecido',
    });
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_LIMITS.maxBytesPerFile },
    }),
  )
  async upload(
    @Param('requestId') requestId: string,
    @UploadedFile() file: UploadFile | undefined,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attachments.upload({
      requestId,
      file,
      session,
      correlationId: request.correlationId ?? 'desconhecido',
    });
  }

  @Get(':attachmentId')
  async download(
    @Param('requestId') requestId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentSession() session: SessionClaims | undefined,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.attachments.download({
      requestId,
      attachmentId,
      session,
      correlationId: request.correlationId ?? 'desconhecido',
    });
    response.setHeader('Content-Type', result.mediaType);
    response.setHeader('Content-Length', String(result.buffer.length));
    response.setHeader('Content-Disposition', `attachment; filename="${result.internalName}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.send(result.buffer);
  }
}
