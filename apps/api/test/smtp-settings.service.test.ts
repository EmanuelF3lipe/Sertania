import { describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { Database } from '../src/database/typed-query';
import { SmtpSettingsService } from '../src/auth/smtp-settings.service';

describe('SmtpSettingsService', () => {
  it('salva a senha de app criptografada e nunca a devolve na configuracao publica', async () => {
    const values = new Map<string, string>();
    const config = {
      get: jest.fn(
        (key: string, fallback?: string) =>
          ({
            SESSION_SECRET: 's'.repeat(32),
            SMTP_HOST: '127.0.0.1',
            SMTP_PORT: '1025',
            SMTP_FROM_NAME: 'Prefeitura',
            SMTP_FROM_ADDRESS: 'nao-responda@sertania.local',
          })[key] ?? fallback,
      ),
    } as unknown as ConfigService;
    const database = {
      run: jest.fn(async () => [...values.entries()].map(([key, value]) => ({ key, value }))),
      transaction: jest.fn(
        async (
          work: (tx: {
            run: (sql: string, params?: unknown[]) => Promise<readonly unknown[]>;
          }) => Promise<unknown>,
        ) =>
          work({
            run: async (_sql: string, params: unknown[] = []) => {
              values.set(String(params[0]), String(params[1]));
              return [];
            },
          }),
      ),
    } as unknown as Database;
    const service = new SmtpSettingsService(database, config);

    await service.saveGmail('Teste@Gmail.com', 'abcd efgh ijkl mnop', 'admin-id');
    const publicSettings = await service.publicSettings();

    expect(publicSettings).toMatchObject({
      configured: true,
      email: 'teste@gmail.com',
      host: 'smtp.gmail.com',
      port: 587,
    });
    expect(publicSettings).not.toHaveProperty('password');
    expect(values.get('smtp_password_ciphertext')).toBeDefined();
    expect(values.get('smtp_password_ciphertext')).not.toContain('abcdefghijklmnop');
  });
});
