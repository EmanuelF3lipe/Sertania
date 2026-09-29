/**
 * Provisionamento do banco de DADOS DE TESTE (secao 11 e 20).
 *
 * Por que isto existe: os testes de integracao rodavam contra o mesmo banco
 * das demonstracoes locais e apagavam o conteudo entre um teste e outro. Um
 * `pnpm test:integration` destruia os dados de quem estava desenvolvendo a
 * interface. Banco separado e credenciais separadas resolvem isso na raiz: um
 * engano de configuracao deixa de ter consequencia sobre os dados de trabalho.
 *
 * As contas sao criadas COM MENOS PRIVILEGIO que a conta da aplicacao de
 * demonstracao, e isso e proposital. `sertania_app` hoje e SUPERUSUARIO, porque
 * a imagem do Postgres cria `POSTGRES_USER` como superusuario no bootstrap e nao
 * ha script que reduza o privilegio depois. Os comentarios no compose e no
 * `.env` afirmam o contrario, e a afirmacao esta errada. Ver
 * `pendencia-conta-superusuario` em `docs/ESTADO_IMPLEMENTACAO.md`.
 *
 * Idempotente: pode rodar quantas vezes for preciso.
 *
 * Uso:
 *   node infra/docker/postgres/provisionar.mjs           # cria o que falta
 *   node infra/docker/postgres/provisionar.mjs --verificar
 *
 * Este script conecta com a conta de BOOTSTRAP, que e superusuario, porque criar
 * papel exige `CREATEROLE`. O resultado sao contas sem privilegio. A conta de
 * bootstrap e a mesma para todos os scripts de ambiente local, e nao e a conta
 * que a aplicacao usa em tempo de execucao.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `pg` ja vem instalado pela dependencia do TypeORM na API. Reaproveitar o que
// existe evita adicionar dependencia a um script de ambiente.
const require = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..', '..');
const pg = require(join(raiz, 'apps', 'api', 'node_modules', 'pg'));

function carregarEnv() {
  // Os dois arquivos sao lidos em separado. O `.env` sozinho descreve o banco
  // de TRABALHO, e e contra ele que o banco de teste precisa ser conferido. Com
  // um acumulado unico, o `.env.test` sobrescreveria `POSTGRES_DB` e a
  // comparacao perderia o sentido.
  const trabalho = {};
  let bruto;
  try {
    bruto = readFileSync(join(raiz, '.env'), 'utf8');
  } catch {
    return { trabalho: {}, teste: {} };
  }
  for (const linha of bruto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (limpa === '' || limpa.startsWith('#')) continue;
    const separador = limpa.indexOf('=');
    if (separador === -1) continue;
    const chave = limpa.slice(0, separador).trim();
    const valor = limpa.slice(separador + 1).trim();
    if (chave !== '' && valor !== '') trabalho[chave] = valor;
  }

  const teste = {};
  try {
    bruto = readFileSync(join(raiz, '.env.test'), 'utf8');
  } catch {
    return { trabalho, teste };
  }
  for (const linha of bruto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (limpa === '' || limpa.startsWith('#')) continue;
    const separador = limpa.indexOf('=');
    if (separador === -1) continue;
    const chave = limpa.slice(0, separador).trim();
    const valor = limpa.slice(separador + 1).trim();
    if (chave !== '' && valor !== '') teste[chave] = valor;
  }
  return { trabalho, teste };
}

const { trabalho: envTrabalho, teste: envTeste } = carregarEnv();
const env = { ...envTrabalho, ...envTeste };

const HOST = env['POSTGRES_HOST'] ?? 'localhost';
const PORTA = Number(env['POSTGRES_PORT'] ?? 5432);
// A conta de bootstrap: a unica com `CREATEROLE` nesta maquina.
const BOOTSTRAP_USUARIO = env['POSTGRES_USER'] ?? 'sertania_app';
const BOOTSTRAP_SENHA = env['POSTGRES_PASSWORD'] ?? '';

const BANCO = env['TEST_POSTGRES_DB'] ?? 'sertania_test';
const PAPEL_MIGRACAO = env['TEST_POSTGRES_MIGRATOR_USER'] ?? 'sertania_test_migrator';
const SENHA_MIGRACAO = env['TEST_POSTGRES_MIGRATOR_PASSWORD'] ?? '';
const PAPEL_APP = env['TEST_POSTGRES_USER'] ?? 'sertania_test_app';
const SENHA_APP = env['TEST_POSTGRES_PASSWORD'] ?? '';

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

const bancoTrabalho = envTrabalho['POSTGRES_DB'] ?? 'sertania';

/**
 * Confere que o banco de teste nao e o banco de trabalho.
 *
 * Esta checagem e a barreira mais importante do arquivo. Ela roda ANTES de
 * qualquer criacao, porque o erro que se quer evitar e exatamente este:
 * configuracao de teste apontada para o banco certo, e um `TRUNCATE` na
 * demonstracao de quem esta desenvolvendo. Se o `.env.test` for apagado ou
 * renomeado, o `.env` sozinho cairia no banco de demonstracao, e e
 * exatamente por isso que o `.env.test` e REQUIRED e nao opcional.
 */
function conferirBancoDeTeste() {
  if (BANCO === bancoTrabalho) {
    falhar(
      `Banco de teste (${BANCO}) e igual ao banco de trabalho ` +
        `(${bancoTrabalho}). Os testes de integracao APAGAM o conteudo do banco: ` +
        'cada ambiente precisa do seu proprio banco.',
    );
  }
}

async function main() {
  conferirBancoDeTeste();
  if (problemas.length > 0) {
    for (const problema of problemas) console.error(`  - ${problema}`);
    process.exit(1);
  }

  for (const [rotulo, senha] of [
    [PAPEL_MIGRACAO, SENHA_MIGRACAO],
    [PAPEL_APP, SENHA_APP],
  ]) {
    if (senha === '') {
      falhar(`senha ausente para ${rotulo}: defina em .env.test`);
    }
  }
  if (problemas.length > 0) {
    for (const problema of problemas) console.error(`  - ${problema}`);
    process.exit(1);
  }

  const cliente = new pg.Client({
    host: HOST,
    port: PORTA,
    user: BOOTSTRAP_USUARIO,
    password: BOOTSTRAP_SENHA,
    // Conecta no banco de manutencao: `CREATE DATABASE` nao roda dentro de
    // transacao, e por isso cada comando e enviado sozinho.
    database: 'postgres',
  });
  await cliente.connect();
  console.log(`Postgres em ${HOST}:${PORTA} - modo ${soVerificar ? 'verificacao' : 'aplicacao'}`);

  // Os parametros sao repassados. Sem o segundo argumento, uma consulta com
  // `$1` falha com "there is no parameter $1" em vez de devolver zero linhas:
  // o erro pareceria vir da sentenca, e nao da forgotura de um `await`.
  const consulta = async (sql, valores = []) => (await cliente.query(sql, valores)).rows;

  // --- Papeis -----------------------------------------------------------
  // `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` e
  // `NOBYPASSRLS` explicitos: o padrao de `CREATE ROLE` ja e sem privilegio,
  // mas deixar o `ALTER ROLE` escrito deixa a intencao visivel e o script
  // continua correto se um papel ja existir com privilegio a mais.
  const papeis = [
    { nome: PAPEL_MIGRACAO, senha: SENHA_MIGRACAO, comentario: 'aplica migrations no banco de teste' },
    { nome: PAPEL_APP, senha: SENHA_APP, comentario: 'aplicacao nos testes de integracao' },
  ];

  for (const papel of papeis) {
    const existente = await consulta(
      `SELECT 1 FROM pg_roles WHERE rolname = $1`,
      [papel.nome],
    );
    if (existente.length > 0) {
      registrar(`papel ${papel.nome} ja existe`);
      // A senha NAO e redefinida a cada execucao, pelo mesmo motivo do
      // Keycloak: um script de ambiente que troca senha derruba as conexoes
      // de quem esta com a sessao aberta.
      continue;
    }
    if (soVerificar) continue;
    // `CREATE ROLE` nao aceita parametro ligado (`$1`): a senha precisa
    // aparecer como literal na sentenca. O escape vem do proprio driver, e nao
    // de uma concatenacao feita a mao: concatenar senha em SQL e o caminho
    // classico para injecao, mesmo num script local.
    const senhaLiteral = cliente.escapeLiteral(papel.senha);
    await cliente.query(
      `CREATE ROLE "${papel.nome}" LOGIN PASSWORD ${senhaLiteral} NOSUPERUSER NOCREATEDB
       NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await cliente.query(`COMMENT ON ROLE "${papel.nome}" IS ${cliente.escapeLiteral(papel.comentario)}`);
    registrar(`papel ${papel.nome} criado sem superusuario`);
  }

  // --- Banco ------------------------------------------------------------
  const bancos = await consulta(`SELECT datname FROM pg_database WHERE datname = $1`, [BANCO]);
  if (bancos.length > 0) {
    registrar(`banco ${BANCO} ja existe`);
  } else if (!soVerificar) {
    // O dono e o papel de migracao, e nao o de bootstrap: assim o papel de
    // bootstrap nao e dono de nada e nao precisa estar presente para o banco
    // funcionar. A conta de bootstrap e apenas a que tem `CREATEDB` aqui.
    await cliente.query(`CREATE DATABASE "${BANCO}" OWNER "${PAPEL_MIGRACAO}"`);
    registrar(`banco ${BANCO} criado, dono ${PAPEL_MIGRACAO}`);
  }

  // --- Concessoes dentro do banco de teste -------------------------------
  if (soVerificar) {
    const dono = await consulta(
      `SELECT pg_get_userbyid(datdba) AS dono FROM pg_database WHERE datname = $1`,
      [BANCO],
    );
    if (dono.length > 0 && dono[0]['dono'] !== PAPEL_MIGRACAO) {
      falhar(`banco ${BANCO} pertence a ${dono[0]['dono']}, esperado ${PAPEL_MIGRACAO}`);
    }
  } else {
    const banco = new pg.Client({
      host: HOST,
      port: PORTA,
      user: BOOTSTRAP_USUARIO,
      password: BOOTSTRAP_SENHA,
      database: BANCO,
    });
    await banco.connect();

    // A conta da aplicacao pode CONECTAR e usar o esquema, mas nao cria
    // tabela, nao altera estrutura e nao e dona. As migracoes rodam com o
    // papel de migracao, e sao elas que criam o esquema.
    // Extensoes do banco de teste, criadas pela conta de bootstrap.
    //
    // `CREATE EXTENSION` exige superusuario, ou a extensao marcada como
    // confiavel pelo cluster. Aqui o papel de migracao NAO e superusuario, e a
    // extensao precisa existir antes de a migration criar as tabelas. Criar a
    // extensao e infraestrutura do banco, nao parte do schema da aplicacao: e o
    // mesmo papel que a conta de bootstrap tem ao criar o proprio cluster.
    //
    // A conta da aplicacao de teste nao recebe `CREATE EXTENSION`, e nao
    // precisa: ela consome as tabelas ja prontas.
    for (const extensao of ['uuid-ossp', 'postgis']) {
      await banco.query(`CREATE EXTENSION IF NOT EXISTS "${extensao}"`);
    }
    registrar('extensoes uuid-ossp e postgis disponiveis');

    await banco.query(`GRANT CONNECT ON DATABASE "${BANCO}" TO "${PAPEL_APP}"`);
    await banco.query(`GRANT USAGE ON SCHEMA public TO "${PAPEL_APP}"`);
    // `ALTER DEFAULT PRIVILEGES` cobre as tabelas que a migration ainda vai
    // criar. Sem isto, a aplicacao so poderia ler o que ja existisse no
    // momento do grant, e falharia em toda tabela nova.
    await banco.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${PAPEL_MIGRACAO}" IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${PAPEL_APP}"`,
    );
    await banco.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${PAPEL_MIGRACAO}" IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO "${PAPEL_APP}"`,
    );
    registrar(`concessoes aplicadas a ${PAPEL_APP} em ${BANCO}`);

    await banco.end();
  }

  await cliente.end();

  if (problemas.length > 0) {
    console.error(`\n${problemas.length} problema(s):`);
    for (const problema of problemas) console.error(`  - ${problema}`);
    process.exit(1);
  }
  console.log(soVerificar ? '\nNenhum problema encontrado.' : `\nAplicado: ${aplicado.length} mudanca(s).`);
}

try {
  await main();
} catch (erro) {
  console.error(`Falha ao provisionar o banco de teste: ${erro.message}`);
  process.exit(1);
}
