/**
 * Dados de DEMONSTRACAO do catalogo e dos vinculos institucionais (marco C).
 *
 * Este script cria o minimo para que a interface tenha o que mostrar, e liga os
 * servidores do Keycloak as suas Secretarias. Tudo e ficticio: nomes de
 * secretaria e servico sao de exemplo, e os arquivos anexados sao de
 * `.invalid`, dominio que por definicao nao resolve.
 *
 * Idempotente: pode rodar quantas vezes for preciso.
 *
 *   node infra/docker/seed/seed-dev.mjs
 *   node infra/docker/seed/seed-dev.mjs --verificar
 *
 * Por que o vinculo e criado AQUI e nao no primeiro login: no callback, um
 * servidor sem vinculo e recusado. Nao ha como o proprio login decidir a que
 * Secretaria a pessoa pertence, e nao seria seguro permitir. O vinculo e uma
 * decisao administrativa, e este script e essa administracao, com as
 * consequencias visiveis de um comando de linha.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..', '..');
const pg = require(join(raiz, 'apps', 'api', 'node_modules', 'pg'));

function carregarEnv() {
  // Arquivos lidos SEPARADAMENTE, pelo mesmo motivo do provisionamento do banco
  // de teste: este script trabalha no banco de TRABALHO, e precisa do nome
  // desse banco para conferir que nao esta apontando para o de teste. Com um
  // acumulado unico, o `.env.test` sobrescreveria `POSTGRES_DB` e a checagem
  // perderia o sentido: ela compararia o banco de teste com ele mesmo.
  const arquivos = {};
  for (const nome of ['.env', '.env.test']) {
    const destino = {};
    let bruto;
    try {
      bruto = readFileSync(join(raiz, nome), 'utf8');
    } catch {
      arquivos[nome] = destino;
      continue;
    }
    for (const linha of bruto.split(/\r?\n/)) {
      const limpa = linha.trim();
      if (limpa === '' || limpa.startsWith('#')) continue;
      const separador = limpa.indexOf('=');
      if (separador === -1) continue;
      const chave = limpa.slice(0, separador).trim();
      const valor = limpa.slice(separador + 1).trim();
      if (chave !== '' && valor !== '') destino[chave] = valor;
    }
    arquivos[nome] = destino;
  }
  return arquivos;
}

const arquivosEnv = carregarEnv();
const env = arquivosEnv['.env'];
const ADMIN_EMAIL = env['KEYCLOAK_ADMIN_EMAIL'] ?? 'admin@exemplo.invalid';
const bancoDeTeste = arquivosEnv['.env.test']['TEST_POSTGRES_DB'];
const soVerificar = process.argv.includes('--verificar');
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

/**
 * Catalogo de demonstracao.
 *
 * As tres Secretarias sao as da especificacao. Cada uma tem um servico, e os
 * tres casos sao escolhidos de proposito, porque cada um exercita uma
 * regra diferente da politica de autorizacao:
 *
 * - Infraestrutura: classificacao publica. Serve de primeiro fluxo, o mais
 *   simples, e o caso em que um servidor de outra area NAO deve ter acesso.
 * - Saude: classificacao RESTRICTED. E o caso que um servidor de outra area
 *   precisa ter NEGADO, mesmo indo direto pela URL.
 * - Educacao: exige representacao. E o caso em que o vinculo inclui a equipe
 *   que responde, e o cidadao precisa saber disso.
 */
const CATALOGO = [
  {
    secretariat: {
      slug: 'infraestrutura',
      name: 'Secretaria de Infraestrutura e Obras',
      description: 'Iluminacao, calcamento, drenagem e limpeza de vias publicas.',
    },
    service: {
      slug: 'iluminacao-publica',
      name: 'Iluminacao publica com defeito',
      description:
        'Aponte um poste, lampada ou trecho com iluminacao apagada, piscando ou com brilho fora do normal.',
      guidance:
        'Informe o ponto mais proximo onde o defeito pode ser visto. Se souber o numero do poste, ajude. ' +
        'A equipe costuma poder illuminate o local no mesmo dia, mas depende do horario e do local.',
      classification: 'PUBLIC_APPROVED',
      requiresRepresentation: false,
      maxAttachments: 4,
      unit: { name: 'Sede e Unidades do Norte', locality: 'Centro' },
    },
    sla: { name: 'Infraestrutura - 5 dias uteis', minutes: 720, value: 5, unit: 'BUSINESS_DAYS', published: true },
    team: 'Atendimento de vias',
    servidores: [
      { usuario: 'servidor.infra@exemplo.invalid', papel: 'ATTENDANT' },
      { usuario: ADMIN_EMAIL, papel: 'SECRETARY_MANAGER' },
    ],
  },
  {
    secretariat: {
      slug: 'saude',
      name: 'Secretaria Municipal de Saude',
      description: 'Atendimento nas unidades basicas, cadastro e informacoes de saude.',
    },
    service: {
      slug: 'atendimento-ubs',
      name: 'Agendamento de consulta na UBS',
      description:
        'Solicite orientacao sobre agendamento, cartao de dosis e funcionamento das unidades de saude.',
      guidance:
        'Este pedido NAO e um atendimento de saude e nao substitui a UBS. Para emergencia, ligue para o servico de urgencia. ' +
        'Dados de saude tem acesso restrito: sao tratados apenas por quem esta na equipe responsavel.',
      classification: 'RESTRICTED_SENSITIVE',
      requiresRepresentation: false,
      maxAttachments: 2,
      unit: { name: 'UBS Central', locality: 'Centro' },
    },
    sla: { name: 'Saude - 3 dias uteis', minutes: 360, value: 3, unit: 'BUSINESS_DAYS', published: true },
    team: 'Agendamento',
    servidores: [{ usuario: 'servidor.saude@exemplo.invalid', papel: 'ATTENDANT' }],
  },
  {
    secretariat: {
      slug: 'educacao',
      name: 'Secretaria Municipal de Educacao',
      description: 'Matricula, vagas, transporte e material escolar.',
    },
    service: {
      slug: 'matricula-escolar',
      name: 'Matricula e vaga escolar',
      description:
        'Solicite informacao sobre vagas, calendario e documentos necessarios para a matricula.',
      guidance:
        'A matricula e feita pelos responsaveis, e este canal serve para tira duvida sobre documentos e prazos. ' +
        'Pedidos sobre menores de idade passam por representacao legal.',
      classification: 'PUBLIC_APPROVED',
      requiresRepresentation: true,
      maxAttachments: 5,
      unit: { name: 'Secretaria de Educacao', locality: 'Centro' },
    },
    sla: { name: 'Educacao - 10 dias uteis', minutes: 1440, value: 10, unit: 'BUSINESS_DAYS', published: false },
    team: 'Matricula',
    servidores: [],
  },
];

/** `sla_unit` e um ENUM. Estes sao os valores aceitos. */
const UNIDADE_PRAZO = {
  BUSINESS_DAYS: 'BUSINESS_DAYS',
  CALENDAR_DAYS: 'CALENDAR_DAYS',
  HOURS: 'HOURS',
};

/** Estados em que o prazo corre, e em que ele para. */
const ESTADOS_CORRENDO = ['SUBMITTED', 'IN_REVIEW', 'SCHEDULED', 'IN_PROGRESS'];
const ESTADOS_PAUSADOS = ['WAITING_CITIZEN'];

/** Emissor de tokens, para ligar a conta externa ao usuario interno. */
async function tokenDeAdministrador() {
  const resposta = await fetch(
    `${env['KEYCLOAK_URL']}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: env['KEYCLOAK_ADMIN_USER'] ?? 'admin',
        password: env['KEYCLOAK_ADMIN_PASSWORD'] ?? 'admin-local-apenas',
      }).toString(),
    },
  );
  if (!resposta.ok) {
    throw new Error(
      `Token de administrador do Keycloak recusado (HTTP ${resposta.status}). ` +
        'O Keycloak esta no ar e a senha em .env confere?',
    );
  }
  return (await resposta.json()).access_token;
}

/**
 * Subject da conta no Keycloak.
 *
 * O `subject` do token e o id interno do usuario no Keycloak, e e o que casa
 * com `external_identities.subject` no momento do login. Sem esta leitura, o
 * vinculo teria de ser feito a mao no banco, e errar o subject significa que
 * o servidor entra e recebe acesso negado sem nenhuma pista do porque.
 */
async function subjectDe(token, realm, username) {
  let resposta = await fetch(
    `${env['KEYCLOAK_URL']}/admin/realms/${realm}/users?username=${encodeURIComponent(username)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resposta.ok) throw new Error(`busca de ${username} -> HTTP ${resposta.status}`);
  let usuarios = await resposta.json();
  // As contas antigas do Keycloak mantem username legado (servidor.saude),
  // enquanto o login aceita o e-mail. Procurar pelo e-mail como fallback torna
  // a troca do identificador idempotente sem exigir uma alteracao proibida na
  // coluna username.
  if (usuarios.length === 0 && username.includes('@')) {
    resposta = await fetch(
      `${env['KEYCLOAK_URL']}/admin/realms/${realm}/users?email=${encodeURIComponent(username)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resposta.ok) throw new Error(`busca de e-mail ${username} -> HTTP ${resposta.status}`);
    usuarios = await resposta.json();
  }
  if (usuarios.length === 0) throw new Error(`conta ${username} nao existe no realm ${realm}`);
  return { subject: usuarios[0].id, email: usuarios[0].email };
}

async function main() {
  const banco = env['POSTGRES_DB'] ?? 'sertania';
  if (bancoDeTeste !== undefined && bancoDeTeste === banco) {
    // A mensagem e' impressa ANTES do `exit`. Um `exit` silencioso aqui
    // custou uma investigacao inteira: o script saia com codigo 1, sem uma
    // linha de saida, e a causa so apareceu quando a comparacao foi lida de novo.
    console.error(
      `Este script cria dados de demonstracao e nao deve rodar no banco de teste ` +
        `(${banco}). O .env aponta para ele.`,
    );
    process.exit(1);
  }

  const cliente = new pg.Client({
    host: env['POSTGRES_HOST'] ?? 'localhost',
    port: Number(env['POSTGRES_PORT'] ?? 5432),
    user: env['POSTGRES_MIGRATOR_USER'] ?? env['POSTGRES_USER'],
    password: env['POSTGRES_MIGRATOR_PASSWORD'] ?? env['POSTGRES_PASSWORD'],
    database: banco,
  });
  await cliente.connect();
  console.log(`Banco ${banco} - modo ${soVerificar ? 'verificacao' : 'aplicacao'}`);

  const emTransacao = async (trabalho) => {
    if (soVerificar) return;
    await cliente.query('BEGIN');
    try {
      await trabalho();
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    }
  };

  // `fechada` impede o `end()` duplo. Chamar `end()` num cliente ja encerrado
  // faz o Node abortar com `Assertion failed` do proprio libuv, no Windows, e
  // o processo morre sem mensagem: o erro real fica perdido.
  let fechada = false;
  const fechar = async () => {
    if (fechada) return;
    fechada = true;
    await cliente.end().catch(() => undefined);
  };

  try {
    for (const item of CATALOGO) {
      const ids = await criarCatalogo(cliente, item, emTransacao, soVerificar);
      if (ids === null) continue;
      await criarVinculos(cliente, item, ids, emTransacao, soVerificar);
    }

    await fechar();

    if (problemas.length > 0) {
      console.error(`\n${problemas.length} problema(s):`);
      for (const problema of problemas) console.error(`  - ${problema}`);
      process.exit(1);
    }
    console.log(soVerificar ? '\nNenhum problema encontrado.' : `\nAplicado: ${aplicado.length} mudanca(s).`);
  } catch (erro) {
    // `ROLLBACK` antes de fechar: uma transacao aberta impede o `end()`, e o
    // processo terminaria com conexao pendurada.
    await cliente.query('ROLLBACK').catch(() => undefined);
    await fechar();
    console.error(`Falha no seed: ${erro.message}`);
    process.exit(1);
  }
}

/**
 * Cria ou RECONCILIA secretaria, servico, versao, unidade, prazo e equipe.
 *
 * Por que reconcilia e nao apenas cria: a primeira versao deste script pulava a
 * secretaria que ja existisse. Isso e' idempotente e, ao mesmo tempo, deixa
 * para sempre um registro incompleto. Aconteceu de verdade aqui: ficou uma
 * secretaria de Saude com nome trocado, sem descricao e sem servico, que o
 * script declarava "ja existe" em toda execucao seguinte. Um seed que nao
 * converge para o que o arquivo diz deixa de ser verdade sobre o ambiente.
 *
 * A chave de reconciliacao e o `slug` de cada peca, e nao o `id`. Reconciliar
 * por `id` exigiria saber os ids de antemao, e eles mudam entre maquinas.
 */
async function criarCatalogo(cliente, item, emTransacao, apenasVerificar) {
  const porSlug = async (tabela, slug) => {
    const r = await cliente.query(`SELECT "id" FROM "${tabela}" WHERE "slug" = $1`, [slug]);
    return r.rows[0]?.id ?? null;
  };

  if (apenasVerificar) {
    const secretariaId = await porSlug('secretariats', item.secretariat.slug);
    if (secretariaId === null) {
      falhar(`secretaria ${item.secretariat.slug} nao existe`);
      return null;
    }
    const servicos = await cliente.query(
      `SELECT count(*)::int AS total FROM "services" s
         JOIN "service_versions" sv ON sv."service_id" = s."id"
        WHERE s."secretariat_id" = $1 AND sv."published" = true`,
      [secretariaId],
    );
    const total = servicos.rows[0].total;
    if (total === 0) {
      falhar(`secretaria ${item.secretariat.slug} nao tem servico publicado`);
      return null;
    }
    registrar(`catalogo de ${item.secretariat.slug} completo (${total} servico)`);
    return { secretariaId };
  }

  return emTransacao(async () => {
    // --- Secretaria ------------------------------------------------------
    let secretariaId = await porSlug('secretariats', item.secretariat.slug);
    if (secretariaId === null) {
      const criada = await cliente.query(
        `INSERT INTO "secretariats" ("slug", "name", "description")
         VALUES ($1, $2, $3) RETURNING "id"`,
        [item.secretariat.slug, item.secretariat.name, item.secretariat.description],
      );
      secretariaId = criada.rows[0].id;
      registrar(`secretaria ${item.secretariat.slug} criada`);
    } else {
      // Nome e descricao sao reconciliados. Um registro com nome errado impede o
      // cidadao de escolher a secretaria certa, e nada mais vai corrigir.
      await cliente.query(
        `UPDATE "secretariats" SET "name" = $2, "description" = $3, "active" = true
          WHERE "id" = $1 AND ("name" <> $2 OR "description" IS DISTINCT FROM $3)`,
        [secretariaId, item.secretariat.name, item.secretariat.description],
      );
    }

    // --- Unidade ---------------------------------------------------------
    // Unidade e reconciliada por `(secretariat_id, name)`: nome e o que a pessoa
    // le, e nao ha uma chave natural mais estavel que ele.
    const unidadeExistente = await cliente.query(
      `SELECT "id" FROM "units" WHERE "secretariat_id" = $1 AND "name" = $2`,
      [secretariaId, item.service.unit.name],
    );
    let unidadeId;
    if (unidadeExistente.rows.length === 0) {
      const unidade = await cliente.query(
        `INSERT INTO "units" ("secretariat_id", "name", "locality")
         VALUES ($1, $2, $3) RETURNING "id"`,
        [secretariaId, item.service.unit.name, item.service.unit.locality],
      );
      unidadeId = unidade.rows[0].id;
      registrar(`unidade ${item.service.unit.name} criada`);
    } else {
      unidadeId = unidadeExistente.rows[0].id;
      await cliente.query(
        `UPDATE "units" SET "locality" = $2, "active" = true WHERE "id" = $1`,
        [unidadeId, item.service.unit.locality],
      );
    }

    // --- Politica de prazo ----------------------------------------------
    // Reconciliada por `name`, e nao por `version`. A versao e unica e
    // autoincremental, entao reconciliar por ela criaria uma politica nova a
    // cada execucao. O `version` calculado e' o que permite a revisao do prazo
    // guardar historico, como a tabela promete.
    const prazoExistente = await cliente.query(
      `SELECT "id" FROM "sla_policies" WHERE "name" = $1`,
      [item.sla.name],
    );
    let prazoId;
    if (prazoExistente.rows.length === 0) {
      const maiorVersao = await cliente.query(
        `SELECT COALESCE(MAX("version"), 0)::int AS maior FROM "sla_policies"`,
      );
      const proximaVersao = Number(maiorVersao.rows[0].maior) + 1;
      const prazo = await cliente.query(
        `INSERT INTO "sla_policies"
           ("version", "name", "first_response_minutes", "resolution_value",
            "resolution_unit", "running_states", "paused_states",
            "is_published_commitment")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "id"`,
        [
          proximaVersao,
          item.sla.name,
          item.sla.minutes,
          item.sla.value,
          UNIDADE_PRAZO[item.sla.unit] ?? 'BUSINESS_DAYS',
          ESTADOS_CORRENDO,
          ESTADOS_PAUSADOS,
          item.sla.published,
        ],
      );
      prazoId = prazo.rows[0].id;
      registrar(`politica de prazo "${item.sla.name}" criada (v${proximaVersao})`);
    } else {
      prazoId = prazoExistente.rows[0].id;
      await cliente.query(
        `UPDATE "sla_policies"
            SET "first_response_minutes" = $2, "resolution_value" = $3,
                "resolution_unit" = $4, "running_states" = $5, "paused_states" = $6,
                "is_published_commitment" = $7
          WHERE "id" = $1`,
        [
          prazoId,
          item.sla.minutes,
          item.sla.value,
          UNIDADE_PRAZO[item.sla.unit] ?? 'BUSINESS_DAYS',
          ESTADOS_CORRENDO,
          ESTADOS_PAUSADOS,
          item.sla.published,
        ],
      );
    }

    // --- Servico ---------------------------------------------------------
    let servicoId = await porSlug('services', item.service.slug);
    if (servicoId === null) {
      const servico = await cliente.query(
        `INSERT INTO "services" ("slug", "secretariat_id", "default_unit_id")
         VALUES ($1, $2, $3) RETURNING "id"`,
        [item.service.slug, secretariaId, unidadeId],
      );
      servicoId = servico.rows[0].id;
    } else {
      await cliente.query(
        `UPDATE "services" SET "secretariat_id" = $2, "default_unit_id" = $3, "active" = true
          WHERE "id" = $1`,
        [servicoId, secretariaId, unidadeId],
      );
    }

    // --- Versao do servico ----------------------------------------------
    // Reconciliada por `(service_id, version)`. A coluna `sla_policy_id` e
    // NOT NULL desde a migration 1730000001000, entao o INSERT precisa dela
    // desde a primeira linha.
    const versaoExistente = await cliente.query(
      `SELECT "id" FROM "service_versions" WHERE "service_id" = $1 AND "version" = 1`,
      [servicoId],
    );
    if (versaoExistente.rows.length === 0) {
      await cliente.query(
        `INSERT INTO "service_versions"
           ("service_id", "version", "name", "description", "guidance",
            "form_schema", "classification", "requires_representation",
            "max_attachments", "published", "published_at", "sla_policy_id")
         VALUES ($1, 1, $2, $3, $4, $5::jsonb, $6, $7, $8, true, now(), $9)`,
        [
          servicoId,
          item.service.name,
          item.service.description,
          item.service.guidance,
          JSON.stringify({ fields: [] }),
          item.service.classification,
          item.service.requiresRepresentation,
          item.service.maxAttachments,
          prazoId,
        ],
      );
      registrar(`servico ${item.service.slug} publicado com prazo "${item.sla.name}"`);
    } else {
      await cliente.query(
        `UPDATE "service_versions"
            SET "name" = $2, "description" = $3, "guidance" = $4, "form_schema" = $5::jsonb,
                "classification" = $6, "requires_representation" = $7,
                "max_attachments" = $8, "sla_policy_id" = $9, "published" = true
          WHERE "id" = $1`,
        [
          versaoExistente.rows[0].id,
          item.service.name,
          item.service.description,
          item.service.guidance,
          JSON.stringify({ fields: [] }),
          item.service.classification,
          item.service.requiresRepresentation,
          item.service.maxAttachments,
          prazoId,
        ],
      );
    }

    // --- Equipe ----------------------------------------------------------
    const equipeExistente = await cliente.query(
      `SELECT "id" FROM "teams" WHERE "secretariat_id" = $1 AND "name" = $2`,
      [secretariaId, item.team],
    );
    if (equipeExistente.rows.length === 0) {
      await cliente.query(
        `INSERT INTO "teams" ("unit_id", "secretariat_id", "name", "enabled_service_slugs")
         VALUES ($1, $2, $3, $4)`,
        [unidadeId, secretariaId, item.team, [item.service.slug]],
      );
      registrar(`equipe ${item.team} criada`);
    } else {
      await cliente.query(
        `UPDATE "teams" SET "unit_id" = $2, "enabled_service_slugs" = $3, "active" = true
          WHERE "id" = $1`,
        [equipeExistente.rows[0].id, unidadeId, [item.service.slug]],
      );
    }

    return { secretariaId };
  });
}


/**
 * Vincula a conta do servidor ao usuario interno e a Secretaria.
 *
 * O `subject` vem do Keycloak porque e ele que o token traz. A cadeia
 * completa e: `external_identities.subject` casa com o `sub` do token, o
 * `user_id` leva ao vinculo, e o vinculo leva a Secretaria. Se qualquer elo
 * estiver errado, o login funciona e a fila vem vazia, sem erro visivel.
 */
async function criarVinculos(cliente, item, ids, emTransacao, apenasVerificar) {
  const servidores = item.servidores ?? [];
  if (servidores.length === 0) {
    registrar(`sem servidor para ${item.secretariat.slug} (nenhuma conta de demonstracao)`);
    return;
  }

  const realm = env['KEYCLOAK_REALM_SERVERS'] ?? 'sertania-servidores';
  const token = await tokenDeAdministrador();

  const secretaria = await cliente.query(`SELECT "id" FROM "secretariats" WHERE "slug" = $1`, [
    item.secretariat.slug,
  ]);
  const unidade = await cliente.query(
    `SELECT "id" FROM "units" WHERE "secretariat_id" = $1 ORDER BY "name" LIMIT 1`,
    [secretaria.rows[0].id],
  );

  for (const servidor of servidores) {
    const { subject, email } = await subjectDe(token, realm, servidor.usuario);

    if (apenasVerificar) {
      const existentes = await cliente.query(
        `SELECT u."id" FROM "users" u
           JOIN "external_identities" e ON e."user_id" = u."id"
          WHERE e."subject" = $1 AND e."realm" = $2`,
        [subject, realm],
      );
      if (existentes.rows.length === 0) {
        falhar(`conta institucional ${servidor.usuario} sem vinculo interno`);
        continue;
      }
      const vinculos = await cliente.query(
        `SELECT "role" FROM "memberships" WHERE "user_id" = $1`,
        [existentes.rows[0].id],
      );
      if (vinculos.rows.length === 0) falhar(`conta ${servidor.usuario} sem vinculo de Secretaria`);
      else registrar(`vinculo de ${servidor.usuario} existe`);
      continue;
    }

    await emTransacao(async () => {
      const issuer = env['KEYCLOAK_URL'] ?? 'http://localhost:8080';
      const jaVinculado = await cliente.query(
        `SELECT u."id" FROM "users" u
           JOIN "external_identities" e ON e."user_id" = u."id"
          WHERE e."subject" = $1 AND e."realm" = $2`,
        [subject, realm],
      );

      let userId;
      if (jaVinculado.rows.length > 0) {
        userId = jaVinculado.rows[0].id;
        await cliente.query(
          `UPDATE "users" SET "is_citizen" = false, "is_server" = true, "updated_at" = now()
            WHERE "id" = $1`,
          [userId],
        );
      } else {
        const criado = await cliente.query(
          `INSERT INTO "users" ("is_citizen", "is_server") VALUES (false, true) RETURNING "id"`,
        );
        userId = criado.rows[0].id;
        await cliente.query(
          `INSERT INTO "external_identities" ("user_id", "issuer", "subject", "realm", "email")
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, issuer, subject, realm, email],
        );
      }

      const vinculo = await cliente.query(
        `SELECT "id" FROM "memberships" WHERE "user_id" = $1 AND "secretariat_id" = $2`,
        [userId, secretaria.rows[0].id],
      );
      if (vinculo.rows.length === 0) {
        await cliente.query(
          `INSERT INTO "memberships" ("user_id", "role", "secretariat_id", "unit_ids", "team_ids")
           VALUES ($1, $2, $3, $4, '{}')`,
          [userId, servidor.papel, secretaria.rows[0].id, [unidade.rows[0].id]],
        );
      } else {
        // O vinculo existe e talvez com papel diferente. Reaplicar mantem o
        // resultado igual ao que o arquivo declara, sem duplicar linha.
        await cliente.query(
          `UPDATE "memberships" SET "role" = $2, "unit_ids" = $3, "active" = true
            WHERE "id" = $1`,
          [vinculo.rows[0].id, servidor.papel, [unidade.rows[0].id]],
        );
      }
    });
    registrar(`vinculo de ${servidor.usuario} em ${item.secretariat.slug} (${servidor.papel})`);
  }
}

await main();
