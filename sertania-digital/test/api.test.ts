import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { criarApp } from '../src/server/app.js';
import { SENHA_DEMO } from '../src/server/seed.js';
import { verificarCadeia } from '../src/server/auditoria.js';
import type { Ctx } from '../src/server/contexto.js';

let base = '';
let servidor: Server;
let ctx: Ctx;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sertania-teste-'));

class Cliente {
  cookie = '';
  csrf = '';
  async req(metodo: string, rota: string, corpo?: unknown) {
    const r = await fetch(`${base}/api${rota}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf ? { 'X-CSRF': this.csrf } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0]!;
    const texto = await r.text();
    let json: any = null;
    try { json = JSON.parse(texto); } catch { json = texto; }
    return { status: r.status, json };
  }
  async entrar(email: string) {
    const r = await this.req('POST', '/auth/entrar', { email, senha: SENHA_DEMO });
    expect(r.status).toBe(200);
    this.csrf = r.json.csrf;
    return this;
  }
}

beforeAll(async () => {
  const criado = criarApp({ pastaDados: pasta, iaProvedor: 'local' });
  ctx = criado.ctx;
  await new Promise<void>((ok) => { servidor = criado.app.listen(0, ok); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.close();
  ctx.banco.fechar();
  fs.rmSync(pasta, { recursive: true, force: true });
});

describe('fluxo completo de uma demanda', () => {
  let protocolo = '';
  let codigo = '';
  let demandaId = 0;

  it('cidadão sem conta registra e recebe protocolo + código', async () => {
    const anon = new Cliente();
    const cat = await anon.req('GET', '/publico/catalogo');
    const servico = cat.json.servicos.find((s: any) => s.nome.startsWith('Lâmpada'));
    const sug = await anon.req('POST', '/publico/sugerir-servico', { texto: 'o poste da minha rua está com a lâmpada apagada' });
    expect(sug.json[0].servicoId).toBe(servico.id);
    const r = await anon.req('POST', '/publico/demandas', {
      servicoId: servico.id, descricao: 'Poste apagado em frente ao número 120, rua muito escura', localidadeId: 1,
      lat: -8.073, lng: -37.264, nome: 'Teste da Silva', telefone: '(87) 99999-1234', consentimento: true, chaveIdempotencia: 'chave-teste-123456',
    });
    expect(r.status).toBe(201);
    expect(r.json.protocolo).toMatch(/^SER-\d{4}-\d{6}$/);
    protocolo = r.json.protocolo;
    codigo = r.json.codigo;
    // reenviar a mesma chave (falha de rede / envio offline) nao duplica
    const de_novo = await anon.req('POST', '/publico/demandas', {
      servicoId: servico.id, descricao: 'Poste apagado em frente ao número 120, rua muito escura', localidadeId: 1, consentimento: true, chaveIdempotencia: 'chave-teste-123456',
    });
    expect(de_novo.json.protocolo).toBe(protocolo);
  });

  it('acompanhamento exige o código correto', async () => {
    const anon = new Cliente();
    expect((await anon.req('POST', '/publico/acompanhar', { protocolo, codigo: 'ERRADO' })).status).toBe(404);
    const ok = await anon.req('POST', '/publico/acompanhar', { protocolo, codigo });
    expect(ok.status).toBe(200);
    expect(ok.json.statusTexto).toBe('Recebida');
    demandaId = ok.json.id;
  });

  it('atendimento encaminha; campo executa; cidadão responde; conclusão; avaliação', async () => {
    const atend = await new Cliente().entrar('atendimento@sertania.demo');
    let d = (await atend.req('GET', `/gestao/demandas/${demandaId}`)).json;
    expect(d.solicitante.telefone).toBe('(87) 99999-1234'); // atendimento ve dados completos
    expect(d.comandos).toContain('ENCAMINHAR');
    const semCsrf = new Cliente();
    semCsrf.cookie = atend.cookie;
    expect((await semCsrf.req('POST', `/gestao/demandas/${demandaId}/comandos/ENCAMINHAR`, { versao: d.versao, servicoId: d.servicoId })).status).toBe(403);
    d = (await atend.req('POST', `/gestao/demandas/${demandaId}/comandos/ENCAMINHAR`, { versao: d.versao, servicoId: d.servicoId })).json;
    expect(d.status).toBe('ENCAMINHADA');
    // versao antiga -> conflito
    expect((await atend.req('POST', `/gestao/demandas/${demandaId}/comandos/CANCELAR`, { versao: 1, textoPublico: 'x' })).status).toBe(409);

    const vias = await new Cliente().entrar('campo.vias@sertania.demo');
    expect((await vias.req('GET', `/gestao/demandas/${demandaId}`)).status).toBe(403); // outro setor

    const campo = await new Cliente().entrar('campo.iluminacao@sertania.demo');
    d = (await campo.req('GET', `/gestao/demandas/${demandaId}`)).json;
    expect(d.solicitante.telefone).toBe('(**) *****-1234'); // campo ve dado minimizado
    d = (await campo.req('POST', `/gestao/demandas/${demandaId}/comandos/SOLICITAR_INFO`, { versao: d.versao, textoPublico: 'Qual o número do poste?' })).json;
    expect(d.status).toBe('AGUARDANDO_CIDADAO');
    expect(d.sla.pausada).toBe(true);

    const anon = new Cliente();
    const resp = await anon.req('POST', '/publico/responder', { protocolo, codigo, texto: 'Poste número 4521' });
    expect(resp.json.status).toBe('ENCAMINHADA');

    d = (await campo.req('GET', `/gestao/demandas/${demandaId}`)).json;
    d = (await campo.req('POST', `/gestao/demandas/${demandaId}/comandos/INICIAR_EXECUCAO`, { versao: d.versao })).json;
    expect((await campo.req('POST', `/gestao/demandas/${demandaId}/comandos/CONCLUIR`, { versao: d.versao, textoPublico: 'ok' })).status).toBe(400); // sem resultado
    d = (await campo.req('POST', `/gestao/demandas/${demandaId}/comandos/CONCLUIR`, { versao: d.versao, textoPublico: 'Lâmpada trocada', resultado: 'RESOLVIDA' })).json;
    expect(d.status).toBe('CONCLUIDA');

    const publico = (await anon.req('POST', '/publico/acompanhar', { protocolo, codigo })).json;
    expect(publico.eventos.every((e: any) => e.notaInterna === undefined)).toBe(true);
    expect(publico.eventos.some((e: any) => e.autor.includes('Bruno'))).toBe(false); // nome de servidor nao vaza
    expect((await anon.req('POST', '/publico/avaliar', { protocolo, codigo, nota: 5 })).status).toBe(200);
    expect((await anon.req('POST', '/publico/avaliar', { protocolo, codigo, nota: 1 })).status).toBe(409);
  });

  it('cidadão não executa comandos e SAD vê sem dados pessoais', async () => {
    const cid = await new Cliente().entrar('cidadao@sertania.demo');
    expect((await cid.req('GET', `/gestao/demandas/${demandaId}`)).status).toBe(403);
    const sad = await new Cliente().entrar('admin@sertania.demo');
    const d = (await sad.req('GET', `/gestao/demandas/${demandaId}`)).json;
    expect(d.dadosPessoaisOcultos).toBe(true);
    expect(d.comandos).toEqual([]);
  });
});

describe('indicadores, IA, integração e auditoria', () => {
  it('painel calcula os indicadores sugeridos', async () => {
    const g = await new Cliente().entrar('gestor.infra@sertania.demo');
    const i = (await g.req('GET', '/gestao/indicadores')).json;
    expect(i.total).toBeGreaterThan(0);
    expect(i.porSecretaria.every((s: any) => s.nome === 'Infraestrutura e Obras')).toBe(true); // escopo
    for (const k of ['rastreabilidadePct', 'tempoEncaminhamentoHoras', 'tempoAtendimentoHoras', 'noPrazoPct', 'porLocalidade', 'recorrenciaPct', 'satisfacao', 'usoPaineis']) expect(i).toHaveProperty(k);
  });

  it('IA local sugere e a decisão humana fica registrada', async () => {
    const atend = await new Cliente().entrar('atendimento@sertania.demo');
    const fila = (await atend.req('GET', '/gestao/demandas?visao=triagem')).json;
    const id = fila.itens[0].id;
    const a = (await atend.req('POST', `/gestao/demandas/${id}/analisar`)).json;
    expect(a.provedor).toBe('local');
    expect(a.classificacao.length).toBeGreaterThan(0);
    expect((await atend.req('POST', `/gestao/ia/sugestoes/${a.sugestaoId}/decidir`, { decisao: 'ACEITA' })).status).toBe(200);
    expect((await atend.req('POST', `/gestao/ia/sugestoes/${a.sugestaoId}/decidir`, { decisao: 'REJEITADA' })).status).toBe(409);
  });

  it('recorrências e alertas são detectados nos dados de demonstração', async () => {
    const g = await new Cliente().entrar('gestor.infra@sertania.demo');
    const rec = (await g.req('GET', '/gestao/ia/recorrencias')).json;
    expect(rec.some((r: any) => r.total >= 3)).toBe(true);
    const alertas = (await g.req('GET', '/gestao/alertas')).json;
    expect(alertas.length).toBeGreaterThan(0);
  });

  it('exportação gerencial não contém dados pessoais', async () => {
    const g = await new Cliente().entrar('gestor.infra@sertania.demo');
    const csv = (await g.req('GET', '/gestao/exportar?formato=csv')).json as string;
    expect(csv).toContain('protocolo');
    expect(csv).not.toContain('99999-1234');
  });

  it('token de integração respeita escopo e não expõe descrição', async () => {
    const sad = await new Cliente().entrar('admin@sertania.demo');
    const t = (await sad.req('POST', '/admin/tokens', { nome: 'Sistema de teste', escopos: ['demandas:ler'] })).json;
    const r = await fetch(`${base}/api/integracao/v1/demandas`, { headers: { Authorization: `Bearer ${t.token}` } });
    const lista = (await r.json()) as any[];
    expect(r.status).toBe(200);
    expect(lista[0]).not.toHaveProperty('descricao');
    const r2 = await fetch(`${base}/api/integracao/v1/indicadores`, { headers: { Authorization: `Bearer ${t.token}` } });
    expect(r2.status).toBe(403);
  });

  it('dados abertos suprimem grupos pequenos', async () => {
    const d = (await new Cliente().req('GET', '/publico/dados-abertos')).json;
    expect(d.registros.some((r: any) => r.suprimido && r.total === null)).toBe(true);
  });

  it('backup e cadeia de auditoria íntegra; adulteração é detectada', async () => {
    const sad = await new Cliente().entrar('admin@sertania.demo');
    expect((await sad.req('POST', '/admin/backups')).status).toBe(201);
    const a = (await sad.req('GET', '/admin/auditoria')).json;
    expect(a.cadeia.integra).toBe(true);
    ctx.banco.run("UPDATE auditoria SET detalhes = '{}' WHERE id = 2");
    expect(verificarCadeia(ctx.banco).integra).toBe(false);
  });
});
