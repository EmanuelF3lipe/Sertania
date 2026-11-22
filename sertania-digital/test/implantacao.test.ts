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
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-limpo-'));

async function req(metodo: string, rota: string, corpo?: unknown, s: { cookie?: string; csrf?: string } = {}) {
  const r = await fetch(`${base}/api${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(s.cookie ? { Cookie: s.cookie } : {}), ...(s.csrf ? { 'X-CSRF': s.csrf } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return { status: r.status, json: (await r.json()) as any, cookie };
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

it('banco limpo: primeiro administrador, cadastro de servidor e troca obrigatória de senha', async () => {
  expect(codigo).toMatch(/^[A-Z0-9]{10}$/);
  const estado = await req('GET', '/configuracao/estado');
  expect(estado.json).toMatchObject({ precisaPrimeiroAcesso: true, demonstracao: false });
  const cat = await req('GET', '/publico/catalogo');
  expect(cat.json.secretarias).toHaveLength(1); // so a SAD
  expect(cat.json.servicos).toHaveLength(1); // "Outro assunto"

  const errado = await req('POST', '/configuracao/primeiro-acesso', { codigo: 'XXXXXXXXXX', nome: 'Admin Prefeitura', email: 'ti@sertania.pe.gov.br', senha: 'SenhaForte2026' });
  expect(errado.status).toBe(400);
  const ok = await req('POST', '/configuracao/primeiro-acesso', { codigo, nome: 'Admin Prefeitura', email: 'ti@sertania.pe.gov.br', senha: 'SenhaForte2026' });
  expect(ok.status).toBe(201);
  const admin = { cookie: ok.cookie, csrf: ok.json.csrf };
  expect((await req('POST', '/configuracao/primeiro-acesso', { codigo, nome: 'Outro', email: 'x@y.com', senha: 'SenhaForte2026' })).status).toBe(409);

  // administrador monta a estrutura
  const sec = await req('POST', '/admin/secretarias', { nome: 'Infraestrutura', sigla: 'SEINFRA' }, admin);
  const setor = await req('POST', '/admin/setores', { nome: 'Iluminação', secretariaId: sec.json.id }, admin);
  expect((await req('POST', '/admin/servicos', { nome: 'Poste apagado', setorId: setor.json.id, prazoDiasUteis: 5 }, admin)).status).toBe(201);
  const novo = await req('POST', '/admin/usuarios', { nome: 'Gestor Iluminação', email: 'gestor@sertania.pe.gov.br', papel: 'GESTOR_SETOR', secretariaId: null, setorId: setor.json.id }, admin);
  const provisoria = novo.json.senhaProvisoria as string;
  expect(provisoria).toBeTruthy();

  // servidor entra com a senha provisoria e e obrigado a troca-la
  const login = await req('POST', '/auth/entrar', { email: 'gestor@sertania.pe.gov.br', senha: provisoria });
  expect(login.json.usuario.deveTrocarSenha).toBe(true);
  const s = { cookie: login.cookie, csrf: login.json.csrf };
  expect((await req('GET', '/gestao/demandas', undefined, s)).status).toBe(403);
  const troca = await req('POST', '/auth/trocar-senha', { atual: provisoria, nova: 'MinhaSenha2026' }, s);
  expect(troca.status).toBe(200);
  const s2 = { cookie: troca.cookie, csrf: troca.json.csrf };
  expect((await req('GET', '/gestao/demandas', undefined, s2)).status).toBe(200);
});
