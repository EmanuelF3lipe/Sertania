import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SessionClaims } from '../auth/session.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { Database } from '../database/typed-query';

const MAX_MESSAGE_LENGTH = 5_000;
type Visibility = 'CITIZEN_VISIBLE' | 'INTERNAL_ONLY';

interface MessageRow extends Record<string, unknown> {
  readonly id: string;
  readonly author_user_id: string;
  readonly visibility: Visibility;
  readonly body_ciphertext: string;
  readonly key_version: number | string | null;
  readonly created_at: string | Date;
}

export interface MessageDto {
  readonly id: string;
  readonly visibility: Visibility;
  readonly body: string;
  readonly authorUserId: string;
  readonly isMine: boolean;
  readonly createdAt: string | Date;
}

@Injectable()
export class MessagesService {
  private readonly crypto: MessageCrypto;

  constructor(
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
    config: ConfigService,
  ) {
    this.crypto = new MessageCrypto(
      config.get<string>('DATA_ENCRYPTION_KEY') ?? config.get<string>('SESSION_SECRET') ?? '',
      Number(config.get<number>('DATA_ENCRYPTION_KEY_VERSION', 1)),
    );
  }

  async list(input: {
    requestId: string;
    session: SessionClaims | undefined;
    correlationId: string;
  }): Promise<readonly MessageDto[]> {
    const access = await this.accessFor(
      input.requestId,
      input.session,
      'read',
      input.correlationId,
    );
    const rows = await this.db.run<MessageRow>(
      `SELECT "id","author_user_id","visibility","body_ciphertext","key_version","created_at"
         FROM "messages"
        WHERE "request_id" = $1
          AND ($2::boolean = true OR "visibility" = 'CITIZEN_VISIBLE')
        ORDER BY "created_at" ASC`,
      [input.requestId, access.isServerView],
    );

    await this.authorization.audit({
      actorUserId: access.session.userId,
      action: access.action,
      resourceType: 'request_messages',
      resourceId: input.requestId,
      result: 'ALLOWED',
      reason: 'AUTORIZADO',
      correlationId: input.correlationId,
    });

    return rows.map((row) => ({
      id: row.id,
      visibility: row.visibility,
      body: this.crypto.decrypt(row.body_ciphertext, row.key_version),
      authorUserId: row.author_user_id,
      isMine: row.author_user_id === access.session.userId,
      createdAt: row.created_at,
    }));
  }

  async send(input: {
    requestId: string;
    body: unknown;
    visibility: unknown;
    session: SessionClaims | undefined;
    correlationId: string;
  }): Promise<MessageDto> {
    const access = await this.accessFor(
      input.requestId,
      input.session,
      'write',
      input.correlationId,
    );
    const body = validateBody(input.body);
    const visibility = validateVisibility(input.visibility, access.isServerView);
    const encrypted = this.crypto.encrypt(body);

    const rows = await this.db.run<MessageRow>(
      `INSERT INTO "messages"
         ("request_id","author_user_id","visibility","body_ciphertext","key_version")
       VALUES ($1,$2,$3,$4,$5)
       RETURNING "id","author_user_id","visibility","body_ciphertext","key_version","created_at"`,
      [
        input.requestId,
        access.session.userId,
        visibility,
        encrypted.ciphertext,
        encrypted.keyVersion,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Mensagem nao foi registrada.');

    await this.authorization.audit({
      actorUserId: access.session.userId,
      action: access.action,
      resourceType: 'message',
      resourceId: row.id,
      result: 'ALLOWED',
      reason: visibility,
      correlationId: input.correlationId,
    });

    return {
      id: row.id,
      visibility: row.visibility,
      body,
      authorUserId: row.author_user_id,
      isMine: true,
      createdAt: row.created_at,
    };
  }

  private async accessFor(
    requestId: string,
    session: SessionClaims | undefined,
    operation: 'read' | 'write',
    correlationId: string,
  ): Promise<{
    session: SessionClaims;
    action:
      | 'REQUEST_READ_OWN'
      | 'REQUEST_READ_QUEUE'
      | 'MESSAGE_SEND_OWN'
      | 'MESSAGE_SEND_INTERNAL';
    isServerView: boolean;
  }> {
    if (session === undefined) throw new ForbiddenException();
    const target = await this.authorization.requestTarget(requestId);
    if (target === null) throw new NotFoundException('Solicitacao nao encontrada.');

    const isOwner = target.ownerCitizenId === session.userId;
    const action =
      operation === 'read'
        ? isOwner
          ? 'REQUEST_READ_OWN'
          : 'REQUEST_READ_QUEUE'
        : isOwner
          ? 'MESSAGE_SEND_OWN'
          : 'MESSAGE_SEND_INTERNAL';
    const decision = await this.authorization.check(session, action, target, new Date());
    if (!decision.allowed) {
      await this.authorization.audit({
        actorUserId: session.userId,
        action,
        resourceType: 'request_messages',
        resourceId: requestId,
        result: 'DENIED',
        reason: decision.reason,
        correlationId,
      });
      throw new ForbiddenException();
    }
    return { session, action, isServerView: !isOwner };
  }
}

function validateBody(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('A mensagem precisa ser um texto.');
  const body = value.trim();
  if (body.length === 0) throw new BadRequestException('Escreva uma mensagem antes de enviar.');
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new BadRequestException(
      `A mensagem pode ter no maximo ${MAX_MESSAGE_LENGTH} caracteres.`,
    );
  }
  return body;
}

function validateVisibility(value: unknown, isServerView: boolean): Visibility {
  if (value === undefined || value === null || value === '') {
    return isServerView ? 'INTERNAL_ONLY' : 'CITIZEN_VISIBLE';
  }
  if (value !== 'CITIZEN_VISIBLE' && value !== 'INTERNAL_ONLY') {
    throw new BadRequestException('Visibilidade de mensagem invalida.');
  }
  if (!isServerView && value !== 'CITIZEN_VISIBLE') {
    throw new BadRequestException('Cidadao so pode enviar mensagens visiveis para a prefeitura.');
  }
  return value;
}

class MessageCrypto {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly keyVersion: number,
  ) {
    if (secret.length < 32) throw new Error('Segredo de criptografia de mensagens invalido.');
    this.key = createHash('sha256').update(`sertania-messages:${secret}`).digest();
  }

  encrypt(plaintext: string): { ciphertext: string; keyVersion: number } {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(ciphertext: string, rowKeyVersion: number | string | null): string {
    if (Number(rowKeyVersion ?? this.keyVersion) !== this.keyVersion) {
      throw new Error('Versao de chave de mensagem nao suportada.');
    }
    const parts = ciphertext.split('.');
    if (parts.length !== 3) throw new Error('Mensagem criptografada invalida.');
    const iv = Buffer.from(parts[0] ?? '', 'base64url');
    const tag = Buffer.from(parts[1] ?? '', 'base64url');
    const encrypted = Buffer.from(parts[2] ?? '', 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
