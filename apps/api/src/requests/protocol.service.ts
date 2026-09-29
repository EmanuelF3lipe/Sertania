/**
 * Geracao de protocolo no banco (especificacao secao 6).
 *
 * O numero vem da tabela `protocol_sequences`, com reserva atomica por
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. Nao existe `MAX + 1` em
 * nenhum lugar: dois envios concorrentes leriao o mesmo maximo e gravariam o
 * mesmo protocolo, e o cidadao veria um erro em vez de um numero.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PROTOCOL_SEQUENCE_TABLE,
  formatProtocol,
  protocolYear,
  reserveNextProtocolSql,
} from '@sertania/contracts';
import { type Transaction } from '../database/typed-query';

@Injectable()
export class ProtocolService {
  private readonly logger = new Logger(ProtocolService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Reserva o proximo numero do ano e devolve o protocolo formatado.
   *
   * Deve ser chamada DENTRO da mesma transacao que grava a solicitacao. Se a
   * transacao falhar depois, o numero fica reservado e a sequencia pula um
   * valor. Isso e aceitavel e preferivel a duplicidade: ninguem recebe dois
   * protocolos iguais, e pular um numero nao gera efeito visivel.
   */
  async nextProtocol(tx: Transaction, at: Date): Promise<string> {
    const year = protocolYear(at);
    const rows = await tx.run(reserveNextProtocolSql(year), [year]);
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Reserva de numero de protocolo nao devolveu valor');
    }
    const sequence = Number(row['last_value']);
    if (!Number.isFinite(sequence)) {
      throw new Error(`Reserva devolveu valor inesperado: ${String(row['last_value'])}`);
    }
    this.logger.log(`Protocolo reservado: ${formatProtocol(year, sequence)}`);
    return formatProtocol(year, sequence);
  }

  /**
   * Cria a tabela de sequencia, se ainda nao existir.
   *
   * Fica no codigo alem da migracao para que a tabela esteja disponivel mesmo
   * em um banco migrado por outra ferramenta. A definicao e identica a da
   * migracao, entao a operacao e idempotente.
   */
  async ensureSequenceTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${PROTOCOL_SEQUENCE_TABLE} (
        "year" integer PRIMARY KEY,
        "last_value" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_protocol_sequences_positive" CHECK ("last_value" >= 0)
      )
    `);
    this.logger.log('Tabela de sequencia de protocolo pronta');
  }
}
