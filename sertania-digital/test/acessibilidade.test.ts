import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { aplicarDitado, destinoDe, interpretarComando, lerNumero } from '../src/web/acessibilidade/comandos.js';
import { criarApp } from '../src/server/app.js';

describe('comandos de voz', () => {
  it('navega pelas páginas com ou sem acento', () => {
    expect(interpretarComando('Ir para registrar')).toEqual({ tipo: 'ir', destino: '/nova' });
    expect(interpretarComando('abrir transparência')).toEqual({ tipo: 'ir', destino: '/transparencia' });
    expect(interpretarComando('Acompanhar.')).toEqual({ tipo: 'ir', destino: '/acompanhar' });
    expect(interpretarComando('ir para o início')).toEqual({ tipo: 'ir', destino: '/' });
    expect(destinoDe('a fila de solicitações')).toBe('/gestao/fila');
  });

  it('clica pelo nome, por número e controla o formulário', () => {
    expect(interpretarComando('clicar em enviar solicitação')).toEqual({ tipo: 'clicar', alvo: 'enviar solicitacao' });
    expect(interpretarComando('escolher iluminação pública')).toEqual({ tipo: 'clicar', alvo: 'iluminacao publica' });
    expect(interpretarComando('continuar')).toEqual({ tipo: 'clicar', alvo: 'continuar' });
    expect(interpretarComando('voltar')).toEqual({ tipo: 'voltar' });
    expect(interpretarComando('mostrar números')).toEqual({ tipo: 'numeros' });
    expect(interpretarComando('número três')).toEqual({ tipo: 'numero', n: 3 });
    expect(interpretarComando('12')).toEqual({ tipo: 'numero', n: 12 });
    expect(lerNumero('vinte')).toBe(20);
    expect(interpretarComando('próximo campo')).toEqual({ tipo: 'campo', direcao: 'proximo' });
    expect(interpretarComando('Escrever Rua São José, 120')).toEqual({ tipo: 'escrever', texto: 'Rua São José, 120' });
  });

  it('leitura, rolagem, ajustes de tela e ajuda', () => {
    expect(interpretarComando('ler a página')).toEqual({ tipo: 'ler' });
    expect(interpretarComando('parar')).toEqual({ tipo: 'parar' });
    expect(interpretarComando('descer')).toEqual({ tipo: 'rolar', direcao: 'baixo' });
    expect(interpretarComando('letra maior')).toEqual({ tipo: 'preferencia', acao: 'letraMaior' });
    expect(interpretarComando('modo escuro')).toEqual({ tipo: 'preferencia', acao: 'escuro' });
    expect(interpretarComando('o que posso falar')).toEqual({ tipo: 'ajuda' });
    expect(interpretarComando('desligar comandos de voz')).toEqual({ tipo: 'desligar' });
    expect(interpretarComando('banana')).toMatchObject({ tipo: 'desconhecido' });
  });
});

describe('ditado', () => {
  it('pontuação falada, maiúscula no começo e edição', () => {
    expect(aplicarDitado('', 'a lâmpada do poste está apagada ponto final')).toBe('A lâmpada do poste está apagada.');
    expect(aplicarDitado('A lâmpada está apagada.', 'faz uma semana')).toBe('A lâmpada está apagada. Faz uma semana');
    expect(aplicarDitado('Rua da Matriz', 'vírgula perto da escola')).toBe('Rua da Matriz, perto da escola');
    expect(aplicarDitado('Oi', 'tudo bem ponto de interrogação')).toBe('Oi tudo bem?');
    expect(aplicarDitado('Primeira linha', 'nova linha segunda')).toBe('Primeira linha\nSegunda');
    expect(aplicarDitado('buraco na rua grande', 'apagar última palavra')).toBe('buraco na rua');
    expect(aplicarDitado('qualquer coisa', 'apagar tudo')).toBe('');
  });
});

describe('servidor libera microfone e o VLibras', () => {
  let servidor: Server;
  let c: ReturnType<typeof criarApp>;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-acess-'));
  beforeAll(async () => {
    c = criarApp({ pastaDados: pasta, modoInicial: 'limpo' });
    await new Promise<void>((ok) => { servidor = c.app.listen(0, ok); });
  });
  afterAll(() => {
    servidor.close();
    c.ctx.banco.fechar();
    fs.rmSync(pasta, { recursive: true, force: true });
  });
  it('cabeçalhos', async () => {
    const r = await fetch(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/saude`);
    expect(r.headers.get('permissions-policy')).toContain('microphone=(self)');
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src [^;]*https:\/\/vlibras\.gov\.br/);
    expect(csp).toMatch(/connect-src [^;]*vlibras\.gov\.br/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/vlibras\.gov\.br/);
    expect(csp).toMatch(/script-src [^;]*cdn\.jsdelivr\.net\/gh\/spbgovbr-vlibras\//);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
