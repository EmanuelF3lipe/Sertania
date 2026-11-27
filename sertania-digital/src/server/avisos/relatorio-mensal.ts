import type { Banco } from '../db.js';
import { calcularIndicadores } from '../indicadores.js';
import { gravarRelatorio, lerPreferencias } from './fila.js';
import { lerConfigAvisos, type ConfigAvisos } from './provedores.js';

/**
 * Resumo do mes anterior por e-mail: cada gestor de secretaria recebe o da sua pasta; a administracao (SAD),
 * o do municipio. So numeros agregados, nenhum dado pessoal. Sai nos primeiros 7 dias do mes; a chave por
 * mes e servidor impede envio duplicado mesmo com o servidor reiniciando.
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Mes anterior no fuso de Recife: { chave: '2026-10', de, ate, nome: 'outubro de 2026' } */
export function mesAnterior(agora = new Date()) {
  const local = new Date(agora.getTime() - 3 * 3600_000);
  let ano = local.getUTCFullYear();
  let mes = local.getUTCMonth(); // 0-11 do mes atual -> o anterior e mes-1
  if (mes === 0) { ano -= 1; mes = 12; }
  const mm = String(mes).padStart(2, '0');
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { chave: `${ano}-${mm}`, de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${String(ultimo).padStart(2, '0')}`, nome: `${MESES[mes - 1]} de ${ano}`, diaAtual: local.getUTCDate() };
}

const num = (n: number | null | undefined, casas = 0, suf = '') => (n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })}${suf}`);
const horas = (h: number | null) => (h === null ? '—' : h >= 48 ? `${num(h / 24, 1)} dias` : `${num(h, 1)} h`);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function montarRelatorio(banco: Banco, cfg: ConfigAvisos, escopo: { nome: string; secretariaId: number | null }, mes: ReturnType<typeof mesAnterior>) {
  const i = calcularIndicadores(banco, null, { de: mes.de, ate: mes.ate, secretariaId: escopo.secretariaId ?? undefined });
  const linhas: Array<[string, string]> = [
    ['Solicitações recebidas', num(i.total)],
    ['Concluídas', num(i.concluidas)],
    ['Concluídas dentro do prazo', num(i.noPrazoPct, 1, '%')],
    ['Ainda abertas com prazo vencido', num(i.vencidasAbertas)],
    ['Tempo até o encaminhamento (mediana)', horas(i.tempoEncaminhamentoHoras.mediana)],
    ['Tempo de atendimento (mediana)', horas(i.tempoAtendimentoHoras.mediana)],
    ['Satisfação do cidadão', i.satisfacao.media === null ? '—' : `${num(i.satisfacao.media, 1)} de 5 (${i.satisfacao.respostas} avaliações)`],
  ];
  const servicos = i.porServico.slice(0, 5);
  const locais = i.porLocalidade.slice(0, 5);
  const painel = `${cfg.urlPublica}/#/gestao/painel`;
  const assunto = `Sertânia Digital: resumo de ${mes.nome} – ${escopo.nome}`;
  const destaque = i.total === 0
    ? `Nenhuma solicitação registrada em ${mes.nome}.`
    : i.vencidasAbertas > 0
      ? `${i.vencidasAbertas} solicitação(ões) seguem abertas com o prazo vencido e pedem atenção.`
      : 'Nenhuma solicitação aberta com prazo vencido.';
  const texto = [
    `Resumo de ${mes.nome} – ${escopo.nome}`, '', destaque, '',
    ...linhas.map(([r, v]) => `${r}: ${v}`), '',
    servicos.length ? `Serviços mais pedidos: ${servicos.map((s) => `${s.nome} (${s.total})`).join('; ')}` : '',
    locais.length ? `Localidades com mais pedidos: ${locais.map((s) => `${s.nome ?? 'sem localidade'} (${s.total})`).join('; ')}` : '',
    '', `Painel completo: ${painel}`, '',
    'Mensagem automática do Sertânia Digital. Números agregados, sem dados pessoais.',
  ].filter((l, k, a) => l !== '' || a[k - 1] !== '').join('\n');
  const tabela = linhas.map(([r, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#4a5850">${esc(r)}</td><td style="padding:6px 0;font-weight:700;text-align:right">${esc(v)}</td></tr>`).join('');
  const lista = (titulo: string, itens: Array<{ nome: string | null; total: number }>) => itens.length
    ? `<h3 style="font-size:15px;margin:20px 0 6px">${esc(titulo)}</h3><ol style="margin:0;padding-left:20px">${itens.map((s) => `<li>${esc(s.nome ?? 'sem localidade')} <span style="color:#6b776f">(${s.total})</span></li>`).join('')}</ol>`
    : '';
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f7f4;font-family:Arial,Helvetica,sans-serif;color:#14211a">
<div style="max-width:560px;margin:0 auto;background:#fff;border-top:6px solid #11643a">
<div style="padding:20px 24px">
<p style="margin:0;color:#11643a;font-weight:700">Prefeitura Municipal de Sertânia</p>
<h1 style="font-size:20px;margin:6px 0 4px">Resumo de ${esc(mes.nome)}</h1>
<p style="margin:0 0 16px;color:#4a5850">${esc(escopo.nome)}</p>
<p style="margin:0 0 16px;padding:10px 12px;background:${i.vencidasAbertas > 0 ? '#fdf1e2' : '#e2f1e7'};border-radius:6px">${esc(destaque)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${tabela}</table>
${lista('Serviços mais pedidos', servicos)}
${lista('Localidades com mais pedidos', locais)}
<p style="margin:24px 0 8px"><a href="${esc(painel)}" style="display:inline-block;background:#11643a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:700">Abrir o painel completo</a></p>
<p style="font-size:12px;color:#6b776f;margin:16px 0 0">Mensagem automática do Sertânia Digital. Números agregados, sem dados pessoais. Para deixar de receber, peça à administração do sistema.</p>
</div></div></body></html>`;
  return { assunto, texto, html, total: i.total };
}

interface Destinatario { id: number; email: string; escopo: string; secretaria_id: number | null; secretaria: string | null }

/** Grava os relatorios do mes anterior na fila. Devolve quantos foram gravados agora. */
export function gerarRelatoriosMensais(banco: Banco, agora = new Date(), cfg: ConfigAvisos = lerConfigAvisos()): number {
  if (!lerPreferencias(banco).relatorioMensalAtivo) return 0;
  const mes = mesAnterior(agora);
  if (mes.diaAtual > 7) return 0; // janela de envio: primeira semana do mes
  const pessoas = banco.all<Destinatario>(
    `SELECT u.id, u.email, c.escopo, l.secretaria_id, s.nome AS secretaria FROM usuarios u
     JOIN cargos c ON c.id = u.cargo_id
     LEFT JOIN usuario_lotacoes l ON l.usuario_id = u.id AND c.escopo = 'SECRETARIA'
     LEFT JOIN secretarias s ON s.id = l.secretaria_id
     WHERE u.ativo = 1 AND u.papel <> 'CIDADAO' AND c.escopo IN ('MUNICIPIO','SECRETARIA')
       AND EXISTS (SELECT 1 FROM json_each(c.permissoes) j WHERE j.value = 'painel.ver')
       AND (c.escopo = 'MUNICIPIO' OR l.secretaria_id IS NOT NULL)`);
  let n = 0;
  for (const p of pessoas) {
    const chave = `relatorio:${mes.chave}:u${p.id}${p.escopo === 'SECRETARIA' ? `:s${p.secretaria_id}` : ''}`;
    if (banco.get('SELECT 1 FROM mensagens WHERE chave = ?', chave)) continue;
    const escopo = p.escopo === 'MUNICIPIO' ? { nome: 'Município de Sertânia', secretariaId: null } : { nome: p.secretaria ?? 'Secretaria', secretariaId: p.secretaria_id };
    const r = montarRelatorio(banco, cfg, escopo, mes);
    if (gravarRelatorio(banco, { usuarioId: p.id, email: p.email, assunto: r.assunto, texto: r.texto, html: r.html, chave })) n++;
  }
  return n;
}

/** Previa: o relatorio do mes anterior para quem pediu, na hora (botao na tela de configuracao). */
export function previaRelatorio(banco: Banco, usuario: { id: number; email: string; secretariaId: number | null; municipio: boolean }, cfg: ConfigAvisos = lerConfigAvisos()) {
  const mes = mesAnterior();
  const sec = usuario.secretariaId ? banco.get<{ nome: string }>('SELECT nome FROM secretarias WHERE id = ?', usuario.secretariaId)?.nome : null;
  const escopo = usuario.municipio || !usuario.secretariaId ? { nome: 'Município de Sertânia', secretariaId: null } : { nome: sec ?? 'Secretaria', secretariaId: usuario.secretariaId };
  const r = montarRelatorio(banco, cfg, escopo, mes);
  gravarRelatorio(banco, { usuarioId: usuario.id, email: usuario.email, assunto: `[Prévia] ${r.assunto}`, texto: r.texto, html: r.html, chave: `previa:${usuario.id}:${Date.now()}` });
  return r;
}

/** Qual resumo sai no proximo envio: o do mes anterior se ainda estamos na janela (dias 1 a 7), senao o do mes atual. */
export function proximoRelatorio(agora = new Date()): string {
  const ant = mesAnterior(agora);
  if (ant.diaAtual <= 7) return `${ant.nome}, até o dia 7 deste mês`;
  const local = new Date(agora.getTime() - 3 * 3600_000);
  const mes = local.getUTCMonth();
  const seguinte = MESES[(mes + 1) % 12];
  return `${MESES[mes]} de ${local.getUTCFullYear()}, na primeira semana de ${seguinte}`;
}
