import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionClaims } from '../auth/session.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { Database } from '../database/typed-query';
import { ATTACHMENT_LIMITS, isEncryptedPdf, validateUpload } from './attachment-policy';
import {
  internalStorageKey,
  S3StorageClient,
  type InspectionState,
} from '../storage/s3-storage.client';
import { ClamAvClient, stateFromVerdict } from '../storage/clamav.client';

export interface UploadFile {
  readonly buffer: Buffer;
  readonly originalname: string;
}

interface AttachmentRow extends Record<string, unknown> {
  readonly id: string;
  readonly request_id: string;
  readonly storage_key: string;
  readonly internal_name: string;
  readonly size_bytes: number | string;
  readonly detected_media_type: string;
  readonly inspection_state: InspectionState;
  readonly created_at: string | Date;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
    private readonly storage: S3StorageClient,
    private readonly clamav: ClamAvClient,
  ) {}

  async list(input: {
    requestId: string;
    session: SessionClaims | undefined;
    correlationId: string;
  }): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly detectedMediaType: string;
      readonly sizeBytes: number;
      readonly inspectionState: InspectionState;
      readonly available: boolean;
      readonly createdAt: string | Date;
    }>
  > {
    if (input.session === undefined) throw new ForbiddenException();
    const target = await this.authorization.requestTarget(input.requestId);
    if (target === null) throw new NotFoundException('Solicitacao nao encontrada.');
    const action =
      target.ownerCitizenId === input.session.userId ? 'REQUEST_READ_OWN' : 'REQUEST_READ_QUEUE';
    const decision = await this.authorization.check(input.session, action, target, new Date());
    if (!decision.allowed) {
      await this.authorization.audit({
        actorUserId: input.session.userId,
        action,
        resourceType: 'attachments',
        resourceId: input.requestId,
        result: 'DENIED',
        reason: decision.reason,
        correlationId: input.correlationId,
      });
      throw new ForbiddenException();
    }
    const rows = await this.db.run<AttachmentRow>(
      `SELECT "id","detected_media_type","size_bytes","inspection_state","created_at"
         FROM "attachments" WHERE "request_id" = $1 ORDER BY "created_at" ASC`,
      [input.requestId],
    );
    await this.authorization.audit({
      actorUserId: input.session.userId,
      action,
      resourceType: 'attachments',
      resourceId: input.requestId,
      result: 'ALLOWED',
      reason: 'LISTA',
      correlationId: input.correlationId,
    });
    return rows.map((row) => ({
      id: row.id,
      detectedMediaType: row.detected_media_type,
      sizeBytes: Number(row.size_bytes),
      inspectionState: row.inspection_state,
      available: row.inspection_state === 'RELEASED',
      createdAt: row.created_at,
    }));
  }

  async upload(input: {
    requestId: string;
    file: UploadFile | undefined;
    session: SessionClaims | undefined;
    correlationId: string;
  }): Promise<{
    attachmentId: string;
    inspectionState: InspectionState;
    detectedMediaType: string;
    sizeBytes: number;
  }> {
    if (input.session === undefined) throw new ForbiddenException();
    if (input.file === undefined) throw new BadRequestException('Envie um arquivo no campo file.');
    const session = input.session;
    const file = input.file;

    const target = await this.authorization.requestTarget(input.requestId);
    if (target === null) throw new NotFoundException('Solicitacao nao encontrada.');
    const decision = await this.authorization.check(
      session,
      'ATTACHMENT_UPLOAD_OWN',
      target,
      new Date(),
    );
    if (!decision.allowed) {
      await this.registrarAcesso(null, session.userId, 'UPLOAD', 'DENIED', decision.reason);
      throw new ForbiddenException();
    }

    const limite = await this.limiteDoServico(input.requestId);
    const existentes = await this.db.count(
      `SELECT count(*)::int FROM "attachments"
        WHERE "request_id" = $1
          AND "inspection_state" NOT IN ('REJECTED','ERROR')`,
      [input.requestId],
    );
    if (existentes >= Math.min(limite, ATTACHMENT_LIMITS.maxFilesPerRequest)) {
      throw new BadRequestException('Esta solicitacao ja atingiu o limite de anexos.');
    }

    const validation = validateUpload({
      buffer: file.buffer,
      fileName: file.originalname,
      maxBytes: ATTACHMENT_LIMITS.maxBytesPerFile,
    });
    if (!validation.accepted) throw new BadRequestException(validation.reason);
    if (validation.detectedMediaType === 'application/pdf' && isEncryptedPdf(file.buffer)) {
      throw new BadRequestException('PDF protegido por senha nao pode ser inspecionado.');
    }

    const key = internalStorageKey({
      requestId: input.requestId,
      extension: validation.internalName.split('.').pop() ?? 'bin',
    });
    let bucket = this.storage.buckets[0];
    if (bucket === undefined) throw new Error('Bucket de quarentena nao configurado.');
    await this.storage.putObject({
      bucket,
      key,
      body: file.buffer,
      contentType: validation.detectedMediaType,
    });

    let inspectionState: InspectionState = 'ERROR';
    let inspectionDetail = 'Inspecao indisponivel';
    try {
      const scan = await this.clamav.scan(file.buffer);
      inspectionState = stateFromVerdict(scan.verdict);
      inspectionDetail = scan.detail;

      if (inspectionState === 'RELEASED') {
        const documentsBucket = this.storage.buckets[1];
        if (documentsBucket === undefined) throw new Error('Bucket de documentos nao configurado.');
        await this.storage.putObject({
          bucket: documentsBucket,
          key,
          body: file.buffer,
          contentType: validation.detectedMediaType,
        });
        await this.storage.deleteObject({ bucket, key });
        bucket = documentsBucket;
      }
    } catch {
      // Falha na movimentacao ou inspecao nunca libera o arquivo. O registro
      // abaixo permanece em ERROR e aponta para a quarentena.
      inspectionState = 'ERROR';
      inspectionDetail = 'Inspecao indisponivel';
      bucket = this.storage.buckets[0] ?? bucket;
    }

    let attachmentId: string;
    try {
      attachmentId = await this.db.transaction(async (tx) => {
        const inserted = await tx.run<{ id: string }>(
          `INSERT INTO "attachments"
             ("owner_user_id","request_id","storage_key","internal_name","size_bytes",
              "detected_media_type","sha256","inspection_state","inspection_detail",
              "classification","visibility","retention_policy","inspected_at")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CITIZEN_OWN','REQUEST_LIFECYCLE',$11)
           RETURNING "id"`,
          [
            session.userId,
            input.requestId,
            key,
            validation.internalName,
            file.buffer.length,
            validation.detectedMediaType,
            validation.sha256,
            inspectionState,
            inspectionDetail,
            target.classification,
            new Date(),
          ],
        );
        const row = inserted[0];
        if (row === undefined) throw new Error('Anexo nao foi registrado.');
        await tx.run(
          `INSERT INTO "attachment_access_events" ("attachment_id","actor_user_id","action","result","reason")
           VALUES ($1,$2,'UPLOAD','ALLOWED',$3)`,
          [row.id, session.userId, inspectionDetail],
        );
        return row.id;
      });
    } catch (error) {
      try {
        await this.storage.deleteObject({ bucket, key });
      } catch {
        // A rotina de retencao pode remover um objeto sem registro posterior.
      }
      throw error;
    }

    await this.authorization.audit({
      actorUserId: session.userId,
      action: 'ATTACHMENT_UPLOAD_OWN',
      resourceType: 'attachment',
      resourceId: attachmentId,
      result: 'ALLOWED',
      reason: inspectionState,
      correlationId: input.correlationId,
    });
    return {
      attachmentId,
      inspectionState,
      detectedMediaType: validation.detectedMediaType,
      sizeBytes: file.buffer.length,
    };
  }

  async download(input: {
    requestId: string;
    attachmentId: string;
    session: SessionClaims | undefined;
    correlationId: string;
  }): Promise<{ buffer: Buffer; mediaType: string; internalName: string }> {
    if (input.session === undefined) throw new ForbiddenException();
    const rows = await this.db.run<AttachmentRow>(
      `SELECT "id","request_id","storage_key","internal_name","size_bytes",
              "detected_media_type","inspection_state"
         FROM "attachments" WHERE "id" = $1 AND "request_id" = $2`,
      [input.attachmentId, input.requestId],
    );
    const attachment = rows[0];
    if (attachment === undefined) throw new NotFoundException('Anexo nao encontrado.');

    const target = await this.authorization.requestTarget(input.requestId);
    if (target === null) throw new NotFoundException('Solicitacao nao encontrada.');
    const action =
      target.ownerCitizenId === input.session.userId ? 'REQUEST_READ_OWN' : 'REQUEST_READ_QUEUE';
    const decision = await this.authorization.check(input.session, action, target, new Date());
    if (!decision.allowed) {
      await this.registrarAcesso(
        attachment.id,
        input.session.userId,
        'DOWNLOAD',
        'DENIED',
        decision.reason,
      );
      throw new ForbiddenException();
    }
    if (attachment.inspection_state !== 'RELEASED') {
      await this.registrarAcesso(
        attachment.id,
        input.session.userId,
        'DOWNLOAD',
        'NOT_AVAILABLE',
        attachment.inspection_state,
      );
      throw new HttpException(
        {
          code: 'ATTACHMENT_NOT_AVAILABLE',
          message: 'Este anexo ainda nao esta disponivel para download.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const documentsBucket = this.storage.buckets[1];
    if (documentsBucket === undefined) throw new Error('Bucket de documentos nao configurado.');
    let buffer: Buffer;
    try {
      buffer = await this.storage.getObject({
        bucket: documentsBucket,
        key: attachment.storage_key,
      });
    } catch {
      await this.registrarAcesso(
        attachment.id,
        input.session.userId,
        'DOWNLOAD',
        'NOT_AVAILABLE',
        'OBJETO_AUSENTE',
      );
      throw new NotFoundException('Anexo nao encontrado.');
    }
    await this.registrarAcesso(
      attachment.id,
      input.session.userId,
      'DOWNLOAD',
      'ALLOWED',
      'AUTORIZADO',
    );
    await this.authorization.audit({
      actorUserId: input.session.userId,
      action,
      resourceType: 'attachment',
      resourceId: attachment.id,
      result: 'ALLOWED',
      reason: 'AUTORIZADO',
      correlationId: input.correlationId,
    });
    return {
      buffer,
      mediaType: attachment.detected_media_type,
      internalName: attachment.internal_name,
    };
  }

  private async limiteDoServico(requestId: string): Promise<number> {
    const rows = await this.db.run<{ max_attachments: number | string }>(
      `SELECT sv."max_attachments" FROM "requests" r
         JOIN "service_versions" sv ON sv."id" = r."service_version_id"
        WHERE r."id" = $1`,
      [requestId],
    );
    const value = Number(rows[0]?.max_attachments ?? ATTACHMENT_LIMITS.maxFilesPerRequest);
    return Number.isInteger(value) && value >= 0 ? value : ATTACHMENT_LIMITS.maxFilesPerRequest;
  }

  private async registrarAcesso(
    attachmentId: string | null,
    actorUserId: string,
    action: 'DOWNLOAD' | 'UPLOAD',
    result: 'ALLOWED' | 'DENIED' | 'NOT_AVAILABLE',
    reason: string,
  ): Promise<void> {
    if (attachmentId === null) return;
    await this.db.run(
      `INSERT INTO "attachment_access_events" ("attachment_id","actor_user_id","action","result","reason")
       VALUES ($1,$2,$3,$4,$5)`,
      [attachmentId, actorUserId, action, result, reason],
    );
  }
}
