import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Database } from '../database/typed-query';

const SMTP_KEYS = [
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_password_ciphertext',
  'smtp_secure',
  'smtp_starttls',
  'smtp_from_name',
  'smtp_from_address',
] as const;

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly secure: boolean;
  readonly starttls: boolean;
  readonly fromName: string;
  readonly fromAddress: string;
}

export interface SmtpSettingsPublic {
  readonly configured: boolean;
  readonly email: string;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly starttls: boolean;
  readonly fromAddress: string;
}

interface SettingRow extends Record<string, unknown> {
  readonly key: string;
  readonly value: string;
}

@Injectable()
export class SmtpSettingsService {
  private readonly key: Buffer;

  constructor(
    private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    const secret =
      config.get<string>('DATA_ENCRYPTION_KEY') ?? config.get<string>('SESSION_SECRET') ?? '';
    if (secret.length < 32) throw new Error('Segredo de SMTP invalido.');
    this.key = createHash('sha256').update(`sertania-smtp:${secret}`).digest();
  }

  async current(): Promise<SmtpSettings> {
    const rows = await this.db.run<SettingRow>(
      `SELECT "key","value" FROM "system_settings" WHERE "key" = ANY($1::text[])`,
      [SMTP_KEYS],
    );
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const encryptedPassword = values.get('smtp_password_ciphertext');
    return {
      host: values.get('smtp_host') ?? this.config.get<string>('SMTP_HOST', '127.0.0.1'),
      port: Number(values.get('smtp_port') ?? this.config.get<string>('SMTP_PORT', '1025')),
      user: values.get('smtp_user') ?? this.config.get<string>('SMTP_USER', ''),
      password:
        encryptedPassword === undefined
          ? this.config.get<string>('SMTP_PASSWORD', '')
          : this.decrypt(encryptedPassword),
      secure:
        (values.get('smtp_secure') ?? this.config.get<string>('SMTP_SECURE', 'false')) === 'true',
      starttls:
        (values.get('smtp_starttls') ?? this.config.get<string>('SMTP_STARTTLS', 'false')) ===
        'true',
      fromName:
        values.get('smtp_from_name') ??
        this.config.get<string>('SMTP_FROM_NAME', 'Prefeitura de Sertania'),
      fromAddress:
        values.get('smtp_from_address') ??
        this.config.get<string>('SMTP_FROM_ADDRESS', 'nao-responda@sertania.local'),
    };
  }

  async publicSettings(): Promise<SmtpSettingsPublic> {
    const settings = await this.current();
    return {
      configured: settings.user !== '' && settings.password !== '',
      email: settings.user,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      starttls: settings.starttls,
      fromAddress: settings.fromAddress,
    };
  }

  async saveGmail(email: string, appPassword: string, updatedBy: string): Promise<SmtpSettings> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = appPassword.replace(/\s/g, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 320) {
      throw new BadRequestException('Informe um e-mail Gmail valido.');
    }
    if (normalizedPassword.length < 12 || normalizedPassword.length > 200) {
      throw new BadRequestException('Informe uma senha de app valida.');
    }

    const settings: SmtpSettings = {
      host: 'smtp.gmail.com',
      port: 587,
      user: normalizedEmail,
      password: normalizedPassword,
      secure: false,
      starttls: true,
      fromName: this.config.get<string>('SMTP_FROM_NAME', 'Prefeitura de Sertania'),
      fromAddress: normalizedEmail,
    };
    await this.db.transaction(async (tx) => {
      const values: ReadonlyArray<readonly [string, string]> = [
        ['smtp_host', settings.host],
        ['smtp_port', String(settings.port)],
        ['smtp_user', settings.user],
        ['smtp_password_ciphertext', this.encrypt(settings.password)],
        ['smtp_secure', String(settings.secure)],
        ['smtp_starttls', String(settings.starttls)],
        ['smtp_from_name', settings.fromName],
        ['smtp_from_address', settings.fromAddress],
      ];
      for (const [key, value] of values) {
        await tx.run(
          `INSERT INTO "system_settings" ("key","value","updated_by","updated_at")
           VALUES ($1,$2,$3,now())
           ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_by" = EXCLUDED."updated_by", "updated_at" = now()`,
          [key, value, updatedBy],
        );
      }
    });
    return settings;
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  private decrypt(value: string): string {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error('Senha SMTP criptografada invalida.');
    const iv = Buffer.from(parts[0] ?? '', 'base64url');
    const tag = Buffer.from(parts[1] ?? '', 'base64url');
    const encrypted = Buffer.from(parts[2] ?? '', 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
