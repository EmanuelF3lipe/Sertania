import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface KeycloakUser {
  readonly id?: string;
  readonly username?: string;
  readonly email?: string;
}

/** Operacoes administrativas minimas usadas pelo primeiro acesso institucional. */
@Injectable()
export class KeycloakAdminService {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (this.config.get<string>('KEYCLOAK_URL') ?? 'http://localhost:8080').replace(/\/+$/, '');
  }

  private get realm(): string {
    return this.config.get<string>('KEYCLOAK_REALM_SERVERS', 'sertania-servidores');
  }

  private async adminToken(): Promise<string> {
    if (this.accessToken !== null && this.tokenExpiresAt > Date.now() + 10_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: this.config.get<string>('KEYCLOAK_ADMIN_USERNAME', 'admin'),
      password: this.config.get<string>('KEYCLOAK_ADMIN_PASSWORD', 'admin-local-apenas'),
    });
    const response = await fetch(`${this.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new ServiceUnavailableException('Nao foi possivel acessar o provedor institucional.');
    }
    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string') {
      throw new ServiceUnavailableException('Provedor institucional sem credencial administrativa.');
    }
    this.accessToken = payload.access_token;
    this.tokenExpiresAt = Date.now() + Number(payload.expires_in ?? 60) * 1000;
    return payload.access_token;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.adminToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiresAt = 0;
    }
    return response;
  }

  async createDisabledUser(email: string): Promise<string> {
    const search = await this.request(
      `/admin/realms/${encodeURIComponent(this.realm)}/users?email=${encodeURIComponent(email)}`,
    );
    if (!search.ok) throw new ServiceUnavailableException('Nao foi possivel consultar o provedor institucional.');
    const existing = (await search.json()) as KeycloakUser[];
    if (existing.some((user) => user.email?.toLowerCase() === email.toLowerCase())) {
      throw new ConflictException('Ja existe uma conta institucional para este e-mail.');
    }

    const response = await this.request(`/admin/realms/${encodeURIComponent(this.realm)}/users`, {
      method: 'POST',
      body: JSON.stringify({
        username: email,
        email,
        emailVerified: true,
        firstName: 'Servidor',
        lastName: 'Municipal',
        enabled: false,
        requiredActions: [],
      }),
    });
    if (response.status === 409) throw new ConflictException('Ja existe uma conta institucional para este e-mail.');
    if (response.status !== 201) {
      throw new ServiceUnavailableException('Nao foi possivel criar a conta institucional.');
    }
    const location = response.headers.get('location');
    const id = location?.split('/').pop();
    if (id !== undefined && id !== '') return id;

    const verify = await this.request(
      `/admin/realms/${encodeURIComponent(this.realm)}/users?email=${encodeURIComponent(email)}`,
    );
    const users = (await verify.json()) as KeycloakUser[];
    const created = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (created?.id === undefined) throw new ServiceUnavailableException('Conta criada sem identificador.');
    return created.id;
  }

  async activateWithPassword(userId: string, password: string): Promise<void> {
    const path = `/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}`;
    const credential = await this.request(`${path}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: password, temporary: false }),
    });
    if (!credential.ok) {
      throw new ServiceUnavailableException('Nao foi possivel registrar a senha institucional.');
    }
    const enabled = await this.request(path, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, requiredActions: [], emailVerified: true }),
    });
    if (!enabled.ok) {
      throw new ServiceUnavailableException('Nao foi possivel ativar a conta institucional.');
    }
  }
}
