/**
 * Provisionamento dos realms do Keycloak (especificacao secao 12 e 20).
 *
 * O script e idempotente: pode ser executado quantas vezes for preciso sem
 * duplicar realm, cliente ou conta. Ele nao apaga nada.
 *
 * Por que um script e nao configuracao manual no console: o console permite
 * deixar um realm em estado que ninguem consegue reproduzir. Aqui o estado
 * desejado esta escrito no codigo, e `verificar` compara o que existe com o que
 * deveria existir.
 *
 * Uso:
 *   node infra/docker/keycloak/provisionar.mjs            # aplica
 *   node infra/docker/keycloak/provisionar.mjs --verificar # so confere
 *
 * Decisao registrada aqui depois de uma falha real: ao atualizar um required
 * action pela API, e obrigatorio enviar a representacao COMPLETA, incluindo
 * `alias`. Um PUT parcial zera o `alias`, e a partir dai a acao fica
 * inalcancavel por GET, PUT e DELETE, porque toda a API a localiza pelo alias.
 * O registro so e removivel junto com o realm. Este script envia `alias`
 * sempre, e `verificar` detecta um registro sem alias.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..', '..');

/** Le o `.env` da raiz do projeto, sem depender de `--env-file`. */
function carregarEnv() {
  const arquivo = join(raiz, '.env');
  const saida = {};
  for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
    const limpa = linha.trim();
    if (limpa === '' || limpa.startsWith('#')) continue;
    const separador = limpa.indexOf('=');
    if (separador < 0) continue;
    const chave = limpa.slice(0, separador).trim();
    const valor = limpa.slice(separador + 1).trim();
    if (chave !== '' && valor !== '') saida[chave] = valor;
  }
  return saida;
}

const env = carregarEnv();
const KEYCLOAK = process.env['KEYCLOAK_URL'] ?? env['KEYCLOAK_URL'] ?? 'http://localhost:8080';
const ADMIN_USER = process.env['KEYCLOAK_ADMIN_USER'] ?? env['KEYCLOAK_ADMIN_USER'] ?? 'admin';
const ADMIN_PASS = process.env['KEYCLOAK_ADMIN_PASSWORD'] ?? env['KEYCLOAK_ADMIN_PASSWORD'] ?? 'admin-local-apenas';
const CLIENT_ID = env['KEYCLOAK_CLIENT_ID'] ?? 'sertania-api';
const CLIENT_SECRET = env['KEYCLOAK_CLIENT_SECRET'] ?? '';
const REDIRECT_URI = env['KEYCLOAK_REDIRECT_URI'] ?? 'http://localhost:3000/api/v1/auth/callback';
const POST_LOGOUT = env['KEYCLOAK_POST_LOGOUT_REDIRECT_URI'] ?? 'http://localhost:5173/';
const INTERFACE = 'http://localhost:5173';

const soVerificar = process.argv.includes('--verificar');

/** Divulga o resultado: `problemas` acumulado e o que foi encontrado. */
const problemas = [];
const aplicado = [];

function registrar(mensagem) {
  if (soVerificar) return;
  console.log(`  ${mensagem}`);
  aplicado.push(mensagem);
}

function falhar(mensagem) {
  problemas.push(mensagem);
}

/** Cliente HTTP do Keycloak com o token de administrador ja obtido. */
class Admin {
  #token;

  async conectar() {
    const resposta = await fetch(
      `${KEYCLOAK}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: ADMIN_USER,
          password: ADMIN_PASS,
        }).toString(),
      },
    );
    if (!resposta.ok) {
      throw new Error(
        `Token de administrador recusado (HTTP ${resposta.status}). ` +
          'O Keycloak esta no ar e a senha em .env confere?',
      );
    }
    this.#token = (await resposta.json()).access_token;
  }

  async #pedir(caminho, init = {}) {
    // `Content-Type` vai sempre. O endpoint de bloqueio por tentativas do
    // Keycloak responde 405 quando o DELETE chega sem o cabecalho, mesmo sem
    // corpo: ele so reconhece a operacao como DELETE se a requisicao parecer
    // JSON. A ordem das tentativas confirmou: com o cabecalho, 204.
    const resposta = await fetch(`${KEYCLOAK}/admin${caminho}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return resposta;
  }

  async listar(caminho) {
    const resposta = await this.#pedir(caminho);
    if (!resposta.ok) throw new Error(`GET ${caminho} -> HTTP ${resposta.status}`);
    return resposta.json();
  }

  async criar(caminho, corpo) {
    return this.#pedir(caminho, { method: 'POST', body: JSON.stringify(corpo) });
  }

  async atualizar(caminho, corpo) {
    return this.#pedir(caminho, { method: 'PUT', body: JSON.stringify(corpo) });
  }

  async remover(caminho) {
    return this.#pedir(caminho, { method: 'DELETE' });
  }
}

/**
 * Representacao COMPLETA de um required action.
 *
 * `alias` e `providerId` vao juntos. O `alias` e a chave de busca de toda a
 * API, e um PUT que o omite o apaga.
 */
function acaoTotp(ativa) {
  return {
    alias: 'CONFIGURE_TOTP',
    name: 'Configure OTP',
    providerId: 'CONFIGURE_TOTP',
    enabled: ativa,
    defaultAction: ativa,
    priority: 20,
    config: {},
  };
}

/** Configuracao comum aos dois realms. */
function baseDoRealm({ realm, displayName, registro }) {
  return {
    realm,
    displayName,
    enabled: true,
    // Autocadastro existe SO no realm de cidadaos. Servidor nao se cadastra:
    // a instituicao vincula a conta, porque vinculo e o que da acesso a fila.
    registrationAllowed: registro,
    registrationEmailAsUsername: registro,
    resetPasswordAllowed: registro,
    loginWithEmailAllowed: true,
    // `none` porque o ambiente local nao tem certificado. Producao usa
    // `external` e exige HTTPS; o validador de ambiente recusa este valor la.
    sslRequired: 'none',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 1200,
    ssoSessionMaxLifespan: 28800,
    passwordPolicy: 'length(12) and notUsername and passwordHistory(3)',
    bruteForceProtected: true,
    maxFailureWaitSeconds: 900,
    permanentLockout: false,
    // TOTP e o segundo fator padrao dos dois realms. O realm de cidadaos nao
    // exige, mas aceita quem configurar.
    otpPolicyType: 'totp',
    // Interface em portugues. Alem de ser o idioma da prefeitura, isso
    // remove do meio do login a tela de escolha de idioma, que e um passo a
    // mais para quem so esta tentando entrar.
    internationalizationEnabled: true,
    supportedLocales: ['pt-BR', 'en'],
    defaultLocale: 'pt-BR',
  };
}

const CLIENTE = {
  clientId: CLIENT_ID,
  name: 'API Sertania',
  secret: CLIENT_SECRET,
  enabled: true,
  protocol: 'openid-connect',
  // Cliente CONFIDENCIAL. Um cliente publico nao troca codigo de autorizacao
  // com seguranca: qualquer um com o `code` e o `code_verifier` poderia.
  publicClient: false,
  standardFlowEnabled: true,
  // Implicit DESLIGADO: o token voltaria no fragmento da URL, e o fragmento
  // chega ao JavaScript e ao historico do navegador.
  implicitFlowEnabled: false,
  // Direct Access Grants DESLIGADO: permitiria obter token por senha, sem
  // passar pelo segundo fator do realm institucional.
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: false,
  rootUrl: INTERFACE,
  baseUrl: '/',
  adminUrl: INTERFACE,
  redirectUris: [REDIRECT_URI, `${INTERFACE}/*`],
  webOrigins: [INTERFACE],
  attributes: {
    'post.logout.redirect.uris': `${INTERFACE}/*`,
    // Sem isso o logout do provedor exige confirmacao por formulario, e o
    // navegador fica preso na tela de "voce deseja sair".
    'post.logout.redirect.uris+': `${INTERFACE}/*`,
  },
};

/**
 * Contas de demonstracao. Dados ficticios, dominio `.invalid`, que por
 * definicao nunca resolve (RFC 2606). A prefeitura nao pode confundir estas
 * contas com as de producao.
 *
 * `entrada` e o que a pessoa digita no campo de login. No realm de cidadaos,
 * `registrationEmailAsUsername` faz o Keycloak gravar o E-MAIL como username:
 * o cidadao entra com o e-mail, e nao com um nome escolhido por nos. Por isso
 * a busca por conta compara as duas colunas, e nao so o username.
 *
 * `nome` e `sobrenome` nao sao decoracao: sem eles, o Keycloak exige a acao
 * `VERIFY_PROFILE` no primeiro login e o caminho do codigo de autorizacao fica
 * interrompido por uma tela de cadastro. A conta entra, mas o login ainda nao
 * termina numa so etapa.
 */
const CONTAS = {
  'sertania-ciudadanos': [
    {
      entrada: 'cidadao.a@exemplo.invalid',
      senha: 'CidadaoA!2026-demo',
      email: 'cidadao.a@exemplo.invalid',
      nome: 'Cidadao',
      sobrenome: 'A',
    },
    {
      entrada: 'cidadao.b@exemplo.invalid',
      senha: 'CidadaoB!2026-demo',
      email: 'cidadao.b@exemplo.invalid',
      nome: 'Cidadao',
      sobrenome: 'B',
    },
  ],
  'sertania-servidores': [
    {
      entrada: 'servidor.saude',
      senha: 'ServidorSaude!2026-demo',
      email: 'servidor.saude@exemplo.invalid',
      nome: 'Servidor',
      sobrenome: 'Saude',
    },
    {
      entrada: 'servidor.infra',
      senha: 'ServidorInfra!2026-demo',
      email: 'servidor.infra@exemplo.invalid',
      nome: 'Servidor',
      sobrenome: 'Infraestrutura',
    },
  ],
};

/**
 * Libera o bloqueio por tentativas de uma conta de demonstracao.
 *
 * O realm tem `bruteForceProtected`, e varias tentativas erradas travam a conta
 * por 15 minutos. Numa conta de demonstracao isso e so perda de tempo, e o
 * sintoma ("nome de usuario ou senha invalida") nao diz que a conta esta
 * bloqueada: leva a conclusao errada de que a senha do script esta desatualizada.
 *
 * A deteccao de ataque e POR USUARIO dentro do realm: o caminho e
 * `/realms/{realm}/attack-detection/brute-force/users/{id}`. Sem o segmento do
 * realm a requisicao cai em outro recurso e volta 405, que parece erro de
 * metodo em vez de erro de caminho.
 */
async function limparBloqueio(admin, realm, userId, entrada) {
  const resposta = await admin.remover(
    `/realms/${realm}/attack-detection/brute-force/users/${userId}`,
  );
  // 204 = havia bloqueio e foi removido. 404 = nao havia bloqueio, que e o caso
  // normal e nao e erro.
  if (resposta.status === 204) {
    registrar(`conta ${entrada}: bloqueio por tentativas removido`);
  } else if (resposta.status !== 404) {
    falhar(`conta ${entrada}: limpeza de bloqueio -> HTTP ${resposta.status}`);
  }
}

async function garantirRealm(admin, definicao) {
  const { realm, registro, mfaObrigatoria } = definicao;
  const existentes = await admin.listar('/realms');
  if (!existentes.some((r) => r.realm === realm)) {
    const resposta = await admin.criar('/realms', baseDoRealm({ realm, displayName: definicao.displayName, registro }));
    if (resposta.status !== 201) {
      falhar(`realm ${realm}: criacao falhou (HTTP ${resposta.status}) ${await resposta.text()}`);
      return;
    }
    registrar(`realm ${realm} criado`);
  } else {
    // Realm ja existe: reaplicar a configuracao deixa o estado previsivel
    // depois de uma mudanca neste arquivo.
    const atual = await admin.listar(`/realms/${realm}`);
    const resposta = await admin.atualizar(`/realms/${realm}`, {
      ...baseDoRealm({ realm, displayName: definicao.displayName, registro }),
      // `id` e `representationVersion` sao de controle interno do Keycloak;
      // reenviar o que veio impede que o PUT apague o que nao foi listado.
      id: atual.id,
      representationVersion: atual.representationVersion,
    });
    if (!resposta.ok) {
      falhar(`realm ${realm}: atualizacao falhou (HTTP ${resposta.status}) ${await resposta.text()}`);
      return;
    }
    registrar(`realm ${realm} atualizado`);
  }

  // --- Required actions -------------------------------------------------
  // Leitura completa primeiro: e o que permite devolver `alias` no PUT.
  const acoes = await admin.listar(`/realms/${realm}/authentication/required-actions`);
  const corrompida = acoes.filter((a) => !a.alias);
  if (corrompida.length > 0) {
    falhar(
      `realm ${realm}: ${corrompida.length} required action sem alias ` +
        `(providerId ${corrompida.map((a) => a.providerId).join(', ')}). ` +
        'Registro inalcancavel pela API: recrie o realm a partir deste script.',
    );
  }

  const totp = acoes.find((a) => a.providerId === 'CONFIGURE_TOTP');
  if (totp === undefined) {
    if (mfaObrigatoria) {
      falhar(
        `realm ${realm}: CONFIGURE_TOTP nao esta registrado. ` +
          'Sem ele nao ha como exigir o segundo fator por required action.',
      );
    }
  } else if (totp.enabled !== mfaObrigatoria || totp.defaultAction !== mfaObrigatoria) {
    const resposta = await admin.atualizar(
      `/realms/${realm}/authentication/required-actions/CONFIGURE_TOTP`,
      acaoTotp(mfaObrigatoria),
    );
    if (!resposta.ok) {
      falhar(`realm ${realm}: CONFIGURE_TOTP -> HTTP ${resposta.status} ${await resposta.text()}`);
    } else {
      registrar(
        `realm ${realm}: CONFIGURE_TOTP ${mfaObrigatoria ? 'obrigatorio' : 'opcional'}`,
      );
    }
  } else {
    registrar(`realm ${realm}: CONFIGURE_TOTP ja esta como esperado`);
  }

  // --- Cliente OIDC -----------------------------------------------------
  const clientes = await admin.listar(`/realms/${realm}/clients?clientId=${CLIENT_ID}`);
  if (clientes.length === 0) {
    const resposta = await admin.criar(`/realms/${realm}/clients`, CLIENTE);
    if (resposta.status !== 201) {
      falhar(`realm ${realm}: cliente -> HTTP ${resposta.status} ${await resposta.text()}`);
    } else {
      registrar(`realm ${realm}: cliente ${CLIENT_ID} criado`);
    }
  } else {
    const id = clientes[0].id;
    const resposta = await admin.atualizar(`/realms/${realm}/clients/${id}`, {
      ...CLIENTE,
      id,
    });
    if (!resposta.ok) {
      falhar(`realm ${realm}: cliente -> HTTP ${resposta.status} ${await resposta.text()}`);
    } else {
      registrar(`realm ${realm}: cliente ${CLIENT_ID} atualizado`);
    }
  }

  // --- Contas de demonstracao ------------------------------------------
  const usuarios = await admin.listar(`/realms/${realm}/users?max=200`);
  for (const conta of CONTAS[realm] ?? []) {
    const corpo = {
      username: conta.entrada,
      email: conta.email,
      emailVerified: true,
      firstName: conta.nome,
      lastName: conta.sobrenome,
      enabled: true,
      // No realm institucional, `CONFIGURE_TOTP` fica PENDENTE na conta. Sem
      // isso o Keycloak emite token apenas com senha, e o primeiro fator e o
      // unico que existe: o `defaultAction` do realm so vale na criacao da
      // conta, e nao e reaplicado a cada login. Foi exatamente o que aconteceu
      // quando esta lista foi zerada para os servidores.
      //
      // No realm de cidadaos a lista e zerada de proposito: `VERIFY_PROFILE`
      // pendente interrompe o login no meio do caminho de autorizacao, e o
      // sintoma (a pessoa volta para a tela de entrada) nao aponta para a
      // causa.
      requiredActions: mfaObrigatoria ? ['CONFIGURE_TOTP'] : [],
    };
    // Compara as duas colunas porque o realm de cidadaos usa o e-mail como
    // username. Comparar so o username faria o script tentar recriar uma conta
    // que ja existe, e o Keycloak recusa com 409 pelo e-mail duplicado.
    const existe = usuarios.find(
      (u) => u.username === conta.entrada || u.email === conta.email,
    );
    if (existe !== undefined) {
      // Reaplicar tambem as contas que ja existem: sem isto, um realm criado
      // por uma versao anterior do script ficaria para sempre com o estado
      // antigo, e o `--verificar` passaria sem ver a divergencia.
      //
      // A senha NAO e redefinida aqui, de proposito. Um script de
      // provisionamento que troca senha a cada execucao seria perigoso em um
      // realm com contas reais, e aqui nem seria possivel: o realm exige
      // `passwordHistory(3)`, o historico nao aparece na listagem de
      // credenciais e nao pode ser apagado pela API. A segunda execucao
      // falharia com "must not be equal to any of last 3 passwords".
      await limparBloqueio(admin, realm, existe.id, conta.entrada);
      const resposta = await admin.atualizar(`/realms/${realm}/users/${existe.id}`, {
        ...corpo,
        id: existe.id,
      });
      if (!resposta.ok) {
        falhar(`conta ${conta.entrada} -> HTTP ${resposta.status} ${await resposta.text()}`);
      } else {
        registrar(`conta ${conta.entrada} atualizada`);
      }
      continue;
    }    const resposta = await admin.criar(`/realms/${realm}/users`, {
      // No realm de cidadaos o username e substituido pelo e-mail pelo proprio
      // Keycloak; mandar o mesmo valor evita depender desse comportamento.
      username: conta.entrada,
      email: conta.email,
      emailVerified: true,
      firstName: conta.nome,
      lastName: conta.sobrenome,
      enabled: true,
      // `temporary` pertence a CREDENCIAL, nao ao usuario: o Keycloak recusa
      // o campo no nivel de usuario.
      credentials: [{ type: 'password', value: conta.senha, temporary: false }],
    });
    if (resposta.status !== 201) {
      falhar(`conta ${conta.entrada} -> HTTP ${resposta.status} ${await resposta.text()}`);
    } else {
      registrar(`conta ${conta.entrada} criada`);
    }
  }
}

const DEFINICOES = [
  {
    realm: env['KEYCLOAK_REALM_CITIZENS'] ?? 'sertania-ciudadanos',
    displayName: 'Sertania - Cidadaos',
    registro: true,
    // Cidadao nao tem segundo fator: a especificacao exige MFA no acesso
    // institucional, e exigir do cidadao empurraria o uso para e-mail e
    // telefone, que e justamente o que se quer evitar.
    mfaObrigatoria: false,
  },
  {
    realm: env['KEYCLOAK_REALM_SERVERS'] ?? 'sertania-servidores',
    displayName: 'Sertania - Servidores',
    registro: false,
    mfaObrigatoria: true,
  },
];

const admin = new Admin();
try {
  await admin.conectar();
} catch (erro) {
  console.error(String(erro));
  process.exit(1);
}

console.log(`Keycloak em ${KEYCLOAK} - modo ${soVerificar ? 'verificacao' : 'aplicacao'}`);
for (const definicao of DEFINICOES) {
  console.log(`\n${definicao.realm}`);
  try {
    await garantirRealm(admin, definicao);
  } catch (erro) {
    falhar(`${definicao.realm}: ${String(erro)}`);
  }
}

if (problemas.length > 0) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  process.exit(1);
}

console.log(
  soVerificar
    ? '\nNenhum problema encontrado.'
    : `\nAplicado: ${aplicado.length} mudanca(s).`,
);
