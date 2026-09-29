/**
 * Cliente OIDC com Keycloak (especificacao secao 12).
 *
 * Decisoes que sustentam este arquivo:
 *
 * 1. Authorization Code com PKCE S256. O realm institucional tem os fluxos
 *    implicit e password desabilitados, e este cliente nunca os usa.
 *
 * 2. O codigo e trocado NO SERVIDOR. Os tokens ficam fora do JavaScript do
 *    navegador: o navegador recebe apenas o identificador opaco de sessao, em
 *    cookie. Esse e o papel de BFF do NestJS.
 *
 * 3. `state` e `nonce` ficam guardados no SERVIDOR, nao no navegador. Guardados
 *    no cliente, um atacante com acesso ao storage fabricaria o par.
 *
 * 4. `state` e de uso unico. Consumir remove a entrada, o que impede
 *    reaproveitar um codigo de autorizacao interceptado.
 *
 * 5. A validacao de issuer, assinatura, audience, expiracao e nonce e feita
 *    pela biblioteca durante `authorizationCodeGrant`. Confiar em um desses
 *    isoladamente permitiria forjar sessao.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  allowInsecureRequests,
  ClientSecretPost,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from 'openid-client';
import type { LoginRealm, PendingAuthorization } from './authorization-state.store';

/** Realm de destino do login. */
export { AuthorizationStateStore, type LoginRealm, type PendingAuthorization } from './authorization-state.store';

export interface OidcSettings {
  /**
   * URL publica do SERVIDOR do Keycloak, como o NAVEGADOR ve.
   *
   * E a base, sem o realm. A URL de emissor de um realm e derivada daqui em
   * `issuerFor`. Apontar esta configuracao direto para o emissor do realm
   * resolveria a descoberta no realm `master`, que e o realm de administracao
   * do Keycloak: o login funcionaria e as contas seriam as erradas.
   */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** URI de retorno, comparada byte a byte na troca. */
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
  /** Conector de realm, para montar a URL de login. */
  readonly citizenRealm: string;
  readonly serverRealm: string;
  /**
   * Permite falar com um provedor em HTTP simples?
   *
   * A biblioteca recusa HTTP por padrao, como defesa contra SSRF: a URL de
   * descoberta vem de configuracao e uma resposta maliciosa poderia apontar a
   * troca de token para um destino arbitrario. Em desenvolvimento o Keycloak
   * local nao tem certificado, e a excecao e Necessaria; em producao o
   * validador de ambiente ja recusou as credenciais de demonstracao, entao o
   * valor e ligado apenas fora de `production`.
   */
  readonly allowInsecureRequests: boolean;
}

export interface AuthenticatedIdentity {
  readonly subject: string;
  readonly realm: string;
  readonly email: string | null;
  /**
   * Metodos de autenticacao declarados no token.
   *
   * A checagem de "isto prova segundo fator" vive em `second-factor.ts`, e nao
   * aqui: e uma regra de dominio, e nao um detalhe do OIDC.
   */
  readonly amr: readonly string[];
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly cache = new Map<string, Promise<Configuration>>();

  constructor(private readonly settings: OidcSettings) {}

  private realmName(realm: LoginRealm): string {
    return realm === 'citizens' ? this.settings.citizenRealm : this.settings.serverRealm;
  }

  /**
   * Emissor de um realm: a base do servidor mais o caminho do realm.
   *
   * A descoberta OIDC acontece em `{emissor}/.well-known/openid-configuration`.
   * Com a base do servidor, essa URL resolve para os METADADOS DO REALM MASTER
   * e o login usaria as contas de administracao. Por isso o emissor do realm e
   * sempre montado antes de qualquer chamada de rede.
   */
  issuerFor(realm: LoginRealm): string {
    return `${this.settings.issuer.replace(/\/+$/, '')}/realms/${this.realmName(realm)}`;
  }

  /**
   * Descobre o provedor, uma vez por realm.
   *
   * A descoberta e assincrona e fica em cache como promessa, para que N
    * requisicoes simultaneas no primeiro uso nao façam N chamadas de rede. Se o
   * issuer estiver errado, a falha aparece na primeira navegacao e nao de
   * forma silenciosa.
   */
  private configFor(realm: LoginRealm): Promise<Configuration> {
    const name = this.realmName(realm);
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;

    const pending = discovery(
      new URL(this.issuerFor(realm)),
      this.settings.clientId,
      {
        client_secret: this.settings.clientSecret,
        // `code` apenas: implicit deixaria o token no fragmento da URL, e
        // `password` permitiria login direto sem navegador.
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'client_secret_post',
      },
      ClientSecretPost(this.settings.clientSecret),
      // Lista vazia em producao: mantem a recusa de HTTP da biblioteca, que e
      // o que impede a descoberta de ser desviada por HTTP para um host
      // interno. Vazia significa "nenhuma excecao concedida".
      this.settings.allowInsecureRequests ? { execute: [allowInsecureRequests] } : {},
    )
      .then((config) => {
        this.logger.log(
          `Provedor OIDC descoberto para o realm ${name}` +
            (this.settings.allowInsecureRequests ? ' (HTTP liberado: ambiente local)' : ''),
        );
        return config;
      })
      .catch((error: unknown) => {
        // Remove do cache para que a proxima tentativa refaca a descoberta, em
        // vez de repetir a falha por um dia.
        this.cache.delete(name);
        throw error;
      });

    this.cache.set(name, pending);
    return pending;
  }

  /** Testa se o provedor responde, sem autenticar. */
  async checkAvailability(): Promise<boolean> {
    try {
      await this.configFor('citizens');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gera a URL de autorizacao com `state`, `nonce` e PKCE.
   */
  async buildLoginUrl(realm: LoginRealm, now: number): Promise<{ url: URL; pending: PendingAuthorization }> {
    const config = await this.configFor(realm);

    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();
    const codeChallenge = await this.codeChallengeFor(codeVerifier);

    const url = buildAuthorizationUrl(config, {
      redirect_uri: this.settings.redirectUri,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    const pending: PendingAuthorization = { state, nonce, codeVerifier, createdAt: now, realm };
    return { url, pending };
  }

  /**
   * Challenge S256.
   *
   * O `code_challenge` e o SHA-256 do verificador, em base64url. `plain` seria
   * aceito por alguns provedores, mas o RFC exige S256 quando suportado.
   */
  private async codeChallengeFor(verifier: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * URL que o navegador realmente usou para voltar do provedor.
   *
   * A origem vem do `redirect_uri` CONFIGURADO, e nao da requisicao recebida.
   * A biblioteca de OIDC deriva o `redirect_uri` da URL que recebe, entao
   * montar essa URL com a origem errada faz a troca ser recusada com
   * `Incorrect redirect_uri`. E montar com a origem da requisicao seria pior
   * ainda: um `Host` adulterado passaria a definir para onde o token e
   * entregue.
   *
   * O caminho tambem e conferido. Um codigo entregue em um endpoint diferente do
   * configurado nao e o codigo que este pedido esperava, e o interceptor
   * holofote do codigo de autorizacao e a defesa principal contra isso.
   */
  urlDoCallback(caminhoRecebido: string, consultaRecebida: string): URL {
    const configurado = new URL(this.settings.redirectUri);
    const recebido = new URL(caminhoRecebido, configurado.origin);

    if (recebido.pathname !== configurado.pathname) {
      throw new Error(
        `Callback em caminho inesperado: ${recebido.pathname}, esperado ${configurado.pathname}`,
      );
    }

    // `code`, `state` e `iss` vem da requisicao real; a base vem da
    // configuracao, que e o que o provedor conhece.
    return new URL(`${configurado.pathname}${consultaRecebida}`, configurado.origin);
  }

  /**
   * Troca o codigo por tokens e valida tudo.
   *
   * O que `authorizationCodeGrant` confere, e porque cada item e necessario:
   *
   * - `state`: casa o callback com o pedido de login que ESTA sessao iniciou.
   *   Sem isso, um codigo de outra pessoa seria aceito nesta sessao.
   * - `nonce`: prova que o token foi emitido PARA este pedido. Sem ele, um
   *   token antigo do mesmo cliente, jogado na URL, passaria.
   * - `pkceCodeVerifier`: prova que quem recebe o codigo e quem o pediu. E o
   *   que impede o roubo de codigo pela URL de redirecionamento.
   * - `iss`, `aud`, assinatura e `exp`: conferidos pela biblioteca contra os
   *   metadados do provedor descobertos em `configFor`. Um token de outro
   *   emissor, para outra aplicacao, ou fora do prazo e recusado.
   *
   * A validacao de emissor NAO e passada como opcao: a biblioteca compara o
   * `iss` do token com o `issuer` dos metadados que ela mesma descobriu. Como
   * a descoberta parte de `issuerFor(realm)`, um token de outro realm nao
   * passa, mesmo com assinatura valida.
   */
  async exchange(
    code: string,
    currentUrl: URL,
    pending: PendingAuthorization,
  ): Promise<AuthenticatedIdentity> {
    const config = await this.configFor(pending.realm);

    // Sem anotacao de tipo: a anotacao com `TokenEndpointResponse` perderia os
    // METODOS que a biblioteca acrescenta (`claims()`), e o resultado seria
    // tratado como um objeto de respostas cru.
    const tokens = await authorizationCodeGrant(config, currentUrl, {
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      pkceCodeVerifier: pending.codeVerifier,
    });

    const claims = tokens.claims();
    if (claims === undefined) {
      throw new Error('Resposta do provedor sem ID token');
    }

    const subject = claims.sub;
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new Error('Token sem subject');
    }

    const amr = Array.isArray(claims.amr) ? (claims.amr as string[]) : [];
    const email = typeof claims.email === 'string' ? claims.email : null;

    // Defesa contra seguir um link de login e entrar com conta de servidor numa
    // sessao de cidadao, ou o contrario. A validacao de `iss` JA recusa um
    // token de outro realm, porque a descoberta foi feita no realm esperado;
    // esta segunda checagem existe para o caso em que a aplicacao for
    // configurada com um emissor de grupo, e nao por realm.
    //
    // Ausencia do campo NAO e falha: `realm` e uma alegacao do Keycloak, e o
    // campo padrao e `realm_access.realm`. Confiar nela como unica prova seria
    // fragil. Presente e diferente do esperado, e falha.
    const esperado = this.realmName(pending.realm);
    const realmClaim = typeof claims.realm === 'string' ? claims.realm : esperado;
    if (realmClaim !== esperado) {
      this.logger.warn(
        `Token de realm ${realmClaim} chegou no fluxo de ${esperado}; recusado`,
      );
      throw new Error('Realm do token nao corresponde ao fluxo');
    }

    return { subject, realm: realmClaim, email, amr };
  }

  /** URL de logout do provedor, para revogacao central. */
  logoutUrl(realm: LoginRealm, idTokenHint: string | null): string {
    const url = new URL(
      `/realms/${this.realmName(realm)}/protocol/openid-connect/logout`,
      this.settings.issuer,
    );
    url.searchParams.set('post_logout_redirect_uri', this.settings.postLogoutRedirectUri);
    url.searchParams.set('client_id', this.settings.clientId);
    if (idTokenHint !== null) {
      url.searchParams.set('id_token_hint', idTokenHint);
    }
    return url.toString();
  }
}