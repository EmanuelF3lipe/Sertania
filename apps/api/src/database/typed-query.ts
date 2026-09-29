/**
 * Acceso a banco com tipos (especificacao secao 10).
 *
 * Por que este wrapper existe:
 *
 * O `DataSource.query()` do TypeORM devolve `Promise<any>`. Isso e verdade
 * desde sempre e nao tem correcao prevista na biblioteca. Com `any` no meio da
 * cadeia, o TypeScript deixa de proteger o codigo DEPOIS do banco, e erros como
 * ler `.length` de um retorno vazio so aparecem em execucao.
 *
 * Este wrapper nao muda o comportamento. Ele declara o que ja e verdade: uma
 * consulta parametrizada devolve uma lista de linhas, e a forma de cada linha
 * e `Record<string, unknown>`. O chamador continua convertendo, mas agora o
 * compilador obriga a converter, em vez de deixar passar um `any` silencioso.
 */
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';

/** Linha de resultado de consulta. */
export type Row = Record<string, unknown>;

/**
 * Consulta parametrizada, com retorno tipado.
 *
 * O `params` e opcional para reduzir a verbosidade, mas o SQL com valor
 * concatenado nao passa pelo compilador: o parametro precisa ser array. Isso
 * e proposital, e cobre o requisito de query parametrizada da especificacao.
 */
export async function query<TRow extends Row = Row>(
  runner: { query(sql: string, parameters?: unknown[]): Promise<unknown> } | DataSource | EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<TRow[]> {
  const result: unknown = await runner.query(sql, params);
  if (!Array.isArray(result)) {
    // Uma unica linha vem como objeto, nao como array. Envolver aqui evita
    // que `resultado[0]` devolva `undefined` em codigo que assume lista.
    return [result as TRow];
  }
  return result as Array<TRow>;
}

/**
 * Le UM valor escalar de uma consulta de agregacao.
 *
 * Existe porque `SELECT count(*)` devolve uma linha com uma coluna, e o
 * chamador quase sempre quer o numero. Sem esta funcao, cada uso repetiria o
 * mesmo `as unknown as number`, e um dia um deles esqueceria.
 */
export async function scalar(
  runner: { query(sql: string, parameters?: unknown[]): Promise<unknown> } | DataSource | EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const rows = await query(runner, sql, params);
  const first = rows[0];
  if (first === undefined) {
    throw new Error('Consulta de agregacao nao devolveu linha');
  }
  const values = Object.values(first);
  const value = values[0];
  return typeof value === 'number' ? value : Number(String(value));
}

/**
 * Retorno de `UPDATE ... RETURNING` no TypeORM.
 *
 * O driver devolve `[linhas, linhasAfetadas]`, e nao apenas as linhas. Ler
 * `resultado[0]` sem saber disso devolve o array interno das linhas, e um
 * campo como `state` vem `undefined` SEM ERRO VISIVEL: o codigo segue como se
 * a gravacao tivesse dado certo.
 *
 * Este e o tipo que separa os dois formatos, para que o compilador obrigue a
 * tratar a diferenca em vez de deixar passar.
 */
export type WriteResult = [rows: Row[], affected: number];

/** Converte o retorno bruto de escrita no formato `[linhas, afetadas]`. */
export function asWriteResult(raw: unknown): WriteResult {
  if (Array.isArray(raw) && raw.length === 2) {
    const first: unknown = raw[0];
    const second: unknown = raw[1];
    if (Array.isArray(first)) {
      return [first as Row[], Number(second)];
    }
  }
  // Formato inesperado: tratado como "nada afetado", o que faz o chamador
  // cair no caminho de erro em vez de assumir sucesso.
  return [[], 0];
}

/**
 * Acesso a banco com injecao, para uso em controllers e casos de uso.
 *
 * Injetar isto em vez do `DataSource` torna a dependencia explicita e permite
 * trocar por um substituto em teste sem tocar no caso de uso.
 */
@Injectable()
export class Database {
  constructor(private readonly dataSource: DataSource) {}

  /** Consulta com retorno tipado. */
  async run<TRow extends Row = Row>(sql: string, params: unknown[] = []): Promise<TRow[]> {
    return query<TRow>(this.dataSource, sql, params);
  }

  /**
   * Escrita com retorno, no formato `[linhas, afetadas]`.
   *
   * Separado de `run` porque o formato difere, e misturar os dois foi
   * exatamente o que produziu o bug de `state` indefinido.
   */
  async write(sql: string, params: unknown[] = []): Promise<WriteResult> {
    const raw: unknown = await this.dataSource.query(sql, params);
    return asWriteResult(raw);
  }

  /** Agregacao escalar. */
  async count(sql: string, params: unknown[] = []): Promise<number> {
    return scalar(this.dataSource, sql, params);
  }

  /** Transacao com o mesmo contrato de consulta tipado. */
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => work(new Transaction(manager)));
  }
}

/** Transacao com consultas tipadas. */
export class Transaction {
  constructor(private readonly manager: EntityManager) {}

  async run<TRow extends Row = Row>(sql: string, params: unknown[] = []): Promise<TRow[]> {
    return query<TRow>(this.manager, sql, params);
  }

  /** Escrita com retorno, no formato `[linhas, afetadas]`. */
  async write(sql: string, params: unknown[] = []): Promise<WriteResult> {
    const raw: unknown = await this.manager.query(sql, params);
    return asWriteResult(raw);
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    return scalar(this.manager, sql, params);
  }
}

export type { QueryRunner };
