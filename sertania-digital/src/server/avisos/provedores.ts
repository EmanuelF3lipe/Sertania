import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';

/**
 * Provedores de envio. Os segredos ficam so no .env do servidor (nunca no banco nem na tela).
 *
 * - WhatsApp: API oficial da Meta (WhatsApp Cloud API), com modelos de mensagem aprovados.
 * - SMS: Twilio.
 * - E-mail: SMTP (o servidor de e-mail da Prefeitura ou um servico como SES, SendGrid, Brevo).
 * - Webhook: um endereco da Prefeitura que recebe a mensagem e repassa para qualquer gateway
 *   (Zenvia, n8n, o barramento do municipio). Serve para os tres canais.
 */

export type Via = 'WHATSAPP' | 'SMS' | 'EMAIL';

export interface Envio {
  via: Via;
  /** E.164 (+5587999991234) para WhatsApp e SMS; endereco para e-mail */
  para: string;
  assunto?: string;
  texto: string;
  html?: string;
  /** WhatsApp fora da janela de 24 h so aceita modelo aprovado: nome + valores das variaveis {{1}}, {{2}}... */
  modelo?: { nome: string; parametros: string[] };
  /** id interno da mensagem, repassado ao webhook */
  mensagemId?: number;
}
export interface ResultadoEnvio { ok: boolean; idExterno?: string; erro?: string }

export interface ConfigAvisos {
  urlPublica: string;
  email: 'smtp' | 'webhook' | 'desligado';
  sms: 'twilio' | 'webhook' | 'desligado';
  whatsapp: 'meta' | 'webhook' | 'desligado';
  smtp: { host: string; porta: number; seguro: boolean; usuario: string; senha: string; remetente: string };
  twilio: { sid: string; token: string; numero: string };
  meta: { token: string; numeroId: string; versao: string; idioma: string; modeloSituacao: string; modeloPesquisa: string };
  webhook: { url: string; segredo: string };
}

const um = <T extends string>(v: string | undefined, validos: readonly T[], padrao: T): T => (validos.includes(v as T) ? (v as T) : padrao);

export function lerConfigAvisos(env: NodeJS.ProcessEnv = process.env): ConfigAvisos {
  return {
    urlPublica: (env['URL_PUBLICA'] || 'http://localhost:5173').replace(/\/+$/, ''),
    email: um(env['AVISOS_EMAIL'], ['smtp', 'webhook', 'desligado'], 'desligado'),
    sms: um(env['AVISOS_SMS'], ['twilio', 'webhook', 'desligado'], 'desligado'),
    whatsapp: um(env['AVISOS_WHATSAPP'], ['meta', 'webhook', 'desligado'], 'desligado'),
    smtp: {
      host: env['SMTP_HOST'] ?? '', porta: Number(env['SMTP_PORTA'] ?? 587), seguro: env['SMTP_SEGURO'] === 'sim',
      usuario: env['SMTP_USUARIO'] ?? '', senha: env['SMTP_SENHA'] ?? '', remetente: env['SMTP_REMETENTE'] ?? '',
    },
    twilio: { sid: env['TWILIO_SID'] ?? '', token: env['TWILIO_TOKEN'] ?? '', numero: env['TWILIO_NUMERO'] ?? '' },
    meta: {
      token: env['WHATSAPP_TOKEN'] ?? '', numeroId: env['WHATSAPP_NUMERO_ID'] ?? '', versao: env['WHATSAPP_API_VERSAO'] || 'v23.0',
      idioma: env['WHATSAPP_IDIOMA'] || 'pt_BR', modeloSituacao: env['WHATSAPP_MODELO_SITUACAO'] ?? '', modeloPesquisa: env['WHATSAPP_MODELO_PESQUISA'] ?? '',
    },
    webhook: { url: env['AVISOS_WEBHOOK_URL'] ?? '', segredo: env['AVISOS_WEBHOOK_SEGREDO'] ?? '' },
  };
}

/** O que falta configurar em cada canal (lista vazia = pronto). Mostrado na tela, sem revelar segredos. */
export function pendenciasCanal(c: ConfigAvisos, via: Via): string[] {
  const tipo = via === 'EMAIL' ? c.email : via === 'SMS' ? c.sms : c.whatsapp;
  if (tipo === 'desligado') return ['desligado'];
  const falta = (pares: Array<[string, string]>) => pares.filter(([, v]) => !v).map(([n]) => n);
  if (tipo === 'webhook') return falta([['AVISOS_WEBHOOK_URL', c.webhook.url]]);
  if (tipo === 'smtp') return falta([['SMTP_HOST', c.smtp.host], ['SMTP_REMETENTE', c.smtp.remetente]]);
  if (tipo === 'twilio') return falta([['TWILIO_SID', c.twilio.sid], ['TWILIO_TOKEN', c.twilio.token], ['TWILIO_NUMERO', c.twilio.numero]]);
  return falta([['WHATSAPP_TOKEN', c.meta.token], ['WHATSAPP_NUMERO_ID', c.meta.numeroId]]);
}
export const canalPronto = (c: ConfigAvisos, via: Via) => pendenciasCanal(c, via).length === 0;
export const tipoCanal = (c: ConfigAvisos, via: Via): string => (via === 'EMAIL' ? c.email : via === 'SMS' ? c.sms : c.whatsapp);

/** Telefone brasileiro para E.164. Aceita "(87) 99999-1234", "87999991234", "+55 87 ...". */
export function telefoneE164(t: string | null | undefined): string | null {
  if (!t) return null;
  let d = t.replace(/\D/g, '');
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return `+${d}`;
}

const tempoLimite = () => AbortSignal.timeout(15_000);

async function lerErro(r: Response): Promise<string> {
  const corpo = await r.text().catch(() => '');
  try {
    const j = JSON.parse(corpo) as { message?: string; error?: { message?: string } };
    return `HTTP ${r.status}: ${j.error?.message ?? j.message ?? corpo.slice(0, 200)}`;
  } catch {
    return `HTTP ${r.status}: ${corpo.slice(0, 200)}`;
  }
}

async function viaWebhook(c: ConfigAvisos, e: Envio): Promise<ResultadoEnvio> {
  const corpo = JSON.stringify({ via: e.via, para: e.para, assunto: e.assunto ?? null, texto: e.texto, html: e.html ?? null, modelo: e.modelo ?? null, mensagemId: e.mensagemId ?? null });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // assinatura para o receptor conferir que a mensagem veio deste servidor
  if (c.webhook.segredo) headers['X-Sertania-Assinatura'] = `sha256=${createHmac('sha256', c.webhook.segredo).update(corpo).digest('hex')}`;
  const r = await fetch(c.webhook.url, { method: 'POST', headers, body: corpo, signal: tempoLimite() });
  if (!r.ok) return { ok: false, erro: await lerErro(r) };
  const j = (await r.json().catch(() => ({}))) as { id?: string };
  return { ok: true, idExterno: j.id ? String(j.id) : undefined };
}

async function viaTwilio(c: ConfigAvisos, e: Envio): Promise<ResultadoEnvio> {
  const { sid, token, numero } = c.twilio;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: e.para, From: numero, Body: e.texto }),
    signal: tempoLimite(),
  });
  if (!r.ok) return { ok: false, erro: await lerErro(r) };
  const j = (await r.json()) as { sid?: string };
  return { ok: true, idExterno: j.sid };
}

async function viaMeta(c: ConfigAvisos, e: Envio): Promise<ResultadoEnvio> {
  if (!e.modelo?.nome) return { ok: false, erro: 'Sem modelo de mensagem aprovado para este tipo de aviso (WHATSAPP_MODELO_*)' };
  const { token, numeroId, versao, idioma } = c.meta;
  const r = await fetch(`https://graph.facebook.com/${versao}/${encodeURIComponent(numeroId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: e.para.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: e.modelo.nome,
        language: { code: idioma },
        components: [{ type: 'body', parameters: e.modelo.parametros.map((text) => ({ type: 'text', text })) }],
      },
    }),
    signal: tempoLimite(),
  });
  if (!r.ok) return { ok: false, erro: await lerErro(r) };
  const j = (await r.json()) as { messages?: Array<{ id: string }> };
  return { ok: true, idExterno: j.messages?.[0]?.id };
}

let transporte: { chave: string; t: ReturnType<typeof nodemailer.createTransport> } | null = null;
async function viaSmtp(c: ConfigAvisos, e: Envio): Promise<ResultadoEnvio> {
  const s = c.smtp;
  const chave = `${s.host}:${s.porta}:${s.usuario}:${s.seguro}`;
  if (transporte?.chave !== chave) {
    transporte = {
      chave,
      t: nodemailer.createTransport({
        host: s.host, port: s.porta, secure: s.seguro,
        auth: s.usuario ? { user: s.usuario, pass: s.senha } : undefined,
        // nada de anexar arquivos ou buscar URLs a partir do conteudo da mensagem
        disableFileAccess: true, disableUrlAccess: true,
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
      }),
    };
  }
  const info = await transporte.t.sendMail({ from: s.remetente, to: e.para, subject: e.assunto ?? 'Prefeitura de Sertânia', text: e.texto, html: e.html });
  return { ok: true, idExterno: info.messageId };
}

/** Envia por um canal. Nunca lanca: o erro volta no resultado, para a fila registrar e tentar de novo. */
export async function enviar(c: ConfigAvisos, e: Envio): Promise<ResultadoEnvio> {
  const pend = pendenciasCanal(c, e.via);
  if (pend.length) return { ok: false, erro: pend[0] === 'desligado' ? 'Canal desligado' : `Falta configurar: ${pend.join(', ')}` };
  try {
    const tipo = tipoCanal(c, e.via);
    if (tipo === 'webhook') return await viaWebhook(c, e);
    if (tipo === 'twilio') return await viaTwilio(c, e);
    if (tipo === 'meta') return await viaMeta(c, e);
    if (tipo === 'smtp') return await viaSmtp(c, e);
    return { ok: false, erro: 'Provedor desconhecido' };
  } catch (err) {
    return { ok: false, erro: (err as Error).name === 'TimeoutError' ? 'O provedor não respondeu em 15 segundos' : (err as Error).message.slice(0, 300) };
  }
}
