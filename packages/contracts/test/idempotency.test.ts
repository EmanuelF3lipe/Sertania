import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_TTL_SECONDS,
  classifyIdempotencyLookup,
  hashRequestPayload,
  idempotencyExpiry,
  isValidIdempotencyKey,
  stableStringify,
} from '../src/idempotency.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');

describe('formato da chave de idempotencia', () => {
  it('aceita chave opaca de cliente dentro do tamanho esperado', () => {
    expect(isValidIdempotencyKey('abc123def456ghij')).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(16))).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(160))).toBe(true);
  });

  it('recusa chave curta demais, que colidiria com facilidade', () => {
    expect(isValidIdempotencyKey('abc')).toBe(false);
    expect(isValidIdempotencyKey('a'.repeat(15))).toBe(false);
  });

  it('recusa chave longa demais', () => {
    expect(isValidIdempotencyKey('a'.repeat(161))).toBe(false);
  });

  it('recusa caracteres fora do conjunto permitido', () => {
    // Espaco, barra e aspas exigiriam escapamento e ampliariam a superficie
    // de injecao se a chave algum dia entrar numa query concatenada.
    expect(isValidIdempotencyKey('abc 123def456ghi')).toBe(false);
    expect(isValidIdempotencyKey("abc'123def456ghi")).toBe(false);
    expect(isValidIdempotencyKey('abc/123def456ghi')).toBe(false);
    expect(isValidIdempotencyKey('abc;123def456ghi')).toBe(false);
  });

  it('aceita os separadores uteis ao cliente', () => {
    expect(isValidIdempotencyKey('req-2026-09-28:1')).toBe(true);
    expect(isValidIdempotencyKey('req_2026.09.28-1')).toBe(true);
  });
});

describe('hash da entrada', () => {
  it('produz o mesmo hash para o mesmo conteudo', () => {
    const a = hashRequestPayload({ descricao: 'buraco', servico: 'iluminacao' });
    const b = hashRequestPayload({ descricao: 'buraco', servico: 'iluminacao' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produz hash diferente para conteudo diferente', () => {
    const a = hashRequestPayload({ descricao: 'buraco' });
    const b = hashRequestPayload({ descricao: 'luminaria' });
    expect(a).not.toBe(b);
  });

  it('ignora a ordem das chaves', () => {
    // Um retry costuma reenviar o mesmo corpo com as chaves em outra ordem.
    // Se o hash mudasse, o idempotencia seria quebrado sem que o cliente
    // tivesse feito nada de diferente.
    const a = hashRequestPayload({ b: 2, a: 1, c: 3 });
    const b = hashRequestPayload({ c: 3, a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('ignora propriedades indefinidas', () => {
    const a = hashRequestPayload({ a: 1, b: undefined });
    const b = hashRequestPayload({ a: 1 });
    expect(a).toBe(b);
  });

  it('distingue objetos com as mesmas chaves e valores em ordem trocada em arrays', () => {
    // A ordem de um array e semantica: [1,2] e [2,1] nao sao a mesma coisa.
    const a = hashRequestPayload({ itens: [1, 2] });
    const b = hashRequestPayload({ itens: [2, 1] });
    expect(a).not.toBe(b);
  });

  it('trata null e indefinido sem quebrar', () => {
    expect(() => hashRequestPayload(null)).not.toThrow();
    expect(() => hashRequestPayload(undefined)).not.toThrow();
  });
});

describe('serializacao estavel', () => {
  it('produz a mesma saida para a mesma entrada', () => {
    expect(stableStringify({ a: 1, b: [1, 2] })).toBe(stableStringify({ a: 1, b: [1, 2] }));
  });

  it('mantem a ordem dos arrays', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('cita as chaves, para chaves com caractere especial', () => {
    expect(stableStringify({ 'chave com espaco': 1 })).toBe('{"chave com espaco":1}');
  });
});

describe('classificacao da consulta de idempotencia', () => {
  const base = {
    requestHash: 'hash-1',
    now: NOW,
  };

  it('chave ausente e uma operacao nova', () => {
    const result = classifyIdempotencyLookup({
      ...base,
      found: false,
      storedHash: null,
      resultEntityId: null,
      expiresAt: new Date('2026-09-29T12:00:00.000Z'),
    });
    expect(result.kind).toBe('NEW');
  });

  it('mesma chave e mesmo corpo devolve o resultado ja gravado', () => {
    // Este e o criterio 2: repetir a abertura por falha de rede nao cria
    // duplicata e devolve o mesmo protocolo.
    const result = classifyIdempotencyLookup({
      ...base,
      found: true,
      storedHash: 'hash-1',
      resultEntityId: 'req-123',
      expiresAt: new Date('2026-09-29T12:00:00.000Z'),
    });
    expect(result).toEqual({ kind: 'REPLAY', resultEntityId: 'req-123' });
  });

  it('mesma chave com corpo diferente e sinal de erro do cliente', () => {
    const result = classifyIdempotencyLookup({
      ...base,
      found: true,
      storedHash: 'outro-hash',
      resultEntityId: 'req-123',
      expiresAt: new Date('2026-09-29T12:00:00.000Z'),
    });
    expect(result.kind).toBe('MISMATCH');
  });

  it('chave registrada sem resultado indica operacao em andamento', () => {
    // Nao e erro: a transacao ainda nao commitou. Tratar como falha faria o
    // cidadao ver erro numa operacao que pode ter dado certo.
    const result = classifyIdempotencyLookup({
      ...base,
      found: true,
      storedHash: 'hash-1',
      resultEntityId: null,
      expiresAt: new Date('2026-09-29T12:00:00.000Z'),
    });
    expect(result.kind).toBe('IN_FLIGHT');
  });

  it('chave expirada e tratada como se nao existisse', () => {
    const result = classifyIdempotencyLookup({
      ...base,
      found: true,
      storedHash: 'hash-1',
      resultEntityId: 'req-123',
      expiresAt: new Date('2026-09-28T11:00:00.000Z'),
    });
    expect(result.kind).toBe('NEW');
  });

  it('chave que expira exatamente agora ja esta expirada', () => {
    const result = classifyIdempotencyLookup({
      ...base,
      found: true,
      storedHash: 'hash-1',
      resultEntityId: 'req-123',
      expiresAt: NOW,
    });
    expect(result.kind).toBe('NEW');
  });
});

describe('expiracao da chave', () => {
  it('usa a janela padrao de 24 horas', () => {
    expect(IDEMPOTENCY_TTL_SECONDS).toBe(86400);
    const expiry = idempotencyExpiry(NOW);
    expect(expiry.getTime() - NOW.getTime()).toBe(86400 * 1000);
  });

  it('cobre a retentativa tipica de falha de rede', () => {
    // 24 horas e mais que suficiente para o cidadao reenviar apos perder a
    // conexao, e curto o bastante para nao acumular chaves sem efeito.
    expect(IDEMPOTENCY_TTL_SECONDS).toBeGreaterThanOrEqual(60 * 60);
  });
});
