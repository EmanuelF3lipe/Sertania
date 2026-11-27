import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { criarApp } from '../src/server/app.js';

let base = '';
let servidor: Server;
let codigo = '';
let fechar: () => void;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-equipe-'));
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
async function entrar(email: string, senha: string): Promise<Sessao> {
  const r = await req('POST', '/auth/entrar', { email, senha });
  expect(r.status).toBe(200);
  return { cookie: r.cookie, csrf: r.json.csrf };
}

beforeAll(async () => {
  const c = criarApp({ pastaDados: pasta, modoInicial: 'limpo' });
  codigo = c.codigoPrimeiroAcesso!;
  fechar = () => c.ctx.banco.fechar();
  await new Promise<void>((ok) => { servidor = c.app.listen(0, ok); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.close();
  fechar();
  fs.rmSync(pasta, { recursive: true, force: true });
});

it('equipe: esqueci a senha, senha provisória, perfis ajustáveis e dados do órgão', async () => {
  const pa = await req('POST', '/configuracao/primeiro-acesso', { codigo, nome: 'Admin Prefeitura', email: 'ti@sertania.pe.gov.br', senha: 'SenhaForte2026' });
  const admin: Sessao = { cookie: pa.cookie, csrf: pa.json.csrf };
  const sec = await req('POST', '/admin/secretarias', { nome: 'Infraestrutura', sigla: 'SEINFRA' }, admin);
  const setor = await req('POST', '/admin/setores', { nome: 'Iluminação', secretariaId: sec.json.id }, admin);

  // servidor com senha definida pelo admin e SEM troca obrigatoria
  const cargos = (await req('GET', '/admin/cargos', undefined, admin)).json as any[];
  const gs = cargos.find((c) => c.codigo === 'GESTOR_SETOR');
  const novo = await req('POST', '/admin/usuarios', { nome: 'Gestor Iluminação', email: 'gestor@sertania.pe.gov.br', cargoId: gs.id, lotacoes: [{ secretariaId: sec.json.id, setorId: setor.json.id }], senha: 'Inicial2026', exigirTroca: false }, admin);
  expect(novo.status).toBe(201);
  const gestor = await entrar('gestor@sertania.pe.gov.br', 'Inicial2026');
  expect((await req('GET', '/auth/eu', undefined, gestor)).json.usuario.deveTrocarSenha).toBe(false);
  expect((await req('GET', '/gestao/resumo', undefined, gestor)).json).toMatchObject({ abertas: 0, vencidas: 0 });

  // esqueci minha senha: resposta igual para quem existe e quem nao existe
  expect((await req('POST', '/auth/esqueci', { email: 'ninguem@x.com' })).json).toEqual({ ok: true });
  expect((await req('POST', '/auth/esqueci', { email: 'gestor@sertania.pe.gov.br' })).json).toEqual({ ok: true });
  let lista = (await req('GET', '/admin/usuarios', undefined, admin)).json as any[];
  const g = lista.find((u) => u.email === 'gestor@sertania.pe.gov.br');
  expect(g.pediuSenhaEm).toBeTruthy();
  expect(g.ultimoAcessoEm).toBeTruthy();

  // admin gera senha provisoria: pedido atendido, sessao antiga encerrada, troca obrigatoria
  const sp = await req('POST', `/admin/usuarios/${g.id}/senha-provisoria`, {}, admin);
  expect(sp.json.senhaProvisoria).toMatch(/^Sertania[0-9a-f]{6}1$/);
  expect((await req('GET', '/auth/eu', undefined, gestor)).json.usuario).toBeNull();
  lista = (await req('GET', '/admin/usuarios', undefined, admin)).json as any[];
  expect(lista.find((u) => u.id === g.id).pediuSenhaEm).toBeNull();
  const gestor2 = await entrar('gestor@sertania.pe.gov.br', sp.json.senhaProvisoria);
  expect((await req('GET', '/gestao/demandas', undefined, gestor2)).status).toBe(403);
  const troca = await req('POST', '/auth/trocar-senha', { atual: sp.json.senhaProvisoria, nova: 'MinhaSenha2026' }, gestor2);
  const gestor3: Sessao = { cookie: troca.cookie, csrf: troca.json.csrf };
  expect((await req('GET', '/gestao/demandas', undefined, gestor3)).status).toBe(200);

  // cargo: tirar "ver a fila" do gestor de setor bloqueia na hora; devolver libera
  const corpo = (c: any, permissoes: string[]) => ({ nome: c.nome, descricao: c.descricao, escopo: c.escopo, permissoes });
  await req('PUT', `/admin/cargos/${gs.id}`, corpo(gs, gs.permissoes.filter((p: string) => p !== 'demanda.ver')), admin);
  expect((await req('GET', '/gestao/demandas', undefined, gestor3)).status).toBe(403);
  await req('PUT', `/admin/cargos/${gs.id}`, corpo(gs, gs.permissoes), admin);
  expect((await req('GET', '/gestao/demandas', undefined, gestor3)).status).toBe(200);
  expect((await req('PUT', `/admin/cargos/${gs.id}`, corpo(gs, ['nao.existe']), admin)).status).toBe(400);

  // administracao nunca fica sem ninguem que administre a equipe
  const adm = cargos.find((c) => c.codigo === 'ADMIN_SAD');
  expect((await req('PUT', `/admin/cargos/${adm.id}`, corpo(adm, ['demanda.ver']), admin)).status).toBe(409);
  expect((await req('GET', '/admin/cargos', undefined, admin)).status).toBe(200);

  // dados do orgao e perfil pessoal
  const par = { nomeSistema: 'Atende Sertânia', orgao: 'Prefeitura de Sertânia', emailContato: 'ouvidoria@sertania.pe.gov.br', telefoneContato: '(87) 0000-0000', enderecoAtendimento: '', horarioAtendimento: '', avisoInicio: 'Mutirão rural' };
  expect((await req('PUT', '/admin/parametros', par, admin)).status).toBe(200);
  expect((await req('PUT', '/admin/parametros', par, gestor3)).status).toBe(403);
  expect((await req('GET', '/configuracao/estado')).json.parametros).toMatchObject({ nomeSistema: 'Atende Sertânia', avisoInicio: 'Mutirão rural' });
  expect((await req('PUT', '/auth/perfil', { nome: 'Gestor da Iluminação', telefone: '87999990000' }, gestor3)).status).toBe(200);
  expect((await req('GET', '/auth/perfil', undefined, gestor3)).json).toMatchObject({ nome: 'Gestor da Iluminação', telefone: '87999990000' });

  // tudo auditado
  const aud = (await req('GET', '/admin/auditoria', undefined, admin)).json;
  const acoes = (aud.registros as any[]).map((r) => r.acao);
  for (const a of ['SENHA_SOLICITADA', 'SENHA_PROVISORIA_GERADA', 'CARGO_ALTERADO', 'PARAMETROS_ALTERADOS', 'PERFIL_ALTERADO']) expect(acoes).toContain(a);
  expect(aud.cadeia.integra).toBe(true);
});
