import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { KeycloakAdminService } from '../src/auth/keycloak-admin.service';

describe('KeycloakAdminService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ativa o convite exigindo verificacao de e-mail', async () => {
    const buscar = jest.fn(
      (key: string, fallback?: string) =>
        ({
          KEYCLOAK_URL: 'http://keycloak.test',
          KEYCLOAK_REALM_SERVERS: 'servidores',
          KEYCLOAK_ADMIN_USERNAME: 'admin',
          KEYCLOAK_ADMIN_PASSWORD: 'senha',
        })[key] ?? fallback,
    );
    const service = new KeycloakAdminService({ get: buscar } as unknown as ConfigService);
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await service.activateWithPassword('user-id', 'SenhaInstitucional!2026');

    expect(fetch).toHaveBeenCalledTimes(3);
    const update = fetch.mock.calls[2]?.[1];
    expect(JSON.parse(String(update?.body as string))).toEqual({
      enabled: true,
      requiredActions: ['VERIFY_EMAIL'],
      emailVerified: false,
    });
  });

  it('cria a conta institucional ainda sem e-mail verificado e desabilitada', async () => {
    const buscar = jest.fn(
      (key: string, fallback?: string) =>
        ({
          KEYCLOAK_URL: 'http://keycloak.test',
          KEYCLOAK_REALM_SERVERS: 'servidores',
          KEYCLOAK_ADMIN_USERNAME: 'admin',
          KEYCLOAK_ADMIN_PASSWORD: 'senha',
        })[key] ?? fallback,
    );
    const service = new KeycloakAdminService({ get: buscar } as unknown as ConfigService);
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 201,
          headers: { location: 'http://keycloak.test/admin/realms/servidores/users/new-id' },
        }),
      );

    await service.createDisabledUser('novo.servidor@exemplo.invalid');

    const creation = fetch.mock.calls[2]?.[1];
    expect(JSON.parse(String(creation?.body as string))).toMatchObject({
      emailVerified: false,
      enabled: false,
      requiredActions: [],
    });
  });
});
