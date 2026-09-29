/**
 * Controller de autenticacao (especificacao secao 12 e 16).
 *
 * O NestJS atua como BFF: o codigo de autorizacao e trocado no servidor, os
 * tokens ficam fora do JavaScript do navegador, e o navegador recebe apenas o
 * identificador opaco de sessao em cookie `__Host-session`.
 */
import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { API_ERROR_CODES } from '@sertania/contracts';
import {
  AuthorizationStateStore,
  type LoginRealm,
  type PendingAuthorization,
} from './authorization-state.store';
import { OidcService } from './oidc.service';
import {
  CsrfService,
  SESSION_COOKIE_NAME,
  SessionService,
  type SessionClaims,
} from './session.service';
import { CurrentSession, CsrfExempt, Public, lerCookie, type AuthenticatedRequest } from './session.guard';
import { Database } from '../database/typed-query';
import { AuthorizationService } from '../authorization/authorization.service';

/**
 * Texto util de um erro, incluindo a CAUSA.
 *
 * A biblioteca de OIDC embrulha a falha do provedor: o erro thrown e
 * `ResponseBodyError: server responded with an error in the response body`, que
 * nao diz nada. A resposta do Keycloak, com `error` e `error_description`, vem
 * na `cause`. Sem percorrer a cadeia o log mostraria sempre a mesma frase, e a
 * causa real ficaria invisivel.
 */
function descricaoDoErro(error: unknown): string {
  const partes: string[] = [];
  let atual: unknown = error;
  // A cadeia tem profundidade limitada: um `cause` cyclical nao pode virar um
  // laco infinito dentro de um tratamento de erro.
  for (let nivel = 0; nivel < 4 && atual !== undefined && atual !== null; nivel += 1) {
    const registro: unknown =
      typeof atual === 'object' && atual !== null && 'cause' in atual
        ? (atual as { cause: unknown }).cause
        : undefined;
    const mensagem =
      atual instanceof Error
        ? atual.message
        : typeof atual === 'string'
          ? atual
          : JSON.stringify(atual);
    partes.push(mensagem);
    if (registro === undefined) break;
    atual = registro;
  }
  return partes.join(' <- ');
}

/** Caminhos de retorno quando o login falha, com mensagem para a interface. */
const LOGIN_ERRORS = {
  cancelled: 'entrar?erro=login_cancelado',
  incomplete: 'entrar?erro=resposta_incompleta',
  invalidState: 'entrar?erro=sessao_invalida',
  failed: 'entrar?erro=falha_no_login',
  blocked: 'entrar?erro=conta_bloqueada',
} as const;

@Controller('api/v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly states: AuthorizationStateStore,
    private readonly sessions: SessionService,
    private readonly csrf: CsrfService,
    private readonly db: Database,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  private get frontEndOrigin(): string {
    return this.config.get<string>('PUBLIC_ORIGIN') ?? 'http://localhost:5173';
  }

  private get cookieName(): string {
    return SESSION_COOKIE_NAME;
  }

  /**
   * O cookie de sessao vai com `Secure`?
   *
   * Duas razoes, e a segunda e a que costuma faltar:
   *
   * 1. Producao precisa de HTTPS, e sem `Secure` o cookie trafegaria em claro.
   *
   * 2. Um cookie com prefixo `__Host-` e DESCARTADO pelo navegador se nao tiver
   *    `Secure`. Nao ha aviso: o login "funciona", o navegador simplesmente
   *    nao guarda o cookie, e a pessoa volta para a tela de entrada na
   *    requisicao seguinte. Por isso o prefixo e a condicao dominante, e a
   *    variavel de ambiente nao pode desligar o que o navegador exige.
   *
   * Sobre `SESSION_COOKIE_SECURE`: o `ConfigService` devolve o texto do `.env`
   * sem converter, e a string `"false"` e VERDADEIRA em JavaScript. Ler o
   * valor direto inverteria a configuracao em silencio. A comparacao e com o
   * texto, e o valor padrao e `true`.
   *
   * Em desenvolvimento o cookie sai por `http://localhost`, e funciona: os
   * navegadores tratam `localhost` como origem confiavel e aceitam cookie
   * `Secure` nele.
   */
  private get secureCookie(): boolean {
    if (this.cookieName.startsWith('__Host-')) return true;
    const bruto = this.config.get<string>('SESSION_COOKIE_SECURE', 'true');
    return bruto.trim().toLowerCase() !== 'false';
  }

  /**
   * Inicio do login do cidadao.
   *
   * Rota separada da de servidor, e nao um parametro: o destino fica fixo na
   * URL, o que impede um link malicioso de trocar o tipo de acesso.
   */
  @Public()
  @CsrfExempt()
  @Get('login/cidadao')
  async loginCitizen(@Res() response: Response): Promise<void> {
    await this.startLogin('citizens', response);
  }

  /** Inicio do login institucional. */
  @Public()
  @CsrfExempt()
  @Get('login/servidor')
  async loginServer(@Res() response: Response): Promise<void> {
    await this.startLogin('servers', response);
  }

  private async startLogin(realm: LoginRealm, response: Response): Promise<void> {
    const front = this.frontEndOrigin;
    try {
      const { url, pending } = await this.oidc.buildLoginUrl(realm, Date.now());
      this.states.remember(pending);
      response.redirect(url.toString());
    } catch (error) {
      // Falha de descoberta do provedor e erro de infraestrutura. O cidadao ve
      // uma mensagem de uso e o log tem o detalhe: sem o log, um erro de
      // configuracao aqui apareceria apenas como "login nao funciona", e a
      // causa ficaria invisivel.
      this.logger.error(
        `Nao foi possivel iniciar o login (${realm}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      response.redirect(`${front}/${LOGIN_ERRORS.failed}`);
    }
  }

  /**
   * Callback do provedor.
   *
   * Confere `state`, troca o codigo no servidor, resolve o usuario interno e
   * cria a sessao. O identificador da sessao e novo a cada login.
   */
  @Public()
  @CsrfExempt()
  @Get('callback')
  async callback(
    @Req() request: AuthenticatedRequest,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') authError: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const front = this.frontEndOrigin;

    if (authError !== undefined) {
      response.redirect(`${front}/${LOGIN_ERRORS.cancelled}`);
      return;
    }
    if (code === undefined || state === undefined) {
      response.redirect(`${front}/${LOGIN_ERRORS.incomplete}`);
      return;
    }

    // `state` desconhecido, expirado ou ja usado e tentativa de injecao. O
    // consume remove a entrada, entao um `state` valido nao serve duas vezes.
    //
    // O realm do fluxo vem do proprio `pending`, e NAO da requisicao. O
    // provedor devolve apenas `code`, `state`, `session_state` e `iss`: nao ha
    // parametro de realm para ler. Ler o fluxo de um parametro que o provedor
    // nao envia faria todo login institucional ser tratado como login de
    // cidadao. E o `pending` e a unica fonte confiavel do fluxo, porque foi
    // gravado por este servidor no momento do redirecionamento.
    const pending = this.states.consume(state);
    if (pending === null) {
      response.redirect(`${front}/${LOGIN_ERRORS.invalidState}`);
      return;
    }
    const realm = pending.realm;

    try {
      // O caminho e a consulta sao os da requisicao real; a origem vem da
      // configuracao. Ver `OidcService.urlDoCallback` para o porque.
      const url = this.oidc.urlDoCallback(request.path, this.consultaRecebida(request));
      const identity = await this.oidc.exchange(code, url, pending);

      // O ambiente demonstrativo usa e-mail + senha no realm institucional.
      // Para contas normais, o e-mail precisa estar marcado como verificado no
      // token. O administrador local e uma excecao explicita: ele e criado pelo
      // provisionamento com dominio `.invalid` e nao precisa passar por uma
      // segunda tela de verificacao de e-mail.
      const isServer = realm === 'servers';
      const adminEmail = this.config.get<string>('KEYCLOAK_ADMIN_EMAIL', 'admin@exemplo.invalid');
      const adminLocal = identity.email === adminEmail;
      if (isServer && !identity.emailVerified && !adminLocal) {
        this.auditAuthFailure(
          identity.subject,
          'EMAIL_NAO_VERIFICADO',
          `e-mail recebido: ${identity.email ?? '(nenhum)'}`,
        );
        response.redirect(`${front}/entrar?erro=email_nao_verificado`);
        return;
      }

      const user = await this.resolveUser(identity, pending);

      const cookie = await this.sessions.create(
        {
          userId: user.id,
          realm: identity.realm,
          isCitizen: !isServer,
          isServer,
          membershipId: null,
          secretariatId: null,
          // Geracao 1 marca sessao recem-criada. A troca de contexto usa uma
          // geracao maior, o que permite revogar as mais antigas.
          generation: 1,
        },
        Date.now(),
      );

      this.setSessionCookie(response, cookie);

      // O destino fica com a INTERFACE, e nao com a API.
      //
      // A API sabe se a pessoa e cidadao ou servidor, mas a rota que mostra o
      // que cada um ve pertence a interface. Redirectar para um caminho
      // fixo aqui duplicaria essa regra em dois lugares, e o primeiro sinal de
      // que algo quebrou seria uma tela em branco depois de um login
      // bem-sucedido. A interface le `/me` e escolhe a rota.
      response.redirect(`${front}/`);
    } catch (error) {
      this.auditAuthFailure(undefined, 'TROCA_FALHOU', descricaoDoErro(error));
      response.redirect(`${front}/${LOGIN_ERRORS.failed}`);
    }
  }

  private get oidcOrigin(): string {
    return this.config.get<string>('KEYCLOAK_URL') ?? 'http://localhost:8080';
  }

  /**
   * Consulta da requisicao, incluindo os parametros que o provedor adiciona.
   *
   * `request.path` traz o caminho sem a consulta, e a URL de troca precisa do
   * `code` e do `state`. Keycloak acrescenta ainda `session_state` e `iss`, e
   * eles devem ser repassados: e o `iss` que permite a biblioteca conferir o
   * emissor do token contra o emissor esperado.
   */
  private consultaRecebida(request: AuthenticatedRequest): string {
    const original = new URL(request.originalUrl, 'http://localhost').search;
    return original;
  }

  /**
   * Grava o cookie de sessao.
   *
   * Os tres requisitos do prefixo `__Host-` ficam explicitos: `Secure`, `Path=/`
   * e ausencia de `Domain`. Juntos impedem que um subdominio leia o cookie.
   */
  private setSessionCookie(response: Response, cookie: string): void {
    response.cookie(this.cookieName, cookie, {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'lax',
      path: '/',
      // Duracao maxima da sessao. Depois disso o servidor recusa, mesmo com o
      // cookie ainda no navegador.
      // Express interpreta `maxAge` em milissegundos. Passar segundos aqui
      // fazia o cookie expirar em 28,8 segundos, embora a sessao no Redis
      // continuasse valida por horas; a interface parecia deslogar sozinha.
      maxAge: 8 * 60 * 60 * 1000,
    });
  }

  /**
   * Resolve o usuario interno a partir da identidade externa.
   *
   * Nao existe senha local. A conta de cidadao nasce na primeira autenticacao
   * e o vinculo institucional NUNCA nasce aqui: cadastro publico so cria
   * identidade de cidadao, e uma selecao de perfil enviada pelo frontend jamais
   * concede funcao (secao 12).
   */
  private async resolveUser(
    identity: { subject: string; realm: string; email: string | null },
    pending: PendingAuthorization,
  ): Promise<{ id: string; isServer: boolean }> {
    const issuer = this.oidcIssuer;

    return this.db.transaction(async (tx) => {
      const existentes = await tx.run(
        `SELECT "u"."id" FROM "users" u
           JOIN "external_identities" e ON e."user_id" = u."id"
          WHERE e."issuer" = $1 AND e."subject" = $2`,
        [issuer, identity.subject],
      );
      const jaExiste = existentes[0];
      if (jaExiste !== undefined) {
        return { id: jaExiste['id'] as string, isServer: pending.realm === 'servers' };
      }

      // Servidor sem conta interna NAO e criado no login. O vinculo
      // institucional e provisionado por um administrador, e um servidor que
      // entra no sistema sem vinculo nao tem fila nenhuma.
      if (pending.realm === 'servers') {
        throw new Error('Conta institucional sem vinculo provisionado');
      }

      const criados = await tx.run(
        `INSERT INTO "users" ("is_citizen","is_server") VALUES (true,false) RETURNING "id"`,
      );
      const userId = criados[0];
      if (userId === undefined) throw new Error('Criacao de cidadao nao devolveu id');

      await tx.run(
        `INSERT INTO "external_identities" ("user_id","issuer","subject","realm","email")
         VALUES ($1,$2,$3,$4,$5)`,
        [userId['id'], issuer, identity.subject, identity.realm, identity.email],
      );
      return { id: userId['id'] as string, isServer: false };
    });
  }

  private get oidcIssuer(): string {
    return this.config.get<string>('KEYCLOAK_URL') ?? 'http://localhost:8080';
  }

  private auditAuthFailure(subject: string | undefined, reason: string, detail?: string): void {
    this.logger.warn(
      `Falha de autenticacao: ${reason}${subject === undefined ? '' : ` (subject ${subject})`}${
        detail === undefined ? '' : ` ${detail}`
      }`,
    );
  }

  /**
   * Sessao atual, com contextos e capacidades autorizadas (secao 16).
   *
   * `/me` entrega apenas o que o vinculo atual permite. A consulta acontece
   * AGORA, e nao a partir de um papel guardado na sessao: um vinculo revogado
   * precisa ter efeito na proxima chamada.
   */
  @Get('me')
  async me(@CurrentSession() session: SessionClaims | undefined): Promise<{
    authenticated: boolean;
    isCitizen: boolean;
    isServer: boolean;
    userId: string | null;
    contexts: ReadonlyArray<{
      contextId: string;
      secretariatId: string;
      secretariatName: string;
      unitIds: readonly string[];
      roles: readonly string[];
      isCurrent: boolean;
    }>;
    /** Rotas que a interface pode oferecer com seguranca. */
    can: { openRequest: boolean; viewQueue: boolean; complete: boolean };
  }> {
    if (!session) {
      return {
        authenticated: false,
        isCitizen: false,
        isServer: false,
        userId: null,
        contexts: [],
        can: { openRequest: false, viewQueue: false, complete: false },
      };
    }

    const now = new Date();
    const subject = await this.authorization.subjectFor(session, now);
    const vinculos = subject.memberships;
    const nomes = await this.nomesDeSecretaria(vinculos.map((m) => m.secretariatId));

    return {
      authenticated: true,
      isCitizen: session.isCitizen,
      isServer: session.isServer,
      userId: session.userId,
      contexts: vinculos.map((m) => ({
        contextId: m.membershipId,
        secretariatId: m.secretariatId,
        secretariatName: nomes.get(m.secretariatId) ?? '',
        unitIds: m.unitIds,
        roles: [m.role],
        isCurrent: session.membershipId === m.membershipId,
      })),
      can: {
        // Um cidadao autenticado abre pedido. Um servidor sem vinculo nao.
        openRequest: session.isCitizen,
        viewQueue: vinculos.some((m) => m.role !== 'TECH_ADMIN' && m.role !== 'AUDITOR'),
        complete: vinculos.some(
          (m) => m.role === 'ATTENDANT' || m.role === 'SECRETARY_MANAGER',
        ),
      },
    };
  }

  /**
   * Nome das secretarias, para a interface montar o seletor de contexto.
   *
   * Uma consulta so, e nao uma por vinculo: `/me` roda a cada carregamento de
   * pagina e o numero de contextos e pequeno, mas a consulta por vinculo
   * transformaria a tela em N idas ao banco.
   */
  private async nomesDeSecretaria(ids: readonly string[]): Promise<Map<string, string>> {
    const nomes = new Map<string, string>();
    if (ids.length === 0) return nomes;

    const linhas = await this.db.run(
      `SELECT "id", "name" FROM "secretariats" WHERE "id" = ANY($1::uuid[])`,
      [[...new Set(ids)]],
    );
    for (const linha of linhas) {
      nomes.set(linha['id'] as string, linha['name'] as string);
    }
    return nomes;
  }

  /**
   * Token CSRF da sessao atual.
   *
   * O token nao e segredo; ele e derivado do identificador HttpOnly da sessao.
   * A interface precisa deste endpoint porque nao pode ler `__Host-session`.
   */
  @Get('csrf')
  @Public()
  @CsrfExempt()
  csrfToken(@Req() request: AuthenticatedRequest): { token: string } {
    const raw = lerCookie(request, SESSION_COOKIE_NAME);
    const sessionId = raw?.split('.')[0] ?? '';
    return { token: sessionId === '' ? '' : this.csrf.tokenFor(sessionId) };
  }

  /**
   * Logout.
   *
   * Encerra a sessao no servidor imediatamente. O logout do PROVEDOR e
   * redirecionamento para o Keycloak, feito pela interface depois de esta
   * resposta, para que a sessao local morra primeiro.
   */
  @Public()
  @CsrfExempt()
  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true }> {
    const raw = lerCookie(request, SESSION_COOKIE_NAME);
    if (raw !== undefined) {
      // `revoke` aceita o valor do cookie inteiro e separa o identificador
      // sozinho. Sem o identificador nao da para revogar as sessoes todas do
      // usuario, entao a revogacao em lote fica para a administracao; aqui
      // encerra-se apenas a sessao corrente.
      await this.sessions.revoke(raw);
    }
    // `path` precisa ser igual ao do cookie, ou o navegador guarda o cookie
    // antigo e o logout parece funcionar sem encerrar nada.
    response.clearCookie(this.cookieName, { path: '/', secure: this.secureCookie });
    return { ok: true };
  }

  /**
   * URL de logout do PROVEDOR.
   *
   * Fica separada do logout local porque as duas coisas sao diferentes: aqui
   * encerra-se a sessao do servidor, e o cookie morre. A sessao SSO do Keycloak
   * vive no navegador e so morre com um redirecionamento.
   *
   * Nao ha `id_token_hint` aqui: os tokens ficam no servidor e sao descartados
   * logo apos a troca. O Keycloak aceita o logout por `client_id` com
   * `post_logout_redirect_uri` cadastrado, que e o caminho usado.
   */
  @Get('logout/provedor')
  logoutDoProvedor(@CurrentSession() session: SessionClaims | undefined): { url: string | null } {
    if (session === undefined) return { url: null };
    const realm: LoginRealm = session.isServer ? 'servers' : 'citizens';
    return { url: this.oidc.logoutUrl(realm, null) };
  }

  /**
   * Troca o contexto de trabalho.
   *
   * E uma mudanca de privilegio: a sessao e rotacionada, de modo que um
   * identificador capturado antes nao pode ser reutilizado depois com o novo
   * escopo.
   */
  @Post('context')
  async switchContext(
    @Body() body: { membershipId?: string },
    @CurrentSession() session: SessionClaims | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!session) {
      return { ok: false, error: API_ERROR_CODES.UNAUTHENTICATED };
    }
    const membershipId = body.membershipId;
    if (membershipId === undefined || membershipId.length === 0) {
      return { ok: false, error: 'VINCULO_NAO_INFORMADO' };
    }

    const now = new Date();
    const subject = await this.authorization.subjectFor(session, now);
    const vinculo = subject.memberships.find((m) => m.membershipId === membershipId);
    if (vinculo === undefined) {
      // O vinculo e reconsultado do banco, entao um vinculo revogado entre o
      // login e esta chamada nao pode ser selecionado.
      return { ok: false, error: API_ERROR_CODES.FORBIDDEN };
    }

    const cookie = await this.sessions.create(
      {
        userId: session.userId,
        realm: session.realm,
        isCitizen: session.isCitizen,
        isServer: session.isServer,
        membershipId: vinculo.membershipId,
        secretariatId: vinculo.secretariatId,
        generation: session.generation + 1,
      },
      now.getTime(),
    );
    this.setSessionCookie(response, cookie);
    return { ok: true };
  }
}
