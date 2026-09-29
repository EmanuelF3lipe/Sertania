/**
 * Carregamento de ambiente para os testes de integracao.
 *
 * Este arquivo substitui as tres copias de `loadEnv` que estavam nos testes. A
 * copia existia porque a CLI do Jest nao le `.env`, e tres versaoes
 * significavam tres lugares para corrigir o mesmo erro.
 *
 * A ordem de precedencia e o ponto principal, e ela e o contrario do que parece
 * natural: `.env` entra primeiro e `.env.test` **sobrescreve**. O `.env`
 * guarda as variaveis que os dois ambientes compartilham (host, porta,
 * `SESSION_SECRET`, S3); o `.env.test` sobrescreve so o que precisa ser
 * diferente, que e o banco e as credenciais. Se a precedencia fosse invertida,
 * o `.env` apagaria o banco de teste e os testes voltariam a rodar no banco de
 * demonstracao, em silencio.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Raiz do monorepo, dois niveis acima de `apps/api`. */
export const RAIZ = join(__dirname, '..', '..', '..', '..');

function ler(arquivo: string, destino: Record<string, string>): void {
  if (!existsSync(arquivo)) return;
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const limpa = linha.trim();
    if (limpa === '' || limpa.startsWith('#')) continue;
    const separador = limpa.indexOf('=');
    if (separador === -1) continue;
    const chave = limpa.slice(0, separador).trim();
    const valor = limpa.slice(separador + 1).trim();
    if (chave !== '' && valor !== '') destino[chave] = valor;
  }
}

/**
 * Carrega o ambiente de teste e recusa o banco de demonstracao.
 *
 * A recusa e a razao de este arquivo existir como modulo e nao como funcao
 * simples. Os testes de integracao rodam `TRUNCATE` e `DELETE` no banco que
 * apontam. Se `POSTGRES_DB` for o banco das demonstracoes locais, o dano e
 * silencioso: os testes passam, o git fica limpo, e os dados de quem esta
 * desenvolvendo evaporaram. Falhar na inicializacao e a unica forma de o erro
 * aparecer antes do dano.
 *
 * `@throws` quando o `.env.test` falta ou quando o banco de teste e o mesmo do
 * banco do projeto.
 */
export function carregarAmbienteDeTeste(): void {
  // Os dois arquivos sao lidos SEPARADADAMENTE, e nao em um acumulado unico. A
  // distincao e o que permite a checagem final: so separando da para saber
  // qual banco o `.env` de trabalho aponta, e compara-lo com o banco que o
  // processo vai acabar usando.
  const trabalho: Record<string, string> = {};
  ler(join(RAIZ, '.env'), trabalho);
  const teste: Record<string, string> = {};
  ler(join(RAIZ, '.env.test'), teste);

  const acumulado: Record<string, string> = { ...trabalho, ...teste };
  for (const [chave, valor] of Object.entries(acumulado)) {
    process.env[chave] = valor;
  }

  const bancoDoTeste = teste['TEST_POSTGRES_DB'];

  if (bancoDoTeste === undefined) {
    throw new Error(
      'TEST_POSTGRES_DB ausente: o arquivo .env.test nao foi encontrado. ' +
        'Copie `.env.test.example` para `.env.test` e ajuste as senhas. Sem ele ' +
        'os testes usariam o banco das demonstracoes locais e apagariam o ' +
        'conteudo, e nada no resultado indicaria isso.',
    );
  }

  // O processo tem de terminar apontando para o banco de teste. Como `.env.test`
  // sobrescreve `POSTGRES_DB`, os dois valores DEVEM coincidir: e por isso que
  // a comparacao invertida seria um falso positivo permanente.
  if (process.env['POSTGRES_DB'] !== bancoDoTeste) {
    throw new Error(
      `POSTGRES_DB (${String(process.env['POSTGRES_DB'])}) nao e o banco de teste ` +
        `(${bancoDoTeste}). Defina POSTGRES_DB=${bancoDoTeste} em \`.env.test\`.`,
    );
  }

  // E o banco de teste tem de ser DIFERENTE do banco de trabalho. Sem esta
  // checagem, apontar os dois para o mesmo nome seria aceito em silencio.
  if (trabalho['POSTGRES_DB'] !== undefined && trabalho['POSTGRES_DB'] === bancoDoTeste) {
    throw new Error(
      `O banco de teste (${bancoDoTeste}) e o mesmo que o banco de trabalho. ` +
        'Os testes de integracao apagam o conteudo do banco que apontam: cada ' +
        'ambiente precisa do seu proprio banco.',
    );
  }

  // A partir daqui o processo so enxerga o banco de teste.
  process.env['NODE_ENV'] = 'test';
}
