/**
 * Adaptador Redis das sessoes (especificacao secao 12 e 18).
 *
 * Redis de sessao e Redis de fila sao INSTANCIAS SEPARADAS. Um eviction de
 * cache nunca pode derrubar um trabalho pendente, e sessoes sao descartaveis
 * enquanto trabalho nao e.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { SessionStore } from './session.service';

@Injectable()
export class RedisSessionStore implements SessionStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisSessionStore.name);

  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async touch(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  /**
   * Remove todas as sessoes de um usuario.
   *
   * Usa SCAN, e nao KEYS: KEYS bloqueia o Redis inteiro em bases grandes, e a
   * revogacao acontece em operacao de manutencao, nao em caminho critico de
   * requisicao.
   */
  async deleteByUser(userId: string): Promise<number> {
    const indexKey = `sess-user:${userId}`;
    const ids = await this.keysByUser(userId);
    for (const id of ids) {
      await this.redis.del(`sess:${id}`);
    }
    await this.redis.del(indexKey);
    return ids.length;
  }

  async keysByUser(userId: string): Promise<string[]> {
    const indexKey = `sess-user:${userId}`;
    const raw = await this.redis.get(indexKey);
    if (raw === null || raw.length === 0) return [];
    return raw.split(',').filter((id) => id.length > 0);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(`Erro ao encerrar o Redis de sessao: ${String(error)}`);
    }
  }
}

/**
 * Cria o cliente Redis a partir da URL.
 *
 * A senha vem da URL, e nao de log. `lazyConnect` evita que a conexao tente
 * abrir durante o build dos testes.
 */
export function createRedisClient(url: string, options: { readonly db?: number } = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    ...(options.db !== undefined ? { db: options.db } : {}),
    // TLS em producao; o ambiente local usa plaintext em 127.0.0.1.
    ...(url.startsWith('rediss:') ? { tls: {} } : {}),
  });
}
