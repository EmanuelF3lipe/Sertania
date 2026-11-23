import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { criarApp } from '../src/server/app.js';
import { analisarDemanda } from '../src/server/ia/servico.js';
import { limiteAtingido, mesAtual, registrarUso, tokensDoMes } from '../src/server/ia/uso.js';

// Nunca chamar a API de verdade nos testes: sem chave, o cliente falha antes de qualquer envio.
delete process.env['ANTHROPIC_API_KEY'];

let base = '';
let servidor: Server;
let c: ReturnType<typeof criarApp>;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-ia-'));
type Sessao = { cookie?: string; csrf?: string };

async function req(metodo: string, rota: string, corpo?: unknown, s: Sessao = {}) {
  const r = await fetch(`${base}/api${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(s.cookie ? { Cookie: s.cookie } : {}), ...(s.csrf ? { 'X-CSRF': s.csrf } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return { status: r.status, json: (await r.json()) as any, cookie };
}

beforeAll(async () => {
  c = criarApp({ pastaDados: pasta, modoInicial: 'limpo', iaProvedor: 'claude' });
  await new Promise<void>((ok) => { servidor = c.app.listen(0, ok); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.close();
  c.ctx.banco.fechar();
  fs.rmSync(pasta, { recursive: true, force: true });
});

it('mês contado no fuso de Recife', () => {
  expect(mesAtual(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11');
  expect(mesAtual(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12');
});

it('consumo da IA: registro, falha cai para a IA local, limite mensal e tela de administração', async () => {
  const b = c.ctx.banco;
  const pa = await req('POST', '/configuracao/primeiro-acesso', { codigo: c.codigoPrimeiroAcesso, nome: 'Admin Prefeitura', email: 'ti@sertania.pe.gov.br', senha: 'SenhaForte2026' });
  const admin: Sessao = { cookie: pa.cookie, csrf: pa.json.csrf };

  // solicitacao do cidadao: a analise automatica tenta o Claude (sem chave, falha) e a IA local assume
  const nova = await req('POST', '/publico/demandas', {
    descricao: 'Lâmpada do poste apagada em frente à escola há uma semana.', servicoId: 1, localidadeId: 1, anonima: true, chaveIdempotencia: 'teste-ia-0001',
  });
  expect(nova.status).toBe(201);
  const id = b.get<{ id: number }>('SELECT id FROM demandas ORDER BY id DESC LIMIT 1')!.id;
  const a = await analisarDemanda(b, c.ctx.config, id);
  expect(a.provedor).toBe('local');
  const falhas = b.all<{ ok: number; operacao: string }>('SELECT ok, operacao FROM ia_uso');
  expect(falhas.length).toBeGreaterThanOrEqual(1);
  expect(falhas.every((f) => f.ok === 0 && f.operacao === 'TRIAGEM')).toBe(true);

  // tokens gastos entram no total do mes
  registrarUso(b, { operacao: 'TRIAGEM', modelo: 'claude-opus-5-5', ok: true, demandaId: id, uso: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  registrarUso(b, { operacao: 'NARRATIVA', modelo: 'claude-opus-5-5', ok: true, uso: { input_tokens: 800, output_tokens: 700 } });
  expect(tokensDoMes(b)).toBe(3000);

  // tela de administracao
  let r = await req('GET', '/admin/ia', undefined, admin);
  expect(r.status).toBe(200);
  expect(r.json).toMatchObject({ provedor: 'claude', limite: 0, usado: 3000, atingido: false });
  expect(r.json.porOperacao.map((o: any) => o.operacao).sort()).toEqual(['NARRATIVA', 'TRIAGEM']);
  expect(r.json.ultimas.length).toBeGreaterThanOrEqual(3);

  // limite atingido: nenhuma nova chamada ao Claude, a IA local responde
  r = await req('PUT', '/admin/ia', { limiteTokensMes: 2500 }, admin);
  expect(r.json).toMatchObject({ limite: 2500, atingido: true });
  expect(limiteAtingido(b)).toBe(true);
  const antes = b.get<{ n: number }>('SELECT COUNT(*) AS n FROM ia_uso')!.n;
  expect((await analisarDemanda(b, c.ctx.config, id)).provedor).toBe('local');
  expect(b.get<{ n: number }>('SELECT COUNT(*) AS n FROM ia_uso')!.n).toBe(antes);

  // limite invalido e auditoria
  expect((await req('PUT', '/admin/ia', { limiteTokensMes: -1 }, admin)).status).toBe(400);
  expect((await req('PUT', '/admin/ia', { limiteTokensMes: 0 }, admin)).json).toMatchObject({ limite: 0, atingido: false });
  const acoes = (b.all<{ acao: string }>('SELECT acao FROM auditoria')).map((x) => x.acao);
  expect(acoes.filter((x) => x === 'IA_LIMITE_ALTERADO').length).toBe(2);

  // sem login nao ve o consumo
  expect((await req('GET', '/admin/ia')).status).toBe(401);
});
