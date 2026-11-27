import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { criarApp } from '../src/server/app.js';
import { noEscopo, filtroEscopo } from '../src/server/demandas.js';
import type { UsuarioSessao } from '../src/shared/dominio.js';

let base = '';
let servidor: Server;
let c: ReturnType<typeof criarApp>;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-cargos-'));
type Sessao = { cookie?: string; csrf?: string };

async function req(metodo: string, rota: string, corpo?: unknown, s: Sessao = {}) {
  const r = await fetch(`${base}/api${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(s.cookie ? { Cookie: s.cookie } : {}), ...(s.csrf ? { 'X-CSRF': s.csrf } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, json: (await r.json()) as any, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function entrar(email: string, senha: string): Promise<Sessao> {
  const r = await req('POST', '/auth/entrar', { email, senha });
  return { cookie: r.cookie, csrf: r.json.csrf };
}

beforeAll(async () => {
  c = criarApp({ pastaDados: pasta, modoInicial: 'limpo' });
  await new Promise<void>((ok) => { servidor = c.app.listen(0, ok); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.close();
  c.ctx.banco.fechar();
  fs.rmSync(pasta, { recursive: true, force: true });
});

describe('escopo com várias lotações', () => {
  const u = (escopo: UsuarioSessao['escopo'], secretariaIds: number[], setorIds: number[]): UsuarioSessao => ({
    id: 9, nome: 'x', email: 'x@x', papel: 'CAMPO', secretariaId: secretariaIds[0] ?? null, setorId: setorIds[0] ?? null, permissoes: [],
    deveTrocarSenha: false, cargoId: 1, cargo: 'x', escopo, secretariaIds, setorIds,
  });
  it('setor e secretaria aceitam mais de uma', () => {
    const d = (secretaria_id: number, setor_id: number) => ({ secretaria_id, setor_id, solicitante_id: null });
    expect(noEscopo(u('SETOR', [1, 2], [10, 20]), d(2, 20))).toBe(true);
    expect(noEscopo(u('SETOR', [1, 2], [10, 20]), d(2, 21))).toBe(false);
    expect(noEscopo(u('SECRETARIA', [1, 3], []), d(3, 99))).toBe(true);
    expect(noEscopo(u('SECRETARIA', [1, 3], []), d(2, 99))).toBe(false);
    expect(noEscopo(u('MUNICIPIO', [], []), d(7, 70))).toBe(true);
    expect(filtroEscopo(u('SETOR', [1], [10, 20]))).toEqual({ sql: 'd.setor_id IN (?,?)', params: [10, 20] });
    // sem lotacao nao ve nada
    expect(filtroEscopo(u('SECRETARIA', [], []))).toEqual({ sql: 'd.secretaria_id IN (?)', params: [-1] });
  });
});

it('cargos criados pela Prefeitura: criar, duplicar, excluir, várias lotações e proteções', async () => {
  const pa = await req('POST', '/configuracao/primeiro-acesso', { codigo: c.codigoPrimeiroAcesso, nome: 'Admin Prefeitura', email: 'ti@sertania.pe.gov.br', senha: 'SenhaForte2026' });
  const admin: Sessao = { cookie: pa.cookie, csrf: pa.json.csrf };
  expect(pa.json.usuario).toMatchObject({ cargo: 'Administração (SAD)', escopo: 'MUNICIPIO' });

  // os 7 perfis originais viram 6 cargos editaveis (cidadao nao e cargo)
  let cargos = (await req('GET', '/admin/cargos', undefined, admin)).json as any[];
  expect(cargos.map((x) => x.codigo).sort()).toEqual(['ADMIN_SAD', 'ATENDENTE', 'AUDITOR', 'CAMPO', 'GESTOR_SECRETARIA', 'GESTOR_SETOR']);
  expect(cargos.find((x) => x.codigo === 'ADMIN_SAD').usuarios).toBe(1);

  const s1 = (await req('POST', '/admin/secretarias', { nome: 'Infraestrutura', sigla: 'SEINFRA' }, admin)).json.id;
  const s2 = (await req('POST', '/admin/secretarias', { nome: 'Saúde', sigla: 'SMS' }, admin)).json.id;

  // cargo novo
  const fiscal = await req('POST', '/admin/cargos', { nome: 'Fiscal de obras', descricao: 'Vistoria', escopo: 'SECRETARIA', permissoes: ['demanda.ver', 'painel.ver'] }, admin);
  expect(fiscal.status).toBe(201);
  expect((await req('POST', '/admin/cargos', { nome: 'fiscal DE obras', escopo: 'SETOR', permissoes: [] }, admin)).status).toBe(409);
  const copia = await req('POST', `/admin/cargos/${fiscal.json.id}/duplicar`, {}, admin);
  expect(copia.json).toMatchObject({ nome: 'Fiscal de obras (cópia)', escopo: 'SECRETARIA', permissoes: ['demanda.ver', 'painel.ver'] });
  expect((await req('DELETE', `/admin/cargos/${copia.json.id}`, undefined, admin)).status).toBe(200);

  // pessoa em duas secretarias
  expect((await req('POST', '/admin/usuarios', { nome: 'Fiscal Um', email: 'fiscal@sertania.pe.gov.br', cargoId: fiscal.json.id, lotacoes: [], senha: 'Fiscal2026x', exigirTroca: false }, admin)).status).toBe(400);
  const f = await req('POST', '/admin/usuarios', {
    nome: 'Fiscal Um', email: 'fiscal@sertania.pe.gov.br', cargoId: fiscal.json.id, senha: 'Fiscal2026x', exigirTroca: false,
    lotacoes: [{ secretariaId: s1, setorId: null }, { secretariaId: s2, setorId: null }],
  }, admin);
  expect(f.status).toBe(201);
  const sf = await entrar('fiscal@sertania.pe.gov.br', 'Fiscal2026x');
  const eu = (await req('GET', '/auth/eu', undefined, sf)).json.usuario;
  expect(eu).toMatchObject({ cargo: 'Fiscal de obras', escopo: 'SECRETARIA', secretariaIds: [s1, s2], permissoes: ['demanda.ver', 'painel.ver'] });
  expect((await req('GET', '/gestao/demandas', undefined, sf)).status).toBe(200);
  expect((await req('GET', '/admin/cargos', undefined, sf)).status).toBe(403);

  const lista = (await req('GET', '/admin/usuarios', undefined, admin)).json as any[];
  expect(lista.find((u) => u.email === 'fiscal@sertania.pe.gov.br').lotacoes.map((l: any) => l.secretaria)).toEqual(['Infraestrutura', 'Saúde']);

  // cargo em uso nao pode ser excluido
  expect((await req('DELETE', `/admin/cargos/${fiscal.json.id}`, undefined, admin)).status).toBe(409);

  // o admin nao muda o proprio cargo; e ninguem tira a ultima pessoa que administra a equipe
  const meuId = pa.json.usuario.id;
  const atendente = cargos.find((x) => x.codigo === 'ATENDENTE');
  expect((await req('PUT', `/admin/usuarios/${meuId}`, { nome: 'Admin Prefeitura', email: 'ti@sertania.pe.gov.br', cargoId: atendente.id, lotacoes: [] }, admin)).status).toBe(400);
  const adm = cargos.find((x) => x.codigo === 'ADMIN_SAD');
  expect((await req('PUT', `/admin/cargos/${adm.id}`, { nome: adm.nome, escopo: adm.escopo, permissoes: ['painel.ver'] }, admin)).status).toBe(409);
  // com outra pessoa administrando, a permissao pode sair de um cargo
  const coord = await req('POST', '/admin/cargos', { nome: 'Coordenação de TI', escopo: 'MUNICIPIO', permissoes: ['admin.usuarios', 'painel.ver'] }, admin);
  expect((await req('PUT', `/admin/usuarios/${f.json.id}`, { nome: 'Fiscal Um', email: 'fiscal@sertania.pe.gov.br', cargoId: coord.json.id, lotacoes: [] }, admin)).status).toBe(200);
  expect((await req('PUT', `/admin/cargos/${adm.id}`, { nome: adm.nome, escopo: adm.escopo, permissoes: adm.permissoes.filter((p: string) => p !== 'admin.usuarios') }, admin)).status).toBe(200);
  // o admin original perdeu a permissao na hora; agora quem administra e a Coordenacao de TI
  expect((await req('GET', '/admin/cargos', undefined, admin)).status).toBe(403);
  const ti = await entrar('fiscal@sertania.pe.gov.br', 'Fiscal2026x');
  expect((await req('PUT', `/admin/cargos/${coord.json.id}`, { nome: 'Coordenação de TI', escopo: 'MUNICIPIO', permissoes: ['painel.ver'] }, ti)).status).toBe(409);
  expect((await req('PUT', `/admin/cargos/${adm.id}`, { nome: adm.nome, escopo: adm.escopo, permissoes: adm.permissoes }, ti)).status).toBe(200);

  // auditoria das mudancas
  const acoes = c.ctx.banco.all<{ acao: string }>("SELECT acao FROM auditoria WHERE acao LIKE 'CARGO_%'").map((x) => x.acao);
  expect(acoes).toEqual(expect.arrayContaining(['CARGO_CRIADO', 'CARGO_EXCLUIDO', 'CARGO_ALTERADO']));
  cargos = (await req('GET', '/admin/cargos', undefined, ti)).json as any[];
  expect(cargos.find((x) => x.id === coord.json.id).usuarios).toBe(1);
});
