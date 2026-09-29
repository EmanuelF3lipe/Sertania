/**
 * Prepara o banco de TESTE: confere o alvo e aplica as migrations.
 *
 * Por que um script e nao um comando com variaveis de ambiente na linha de
 * comando: os nomes sao diferentes de proposito. O `.env` fala em
 * `POSTGRES_*` porque sao os nomes que a aplicacao le. O `.env.test` fala em
 * `TEST_POSTGRES_*` porque sao os alvos do ambiente de teste, e o prefixo e o
 * que impede que alguem confunda os dois ao digitar o comando.
 *
 * A alternativa, passar as variaveis na linha de comando, funciona em PowerShell
 * e falha em `cmd`, quebra em CI e esconde do proximo leitor para onde os
 * testes apontam. Aqui a unica fonte de verdade e o par de arquivos `.env`.
 *
 * Uso: pnpm --filter @sertania/api db:test:migrate
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(__dirname, '..', '..', '..');

function carregar(arquivo: string, destino: Record<string, string>): void {
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

const trabalho: Record<string, string> = {};
carregar(join(raiz, '.env'), trabalho);
const teste: Record<string, string> = {};
carregar(join(raiz, '.env.test'), teste);

/**
 * Confere o alvo ANTES de qualquer conexao.
 *
 * A migration cria e altera estrutura. Apontada para o banco errado, ela
 * derruba o schema de quem esta desenvolvendo. Recusar aqui e mais barato que
 * descobrir depois.
 */
const banco = teste['TEST_POSTGRES_DB'];
if (banco === undefined) {
  console.error(
    'TEST_POSTGRES_DB ausente. Copie `.env.test.example` para `.env.test` antes ' +
      'de preparar o banco de teste.',
  );
  process.exit(1);
}
if (trabalho['POSTGRES_DB'] === banco) {
  console.error(
    `O banco de teste (${banco}) e o mesmo que o banco de trabalho. ` +
      'Cada ambiente precisa do seu proprio banco.',
  );
  process.exit(1);
}
if (teste['POSTGRES_DB'] !== banco) {
  console.error(
    `POSTGRES_DB (${String(teste['POSTGRES_DB'])}) em .env.test nao e igual a ` +
      `TEST_POSTGRES_DB (${banco}). Defina POSTGRES_DB=${banco} em \`.env.test\`.`,
  );
  process.exit(1);
}

// Ponte de nomes: o `.env.test` nomeia o que e de teste; a aplicacao le os
// nomes do `.env`. A traducao acontece aqui, em um lugar so.
process.env['POSTGRES_DB'] = banco;
process.env['POSTGRES_USER'] = teste['TEST_POSTGRES_USER'] ?? '';
process.env['POSTGRES_PASSWORD'] = teste['TEST_POSTGRES_PASSWORD'] ?? '';
process.env['POSTGRES_MIGRATOR_USER'] = teste['TEST_POSTGRES_MIGRATOR_USER'] ?? '';
process.env['POSTGRES_MIGRATOR_PASSWORD'] = teste['TEST_POSTGRES_MIGRATOR_PASSWORD'] ?? '';
process.env['POSTGRES_HOST'] = trabalho['POSTGRES_HOST'] ?? 'localhost';
process.env['POSTGRES_PORT'] = trabalho['POSTGRES_PORT'] ?? '5432';
process.env['NODE_ENV'] = 'test';

// `main` em vez de `await` no topo do arquivo: o `tsconfig` do projeto emite
// CommonJS, onde `await` no topo do modulo nao existe. A alternativa seria
// marcar o arquivo como modulo ES, e o resto do projeto nao e.
async function main(): Promise<void> {
  console.log(`Aplicando migrations no banco de TESTE: ${banco}`);

  const { default: dataSource } = await import('../src/database/data-source');
  await dataSource.initialize();
  try {
    const aplicadas = await dataSource.runMigrations({ transaction: 'all' });
    if (aplicadas.length === 0) {
      console.log('Nada a aplicar: o banco de teste ja esta na versao mais recente.');
    } else {
      for (const migracao of aplicadas) {
        console.log(`  aplicada ${migracao.name}`);
      }
    }
  } finally {
    // `destroy` no `finally`: uma migration interrompida deixaria conexoes
    // abertas e o processo nao sairia.
    await dataSource.destroy();
  }
}

// Chamada sem `await` no topo: o `tsconfig` emite CommonJS, onde `await` no
// topo do modulo nao existe. A alternativa seria marcar o arquivo como modulo
// ES, e o resto do projeto nao e. O `catch` converte uma falha em codigo de
// saida diferente de zero, que e o que o `pnpm` olha.
void main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
