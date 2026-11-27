import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { criarApp } from '../src/server/app.js';
import { agendarPesquisa, avisarSituacao, dentroDoHorario, processarFila, salvarPreferencias, PREFERENCIAS_PADRAO } from '../src/server/avisos/fila.js';
import { enviar, lerConfigAvisos, telefoneE164 } from '../src/server/avisos/provedores.js';
import { gerarRelatoriosMensais, mesAnterior } from '../src/server/avisos/relatorio-mensal.js';

// Gateway de mentira: recebe o que o servidor mandaria para WhatsApp/SMS/e-mail.
interface Recebido { via: string; para: string; assunto: string | null; texto: string; html: string | null; modelo: unknown; assinatura?: string; corpo: string }
const recebidos: Recebido[] = [];
let falharProximas = 0;
let gateway: Server;
let base = '';
let servidor: Server;
let c: ReturnType<typeof criarApp>;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-avisos-'));

beforeAll(async () => {
  gateway = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (x) => (corpo += x));
    req.on('end', () => {
      if (falharProximas > 0) { falharProximas--; res.writeHead(503).end('{"message":"fora do ar"}'); return; }
      recebidos.push({ ...(JSON.parse(corpo) as Recebido), assinatura: req.headers['x-sertania-assinatura'] as string, corpo });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `g${recebidos.length}` }));
    });
  });
  await new Promise<void>((ok) => { gateway.listen(0, ok); });
  Object.assign(process.env, {
    URL_PUBLICA: 'https://servicos.sertania.test',
    AVISOS_EMAIL: 'webhook', AVISOS_SMS: 'webhook', AVISOS_WHATSAPP: 'desligado',
    AVISOS_WEBHOOK_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/enviar`, AVISOS_WEBHOOK_SEGREDO: 'segredo-de-teste',
  });
  c = criarApp({ pastaDados: pasta, modoInicial: 'limpo' });
  salvarPreferencias(c.ctx.banco, { ...PREFERENCIAS_PADRAO, horaInicio: 0, horaFim: 24, pesquisaHoras: 0 });
  await new Promise<void>((ok) => { servidor = c.app.listen(0, ok); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.close();
  gateway.close();
  c.ctx.banco.fechar();
  fs.rmSync(pasta, { recursive: true, force: true });
  for (const k of ['URL_PUBLICA', 'AVISOS_EMAIL', 'AVISOS_SMS', 'AVISOS_WHATSAPP', 'AVISOS_WEBHOOK_URL', 'AVISOS_WEBHOOK_SEGREDO']) delete process.env[k];
});

async function api(metodo: string, rota: string, corpo?: unknown, s: { cookie?: string; csrf?: string } = {}) {
  const r = await fetch(`${base}/api${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(s.cookie ? { Cookie: s.cookie } : {}), ...(s.csrf ? { 'X-CSRF': s.csrf } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, json: (await r.json()) as any, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

describe('provedores', () => {
  it('telefone brasileiro em E.164', () => {
    expect(telefoneE164('(87) 99999-1234')).toBe('+5587999991234');
    expect(telefoneE164('+55 87 3838-1234')).toBe('+558738381234');
    expect(telefoneE164('087999991234')).toBe('+5587999991234');
    expect(telefoneE164('1234')).toBeNull();
  });

  it('fora do horário, WhatsApp/SMS esperam até 8h de Recife', () => {
    const p = { horaInicio: 8, horaFim: 20 };
    expect(dentroDoHorario(new Date('2026-11-10T02:30:00Z'), p).toISOString()).toBe('2026-11-10T11:00:00.000Z'); // 23h30 -> 8h do dia
    expect(dentroDoHorario(new Date('2026-11-10T14:00:00Z'), p).toISOString()).toBe('2026-11-10T14:00:00.000Z'); // 11h: na hora
    expect(dentroDoHorario(new Date('2026-11-10T23:30:00Z'), p).toISOString()).toBe('2026-11-11T11:00:00.000Z'); // 20h30 -> dia seguinte
  });

  it('formato das chamadas à Twilio (SMS) e à Meta (WhatsApp)', async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init! });
      return new Response(String(url).includes('twilio') ? '{"sid":"SM1"}' : '{"messages":[{"id":"wamid.1"}]}', { status: 200 });
    }) as typeof fetch;
    try {
      const cfg = lerConfigAvisos({
        AVISOS_SMS: 'twilio', TWILIO_SID: 'AC123', TWILIO_TOKEN: 'tk', TWILIO_NUMERO: '+15550001111',
        AVISOS_WHATSAPP: 'meta', WHATSAPP_TOKEN: 'EAAT', WHATSAPP_NUMERO_ID: '1098', WHATSAPP_MODELO_SITUACAO: 'situacao_pedido',
      });
      expect(await enviar(cfg, { via: 'SMS', para: '+5587999991234', texto: 'oi' })).toEqual({ ok: true, idExterno: 'SM1' });
      expect(chamadas[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
      expect(String(chamadas[0]!.init.body)).toBe('To=%2B5587999991234&From=%2B15550001111&Body=oi');
      expect((chamadas[0]!.init.headers as Record<string, string>)['Authorization']).toBe(`Basic ${Buffer.from('AC123:tk').toString('base64')}`);

      const r = await enviar(cfg, { via: 'WHATSAPP', para: '+5587999991234', texto: 'x', modelo: { nome: 'situacao_pedido', parametros: ['SER-1', 'Recebida', 'https://x'] } });
      expect(r).toEqual({ ok: true, idExterno: 'wamid.1' });
      expect(chamadas[1]!.url).toBe('https://graph.facebook.com/v23.0/1098/messages');
      expect(JSON.parse(String(chamadas[1]!.init.body))).toEqual({
        messaging_product: 'whatsapp', recipient_type: 'individual', to: '5587999991234', type: 'template',
        template: { name: 'situacao_pedido', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'SER-1' }, { type: 'text', text: 'Recebida' }, { type: 'text', text: 'https://x' }] }] },
      });
      // sem modelo aprovado o WhatsApp nao tenta
      expect((await enviar(cfg, { via: 'WHATSAPP', para: '+5587999991234', texto: 'x' })).ok).toBe(false);
      expect(chamadas.length).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('fila de avisos', () => {
  let demandaId = 0;
  let protocolo = '';

  it('registro gera aviso por SMS e e-mail, assinado, com link de acompanhamento e sem guardar o contato', async () => {
    const r = await api('POST', '/publico/demandas', {
      descricao: 'Lâmpada do poste apagada em frente à escola há uma semana.', servicoId: 1, localidadeId: 1, anonima: false,
      nome: 'Maria Teste', telefone: '(87) 99999-1234', email: 'maria@exemplo.com', consentimento: true, chaveIdempotencia: 'aviso-0001',
    });
    expect(r.status).toBe(201);
    protocolo = r.json.protocolo;
    demandaId = c.ctx.banco.get<{ id: number }>('SELECT id FROM demandas WHERE protocolo = ?', protocolo)!.id;
    const fila = c.ctx.banco.all<{ canal: string; destino: string; status: string }>('SELECT canal, destino, status FROM mensagens WHERE demanda_id = ?', demandaId);
    expect(fila.map((m) => m.canal).sort()).toEqual(['EMAIL', 'TELEFONE']);
    expect(fila.every((m) => m.status === 'PENDENTE' && !m.destino.includes('99999-1234') && !m.destino.includes('maria@'))).toBe(true);

    const res = await processarFila(c.ctx.banco);
    expect(res.enviadas).toBe(2);
    const sms = recebidos.find((x) => x.via === 'SMS')!;
    expect(sms.para).toBe('+5587999991234');
    expect(sms.texto).toContain(protocolo);
    expect(sms.texto).toContain(`https://servicos.sertania.test/#/acompanhar?protocolo=${protocolo}`);
    expect(sms.assinatura).toBe(`sha256=${createHmac('sha256', 'segredo-de-teste').update(sms.corpo).digest('hex')}`);
    expect(recebidos.find((x) => x.via === 'EMAIL')!.para).toBe('maria@exemplo.com');
  });

  it('falha do provedor: tenta de novo mais tarde e desiste na quinta vez', async () => {
    avisarSituacao(c.ctx.banco, { id: demandaId, protocolo, telefone: '(87) 99999-1234', email: null }, 'ENCAMINHADA');
    falharProximas = 99;
    let agora = new Date();
    for (let i = 0; i < 5; i++) {
      await processarFila(c.ctx.banco, undefined, agora);
      agora = new Date(agora.getTime() + 7 * 3600_000);
    }
    falharProximas = 0;
    const m = c.ctx.banco.get<{ status: string; tentativas: number; erro: string }>("SELECT status, tentativas, erro FROM mensagens WHERE demanda_id = ? ORDER BY id DESC LIMIT 1", demandaId)!;
    expect(m).toMatchObject({ status: 'FALHOU', tentativas: 5 });
    expect(m.erro).toContain('503');
  });

  it('anônima não recebe nada; contato anonimizado cancela o que estava na fila', async () => {
    expect(avisarSituacao(c.ctx.banco, { id: demandaId, protocolo, telefone: '(87) 99999-1234', email: 'a@b.com', anonima: true }, 'EM_EXECUCAO')).toBe(0);
    avisarSituacao(c.ctx.banco, { id: demandaId, protocolo, telefone: '(87) 99999-1234', email: null }, 'AGENDADA');
    c.ctx.banco.run('UPDATE demandas SET anonimizada_em = ? WHERE id = ?', new Date().toISOString(), demandaId);
    const res = await processarFila(c.ctx.banco);
    expect(res.canceladas).toBe(1);
    c.ctx.banco.run('UPDATE demandas SET anonimizada_em = NULL WHERE id = ?', demandaId);
  });

  it('pesquisa de satisfação: link de uso único, avaliação sem protocolo nem código', async () => {
    c.ctx.banco.run("UPDATE demandas SET status = 'CONCLUIDA', concluida_em = ?, resultado = 'RESOLVIDA' WHERE id = ?", new Date().toISOString(), demandaId);
    expect(agendarPesquisa(c.ctx.banco, { id: demandaId, protocolo, telefone: '(87) 99999-1234', email: 'maria@exemplo.com', servico: 'Iluminação' })).toBe(2);
    // a mesma conclusao nao gera pesquisa duplicada
    expect(agendarPesquisa(c.ctx.banco, { id: demandaId, protocolo, telefone: '(87) 99999-1234', email: 'maria@exemplo.com', servico: 'Iluminação' })).toBe(0);
    recebidos.length = 0;
    await processarFila(c.ctx.banco);
    const sms = recebidos.find((x) => x.via === 'SMS')!;
    const token = /#\/avaliar\/([A-Za-z0-9_-]+)/.exec(sms.texto)![1]!;
    // o link nunca fica salvo na fila
    expect(c.ctx.banco.get<{ n: number }>('SELECT COUNT(*) AS n FROM mensagens WHERE texto LIKE ?', `%${token}%`)!.n).toBe(0);

    const info = await api('GET', `/publico/pesquisa/${token}`);
    expect(info.json).toMatchObject({ protocolo, avaliada: false });
    expect((await api('POST', `/publico/pesquisa/${token}`, { nota: 5, comentario: 'Resolveram rápido' })).status).toBe(200);
    expect(c.ctx.banco.get<{ avaliacao_nota: number }>('SELECT avaliacao_nota FROM demandas WHERE id = ?', demandaId)!.avaliacao_nota).toBe(5);
    expect((await api('POST', `/publico/pesquisa/${token}`, { nota: 1 })).status).toBe(409);
    expect((await api('GET', '/publico/pesquisa/token-que-nao-existe-123456')).status).toBe(404);
  });

  it('relatório mensal: um por gestor, só na primeira semana, sem duplicar', async () => {
    const pa = await api('POST', '/configuracao/primeiro-acesso', { codigo: c.codigoPrimeiroAcesso, nome: 'Admin Prefeitura', email: 'ti@sertania.pe.gov.br', senha: 'SenhaForte2026' });
    const admin = { cookie: pa.cookie, csrf: pa.json.csrf };
    const diaUm = new Date('2026-12-02T12:00:00Z');
    expect(mesAnterior(diaUm)).toMatchObject({ chave: '2026-11', de: '2026-11-01', ate: '2026-11-30', nome: 'novembro de 2026' });
    expect(mesAnterior(new Date('2026-01-03T12:00:00Z')).chave).toBe('2025-12');
    expect(gerarRelatoriosMensais(c.ctx.banco, new Date('2026-12-15T12:00:00Z'))).toBe(0);
    expect(gerarRelatoriosMensais(c.ctx.banco, diaUm)).toBe(1);
    expect(gerarRelatoriosMensais(c.ctx.banco, diaUm)).toBe(0);
    recebidos.length = 0;
    await processarFila(c.ctx.banco);
    const email = recebidos.find((x) => x.via === 'EMAIL')!;
    expect(email.para).toBe('ti@sertania.pe.gov.br');
    expect(email.assunto).toBe('Sertânia Digital: resumo de novembro de 2026 – Município de Sertânia');
    expect(email.html).toContain('https://servicos.sertania.test/#/gestao/painel');
    expect(email.texto).not.toMatch(/maria|99999/i);

    // tela de configuracao
    const t = await api('GET', '/admin/avisos', undefined, admin);
    expect(t.status).toBe(200);
    expect(t.json.canais.SMS).toMatchObject({ tipo: 'webhook', pronto: true });
    expect(t.json.canais.WHATSAPP).toMatchObject({ tipo: 'desligado', pronto: false });
    expect(t.json.ultimas.length).toBeGreaterThan(0);
    expect(JSON.stringify(t.json.ultimas)).not.toContain('99999-1234');
    const teste = await api('POST', '/admin/avisos/teste', { via: 'SMS', para: '87 98888-7777' }, admin);
    expect(teste.json.ok).toBe(true);
    expect(recebidos.at(-1)!.para).toBe('+5587988887777');
    expect((await api('PUT', '/admin/avisos/preferencias', { ...PREFERENCIAS_PADRAO, horaInicio: 20, horaFim: 8 }, admin)).status).toBe(400);
    expect((await api('GET', '/admin/avisos')).status).toBe(401);
  });
});
