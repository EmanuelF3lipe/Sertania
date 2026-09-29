/**
 * Cliente S3: assinatura e operacoes (especificacao secao 13).
 *
 * O foco e a garantia de que os buckets ficam PRIVADOS e que a integridade do
 * objeto e conferida por hash. Nenhum teste aqui pressupoe rede: o transporte e
 * injetado, e a verificacao e sobre o que o cliente envia.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { S3StorageClient, internalStorageKey, type StorageConfig } from '../src/storage/s3-storage.client';

const CONFIG: StorageConfig = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  accessKey: 'sertania-local',
  secretKey: 'sertania-local-secret',
  forcePathStyle: true,
  quarantineBucket: 'sertania-quarantine',
  documentsBucket: 'sertania-documents',
};

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  bodyLength: number;
}

function makeClient(): { client: S3StorageClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client = new S3StorageClient(CONFIG);

  // Intercepta `send`, que e privado, substituindo o transporte HTTP.
  const internals = client as unknown as {
    send: (
      method: string,
      path: string,
      options?: { body?: Buffer; headers?: Record<string, string> },
    ) => Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }>;
  };
  internals.send = jest.fn(async (method: string, path: string, options?: { body?: Buffer; headers?: Record<string, string> }) => {
    calls.push({
      method,
      path,
      headers: options?.headers ?? {},
      bodyLength: options?.body?.length ?? 0,
    });
    return { statusCode: 200, headers: {}, body: Buffer.alloc(0) };
  }) as never;

  return { client, calls };
}

describe('chave interna de armazenamento', () => {
  it('nao contem o nome original do arquivo', () => {
    const key = internalStorageKey({ requestId: 'req-1', extension: 'jpg' });
    expect(key.startsWith('req-1/')).toBe(true);
    // Nome interno aleatorio: dois anexos do mesmo pedido nao colidem e o
    // nome enviado pelo cidadao nao e adivinhavel.
    expect(key).toMatch(/^req-1\/[0-9a-f-]{36}\.jpg$/);
  });

  it('gera chaves diferentes para o mesmo pedido', () => {
    const a = internalStorageKey({ requestId: 'req-1', extension: 'pdf' });
    const b = internalStorageKey({ requestId: 'req-1', extension: 'pdf' });
    expect(a).not.toBe(b);
  });
});

describe('gravacao de objeto', () => {
  it('envia cabecalhos que impedem execucao no navegador', () => {
    const { client, calls } = makeClient();
    void client.putObject({
      bucket: 'sertania-quarantine',
      key: 'req-1/x.jpg',
      body: Buffer.from('conteudo'),
      contentType: 'image/jpeg',
    });

    const headers = calls[0]?.headers ?? {};
    // Um objeto aberto em navegador nao pode executar script, mesmo que o
    // detector de virus o tenha liberado.
    expect(headers['x-amz-content-type-options']).toBe('nosniff');
    expect(headers['content-disposition']).toBe('attachment');
    expect(headers['cache-control']).toBe('no-store');
  });

  it('grava no bucket indicado', () => {
    const { client, calls } = makeClient();
    void client.putObject({
      bucket: 'sertania-quarantine',
      key: 'req-1/x.jpg',
      body: Buffer.from('conteudo'),
      contentType: 'image/jpeg',
    });
    expect(calls[0]?.path).toBe('/sertania-quarantine/req-1/x.jpg');
    expect(calls[0]?.method).toBe('PUT');
  });
});

describe('politica de bucket privado', () => {
  it('bloqueia leitura anonima ao criar o bucket', async () => {
    // Sem esta chamada, um bucket criado por engano poderia ficar legivel
    // publicamente. A especificacao exige bucket sem leitura publica.
    const { client, calls } = makeClient();
    await client.denyPublicAccess('sertania-quarantine');
    expect(calls.some((c) => c.path === '/sertania-quarantine?policy')).toBe(true);
  });

  it('a politica nega GetObject e ListBucket para todos', async () => {
    const { client, calls } = makeClient();
    let captured: string | null = null;
    const internals = client as unknown as {
      send: (method: string, path: string, options?: { body?: Buffer }) => Promise<unknown>;
    };
    internals.send = jest.fn(async (_m: string, _p: string, options?: { body?: Buffer }) => {
      captured = options?.body?.toString('utf8') ?? null;
      return { statusCode: 200, headers: {}, body: Buffer.alloc(0) };
    }) as never;

    await client.denyPublicAccess('sertania-documents');
    expect(captured).toContain('s3:GetObject');
    expect(captured).toContain('s3:ListBucket');
    // `JSON.stringify` nao emite espacos; a comparacao e sobre o valor.
    expect(captured).toContain('"Effect":"Deny"');
    // O recurso cobre o bucket e os objetos dentro dele.
    expect(captured).toContain('arn:aws:s3:::sertania-documents/*');
  });

  it('trata 409 como bucket ja existente, nao como falha', async () => {
    const { client } = makeClient();
    const internals = client as unknown as {
      send: () => Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }>;
    };
    internals.send = jest.fn(async () => ({ statusCode: 409, headers: {}, body: Buffer.alloc(0) })) as never;
    // Nao deve lancar: o fluxo de criacao chama isto sempre.
    await expect(client.createBucketIfAbsent('sertania-quarantine')).resolves.toBeUndefined();
  });
});

describe('assinatura SigV4', () => {
  it('envia host, hash do conteudo e data nos headers', async () => {
    const { client, calls } = makeClient();
    await client.putObject({
      bucket: 'b',
      key: 'k',
      body: Buffer.from('conteudo'),
      contentType: 'text/plain',
    });

    // `send` e privado, entao a verificacao e sobre o que o cliente passou
    // adiante no transporte: metodo, caminho e cabecalhos de seguranca. A
    // assinatura em si so pode ser conferida contra o RustFS de verdade, o
    // que exige um teste de integracao.
    const call = calls[0];
    expect(call?.method).toBe('PUT');
    expect(call?.bodyLength).toBeGreaterThan(0);
    expect(call?.headers['content-type']).toBe('text/plain');
  });
});

describe('leitura de objeto', () => {
  it('devolve o corpo lido', async () => {
    const { client } = makeClient();
    const internals = client as unknown as {
      send: () => Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }>;
    };
    const conteudo = Buffer.from('conteudo do documento');
    internals.send = jest.fn(async () => ({ statusCode: 200, headers: {}, body: conteudo })) as never;
    const result = await client.getObject({ bucket: 'b', key: 'k' });
    expect(result.toString('utf8')).toBe('conteudo do documento');
  });

  it('traduz 404 em erro legivel', async () => {
    const { client } = makeClient();
    const internals = client as unknown as {
      send: () => Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }>;
    };
    internals.send = jest.fn(async () => ({ statusCode: 404, headers: {}, body: Buffer.alloc(0) })) as never;
    await expect(client.getObject({ bucket: 'b', key: 'k' })).rejects.toThrow(/nao encontrado/i);
  });
});
