// Conteudo e estilo da apresentacao (usado no PDF e nas cartelas do video).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RAIZ, CAPTURAS } from './comum.mjs';

const fonte = (pacote, arquivo) => pathToFileURL(path.join(RAIZ, 'node_modules/@fontsource', pacote, 'files', arquivo)).href;
export const img = (nome) => pathToFileURL(path.join(CAPTURAS, `${nome}.png`)).href;

export const MARCA = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0b3a22"/><g fill="#f0b400"><path d="M15 5.5h2l-1 4.5z"/><path d="M6.2 9.6l1.5-1.3 2.6 3.9z"/><path d="M25.8 9.6l-1.5-1.3-2.6 3.9z"/><path d="M2.8 16.6l.6-1.9 4.3 1.6z"/><path d="M29.2 16.6l-.6-1.9-4.3 1.6z"/><path d="M8.5 22.5a7.5 7.5 0 0 1 15 0z"/></g><path d="M20.4 22.5v-9.2a1.6 1.6 0 0 1 3.2 0v9.2zM23.6 18h1.6a1 1 0 0 0 1-1v-2.4a.9.9 0 0 1 1.8 0v2.9a2.6 2.6 0 0 1-2.6 2.6h-1.8zM20.4 19.4h-1.4a2.3 2.3 0 0 1-2.3-2.3v-1.6a.9.9 0 0 1 1.8 0v1.3a.8.8 0 0 0 .8.8h1.1z" fill="#5dbb82"/><rect x="3.5" y="22.5" width="25" height="3" rx="1.2" fill="#3fb874"/></svg>`;

export const CSS = `
@font-face { font-family: 'Zilla Slab'; font-weight: 600; src: url('${fonte('zilla-slab', 'zilla-slab-latin-600-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Zilla Slab'; font-weight: 700; src: url('${fonte('zilla-slab', 'zilla-slab-latin-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 400; src: url('${fonte('atkinson-hyperlegible', 'atkinson-hyperlegible-latin-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 700; src: url('${fonte('atkinson-hyperlegible', 'atkinson-hyperlegible-latin-700-normal.woff2')}') format('woff2'); }
:root { --verde: #11643a; --verde-forte: #0b4a2a; --verde-noite: #0b3a22; --verde-suave: #e2f1e7; --sol: #f0b400; --fundo: #f6f7f4; --texto: #14211a; --texto-2: #4a5850; --texto-3: #6b776f; --borda: #d7ddd3; }
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Atkinson Hyperlegible', system-ui, sans-serif; color: var(--texto); background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slide { width: 1280px; height: 720px; position: relative; overflow: hidden; background: var(--fundo); page-break-after: always; break-after: page; display: flex; flex-direction: column; }
.slide:last-child { page-break-after: auto; break-after: auto; }
.cordel { height: 12px; flex: none; background: linear-gradient(135deg, var(--sol) 25%, transparent 25%) -6px 0 / 12px 12px, linear-gradient(225deg, var(--sol) 25%, transparent 25%) -6px 0 / 12px 12px, var(--verde); }
h1, h2, h3 { font-family: 'Zilla Slab', Georgia, serif; margin: 0; line-height: 1.1; }
.topo { display: flex; align-items: center; gap: 14px; padding: 26px 56px 0; }
.topo .rotulo { font-size: 15px; text-transform: uppercase; letter-spacing: .14em; color: var(--verde); font-weight: 700; }
.topo .pag { margin-left: auto; font-size: 14px; color: var(--texto-3); }
.corpo { flex: 1; display: grid; grid-template-columns: 400px 1fr; gap: 40px; padding: 18px 56px 40px; align-items: center; }
.corpo.largo { grid-template-columns: 1fr; align-content: center; gap: 28px; }
.texto h2 { font-size: 40px; margin-bottom: 16px; }
.texto p { font-size: 19px; line-height: 1.45; color: var(--texto-2); margin: 0 0 14px; }
ul.lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
ul.lista li { font-size: 17.5px; line-height: 1.4; padding-left: 26px; position: relative; color: var(--texto); }
ul.lista li::before { content: ''; position: absolute; left: 2px; top: 8px; width: 12px; height: 12px; background: var(--sol); border: 2px solid var(--verde-forte); transform: rotate(45deg); }
ul.lista li b { color: var(--verde-forte); }
.tela { border: 2px solid var(--texto); border-radius: 12px; overflow: hidden; box-shadow: 8px 8px 0 var(--verde-forte); background: #fff; }
.tela .barra { height: 26px; background: #e9ede7; border-bottom: 1.5px solid var(--texto); display: flex; align-items: center; gap: 6px; padding: 0 10px; }
.tela .barra i { width: 9px; height: 9px; border-radius: 50%; background: #c9d1c6; display: block; }
.tela img { display: block; width: 100%; }
.duas-telas { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; align-items: start; }
.cel { width: 230px; border: 3px solid var(--texto); border-radius: 26px; overflow: hidden; box-shadow: 6px 6px 0 var(--verde-forte); background: #fff; }
.cel img { width: 100%; display: block; }
.celulares { display: flex; gap: 26px; justify-content: center; align-items: flex-start; }
.legenda { font-size: 14px; color: var(--texto-3); margin-top: 10px; text-align: center; }
.selo { display: inline-block; font-size: 13px; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; color: var(--verde); border: 2px solid var(--verde); padding: 3px 10px; border-radius: 4px; transform: rotate(-2deg); }
/* capa */
.capa { background: linear-gradient(140deg, var(--verde) 0%, var(--verde-forte) 60%, #072c19 100%); color: #fff; }
.capa .conteudo { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 90px; gap: 22px; position: relative; z-index: 1; }
.capa .marca { display: flex; align-items: center; gap: 18px; }
.capa .marca svg { width: 84px; height: 84px; filter: drop-shadow(4px 4px 0 rgba(0,0,0,.35)); }
.capa h1 { font-size: 78px; }
.capa .sub { font-size: 27px; max-width: 820px; line-height: 1.35; opacity: .95; }
.capa .rodape { font-size: 17px; opacity: .85; }
.capa .sol { position: absolute; right: -120px; bottom: -150px; width: 520px; height: 520px; border-radius: 50%; background: radial-gradient(circle, rgba(240,180,0,.95) 0 46%, transparent 47%); }
.capa .raios { position: absolute; right: -120px; bottom: -150px; width: 520px; height: 520px; border-radius: 50%; background: repeating-conic-gradient(from 0deg, rgba(240,180,0,.55) 0 4deg, transparent 4deg 15deg); -webkit-mask: radial-gradient(circle, transparent 50%, #000 51%, #000 70%, transparent 71%); mask: radial-gradient(circle, transparent 50%, #000 51%, #000 70%, transparent 71%); }
/* fluxo */
.fluxo { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-top: 26px; }
.etapa { background: #fff; border: 2px solid var(--texto); border-radius: 12px; padding: 18px 14px; box-shadow: 5px 5px 0 var(--verde-forte); position: relative; }
.etapa .n { width: 38px; height: 38px; border-radius: 8px; background: var(--verde); color: #fff; display: grid; place-items: center; font-family: 'Zilla Slab'; font-weight: 700; font-size: 20px; margin-bottom: 10px; }
.etapa h3 { font-size: 21px; margin-bottom: 6px; }
.etapa p { font-size: 15px; color: var(--texto-2); line-height: 1.38; margin: 0; }
.etapa:not(:last-child)::after { content: '→'; position: absolute; right: -15px; top: 42%; font-size: 22px; color: var(--verde); font-weight: 700; }
.pilares { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 24px; }
.pilar { background: #fff; border: 2px solid var(--texto); border-radius: 12px; padding: 22px; box-shadow: 6px 6px 0 var(--verde-forte); }
.pilar h3 { font-size: 27px; margin-bottom: 10px; color: var(--verde-forte); }
.pilar p { font-size: 17px; color: var(--texto-2); line-height: 1.45; margin: 0; }
.cartoes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.cartao { background: #fff; border: 1.5px solid var(--borda); border-left: 6px solid var(--verde); border-radius: 10px; padding: 16px 18px; }
.cartao h3 { font-size: 21px; margin-bottom: 6px; }
.cartao p { font-size: 15.5px; color: var(--texto-2); line-height: 1.42; margin: 0; }
table.req { width: 100%; border-collapse: collapse; font-size: 14.5px; background: #fff; border: 2px solid var(--texto); }
table.req th { background: var(--verde); color: #fff; text-align: left; padding: 9px 12px; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
table.req td { padding: 7px 12px; border-bottom: 1px solid var(--borda); vertical-align: top; line-height: 1.35; }
table.req td:first-child { font-weight: 700; width: 300px; color: var(--verde-forte); }
table.req tr:nth-child(even) td { background: #f3f6f1; }
.passos-impl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.passos-impl div { background: #fff; border: 1.5px solid var(--borda); border-radius: 10px; padding: 14px; }
.passos-impl b { display: block; font-family: 'Zilla Slab'; font-size: 19px; color: var(--verde-forte); margin-bottom: 4px; }
.passos-impl span { font-size: 14.5px; color: var(--texto-2); line-height: 1.4; }
.aviso-demo { position: absolute; left: 56px; bottom: 14px; font-size: 12.5px; color: var(--texto-3); }
`;

const topo = (rotulo, n) => `<div class="cordel"></div><div class="topo"><span class="rotulo">${rotulo}</span><span class="pag">Sertânia Digital · ${n}</span></div>`;
const tela = (nome) => `<div class="tela"><div class="barra"><i></i><i></i><i></i></div><img src="${img(nome)}" alt=""></div>`;
const lista = (itens) => `<ul class="lista">${itens.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const demo = '<div class="aviso-demo">Telas com dados de demonstração (fictícios). Não são números oficiais do Município.</div>';

export function capa(titulo = 'Sertânia Digital', sub = 'Plataforma web para registrar, encaminhar, acompanhar e medir as demandas do cidadão — com apoio de IA e decisão humana.', rodape = 'Desafio de Transformação Digital · Prefeitura Municipal de Sertânia – PE · novembro de 2026') {
  return `<section class="slide capa"><div class="cordel"></div><div class="sol"></div><div class="raios"></div>
    <div class="conteudo"><div class="marca">${MARCA}<span class="selo" style="color:#f0b400;border-color:#f0b400">Proposta de solução</span></div>
    <h1>${titulo}</h1><p class="sub">${sub}</p><p class="rodape">${rodape}</p></div></section>`;
}

/** Lista de slides do PDF. */
export function slides() {
  const s = [];
  let n = 1;
  const add = (html) => { s.push(html.replaceAll('{N}', String(n))); n += 1; };
  add(capa());

  add(`<section class="slide">${topo('O desafio e a resposta', '{N}')}<div class="corpo largo" style="align-content:center">
    <div class="texto"><h2>Uma porta de entrada única para os pedidos do município</h2>
    <p style="max-width:1050px">Hoje os pedidos chegam por balcão, telefone, WhatsApp e ouvidoria, cada secretaria com seu jeito de anotar. O Sertânia Digital registra tudo com protocolo, encaminha para o setor certo com prazo e responsável, mostra ao cidadão cada passo e entrega à gestão os números para decidir.</p></div>
    <div class="pilares">
      <div class="pilar"><h3>Cidadão</h3><p>Pede em 2 minutos pelo celular, mesmo com internet fraca, e acompanha com protocolo e código, sem precisar de conta.</p></div>
      <div class="pilar"><h3>Equipe</h3><p>Fila do seu setor com prazos em dias úteis, comandos claros de execução, evidências e a IA sugerindo — quem decide é a pessoa.</p></div>
      <div class="pilar"><h3>Gestão</h3><p>Indicadores por período, secretaria, serviço e localidade, mapa, relatórios, alertas e transparência com dados abertos.</p></div>
    </div></div></section>`);

  add(`<section class="slide">${topo('Como funciona', '{N}')}<div class="corpo largo">
    <div class="texto"><h2>Do pedido à conclusão, tudo com rastro</h2><p>Cada mudança vira um registro na linha do tempo, visível ao cidadão (texto público) e à equipe (notas internas).</p></div>
    <div class="fluxo">
      <div class="etapa"><div class="n">1</div><h3>Registro</h3><p>Portal, celular ou balcão (atendimento assistido). Gera protocolo e código.</p></div>
      <div class="etapa"><div class="n">2</div><h3>Triagem</h3><p>A IA sugere serviço, prioridade e resumo. A equipe aceita, ajusta ou rejeita.</p></div>
      <div class="etapa"><div class="n">3</div><h3>Encaminhamento</h3><p>Setor responsável, pessoa e prazo em dias úteis com feriados.</p></div>
      <div class="etapa"><div class="n">4</div><h3>Execução</h3><p>Agendar, iniciar, registrar impedimento, pedir informação (pausa o prazo).</p></div>
      <div class="etapa"><div class="n">5</div><h3>Conclusão</h3><p>Resultado, justificativa e fotos. O cidadão avalia o atendimento.</p></div>
      <div class="etapa"><div class="n">6</div><h3>Medição</h3><p>Indicadores, mapa, alertas e relatórios para melhorar o serviço.</p></div>
    </div></div></section>`);

  add(`<section class="slide">${topo('Para o cidadão', '{N}')}<div class="corpo">
    <div class="texto"><h2>Pedir é simples</h2>${lista([
      '<b>5 passos curtos</b>, em linguagem simples, pensados primeiro para o celular.',
      'Enquanto a pessoa escreve, a <b>IA sugere o tipo de serviço</b>.',
      'Local por <b>localidade, GPS ou toque no mapa</b> — sede, distritos e comunidades rurais.',
      'Até 5 <b>fotos ou documentos</b>, comprimidos no próprio aparelho.',
      'Ao final, <b>protocolo e código de acesso</b> para acompanhar.',
    ])}</div>
    <div class="duas-telas">${tela('02c-recorte-servico')}${tela('03c-recorte-local')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Para o cidadão', '{N}')}<div class="corpo">
    <div class="texto"><h2>Acompanhar sem conta</h2>${lista([
      'Com <b>protocolo + código</b>, a pessoa vê a situação, o prazo e cada passo.',
      'Responde quando a equipe pede informação e <b>avalia</b> ao final.',
      'Nunca aparecem notas internas nem nomes de servidores.',
      'Conta é <b>opcional</b>: reúne os pedidos em “Minhas solicitações” e permite exportar ou excluir os dados (LGPD).',
    ])}</div>
    <div>${tela('04-acompanhar')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('No celular', '{N}')}<div class="corpo">
    <div class="texto"><h2>Feito para o bolso — e para o sertão</h2>${lista([
      'Funciona como <b>aplicativo instalável (PWA)</b> e abre sem internet.',
      'Pedido feito offline fica guardado e é <b>enviado quando o sinal volta</b>, sem duplicar.',
      '<b>Acessibilidade</b>: texto maior, alto contraste, modo escuro e menos movimento.',
      'A equipe de campo usa a mesma área no celular.',
    ])}</div>
    <div class="celulares"><div class="cel"><img src="${img('21-celular-portal')}" alt=""></div><div class="cel"><img src="${img('22-celular-nova')}" alt=""></div><div class="cel"><img src="${img('23-celular-meu-dia')}" alt=""></div></div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Entrada no sistema', '{N}')}<div class="corpo">
    <div class="texto"><h2>Dois caminhos claros</h2>${lista([
      '<b>Equipe</b>: e-mail institucional e senha. Quem perde a senha pede pela tela e a administração gera uma provisória.',
      '<b>Cidadão</b>: primeiro a mensagem de que não precisa de conta, com atalhos para pedir e acompanhar.',
      'Servidor novo recebe <b>senha provisória</b> e cria a dele no primeiro acesso.',
      'Instalação nova só é assumida com o <b>código de instalação</b> mostrado no servidor.',
    ])}</div>
    <div class="duas-telas">${tela('06c-recorte-entrada')}${tela('07c-recorte-equipe')}</div></div></section>`);

  add(`<section class="slide">${topo('Para a equipe', '{N}')}<div class="corpo">
    <div class="texto"><h2>Meu dia</h2>${lista([
      'Ao entrar, cada servidor vê <b>só o seu escopo</b>: setor, secretaria ou município.',
      'Termômetro com abertas, triagem, com você, sem responsável, <b>vencidas</b> e resolvidas.',
      '<b>Na frente da fila</b>: as solicitações que pedem atenção primeiro.',
      'Menu por tarefa — Atender, Acompanhar, Ajustar — e <b>Guia da tela</b> no botão “?”.',
    ])}</div>
    <div>${tela('08-meu-dia')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Para a equipe', '{N}')}<div class="corpo">
    <div class="texto"><h2>Fila e tratamento</h2>${lista([
      'Recortes rápidos: triagem, minhas, sem responsável, urgentes, vencidas.',
      '<b>Comandos de negócio</b> (encaminhar, agendar, iniciar, impedimento, concluir) conferidos por regra única.',
      '<b>Prazo em dias úteis</b> (fuso de Recife, feriados), pausado enquanto se espera o cidadão.',
      'Duas pessoas não sobrescrevem a ação uma da outra (controle por versão).',
    ])}</div>
    <div>${tela('09-fila')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Inteligência artificial', '{N}')}<div class="corpo">
    <div class="texto"><h2>A IA sugere, a pessoa decide</h2>${lista([
      'Classificação do serviço, <b>prioridade</b> por termos de risco e <b>resumo</b> do pedido.',
      'Botões <b>Aceitar · Ajustar · Rejeitar</b> — cada decisão fica auditada.',
      'Detecção de <b>recorrência</b> no mesmo local e <b>alertas</b> de prazo e picos.',
      'Por padrão roda <b>localmente</b>: nenhum dado sai do servidor. Provedor externo é opcional e recebe texto pseudonimizado.',
    ])}</div>
    <div>${tela('11-demanda-ia')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Gestão', '{N}')}<div class="corpo">
    <div class="texto"><h2>Indicadores para decidir</h2>${lista([
      'Os <b>8 indicadores do desafio</b>: protocolo, tempo de encaminhamento e atendimento, prazo, recorrência, satisfação, uso dos painéis, aceitação da IA.',
      'Filtros por <b>período, secretaria, setor, serviço, situação, localidade e canal</b>.',
      'Todo gráfico tem “ver como tabela”. Exportação CSV e JSON <b>sem dados pessoais</b>.',
    ])}</div>
    <div>${tela('12-indicadores')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Gestão', '{N}')}<div class="corpo">
    <div class="texto"><h2>O município no mapa</h2>${lista([
      'Cada pedido no mapa, com <b>cor por situação</b> e tamanho por prioridade.',
      '<b>Focos de recorrência</b> destacados para agir na causa.',
      'Pedidos sem ponto exato ficam na posição aproximada da localidade.',
      'Servidor de mapas configurável para a escala da produção.',
    ])}</div>
    <div>${tela('14-mapa')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Gestão', '{N}')}<div class="corpo">
    <div class="texto"><h2>Alertas, relatórios e transparência</h2>${lista([
      '<b>Alertas</b>: prazo vencendo ou vencido, recorrência e pico por localidade, com sugestões da IA aguardando decisão.',
      '<b>Relatórios</b> por período e localidade, com análise escrita pela IA como rascunho até a revisão do gestor.',
      'Página pública de <b>Transparência</b> com os números do atendimento e dados abertos.',
    ])}</div>
    <div>${tela('15-alertas')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Pessoas e acesso', '{N}')}<div class="corpo">
    <div class="texto"><h2>Quem pode o quê</h2>${lista([
      '<b>7 perfis</b> com escopo por setor, secretaria ou município — conferido também na API.',
      'Equipe em <b>crachás</b>, cadastro com senha provisória e pedidos de nova senha em destaque.',
      'Matriz de permissões <b>editável</b>, com ações sensíveis marcadas e volta ao padrão.',
      'A SAD articula com visão consolidada <b>sem dados pessoais</b>, preservando a autonomia das secretarias.',
    ])}</div>
    <div>${tela('18-config-permissoes')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Pessoas e acesso', '{N}')}<div class="corpo">
    <div class="texto"><h2>Equipe em crachás</h2>${lista([
      'Cada servidor com <b>perfil, lotação e último acesso</b>.',
      'Cadastro numa gaveta lateral, com <b>senha provisória</b> gerada pelo sistema.',
      'Quem pediu nova senha aparece <b>em destaque</b> para a administração atender.',
      'Desligar um servidor encerra as sessões e <b>mantém o histórico</b>.',
    ])}</div>
    <div>${tela('17-config-equipe')}</div></div>${demo}</section>`);

  add(`<section class="slide">${topo('Segurança e LGPD', '{N}')}<div class="corpo">
    <div class="texto"><h2>Confiança desde a base</h2>${lista([
      '<b>Auditoria encadeada por hash</b>: qualquer alteração direta no banco é detectada.',
      'Senhas com scrypt, sessão HttpOnly com token CSRF, cabeçalhos de segurança e limite de tentativas.',
      '<b>Backup diário</b> e exportação completa em formato aberto.',
      'Retenção com <b>anonimização automática</b>, minimização por perfil e direitos do titular.',
    ])}</div>
    <div>${tela('19-config-auditoria')}</div></div></section>`);

  add(`<section class="slide">${topo('Integração e dados abertos', '{N}')}<div class="corpo largo" style="align-content:center">
    <div class="texto"><h2>Padrões abertos, sem dependência</h2></div>
    <div class="cartoes">
      <div class="cartao"><h3>API documentada</h3><p>REST com OpenAPI 3.1, pronta para ouvidoria, e-SIC, BI e sistemas estaduais.</p></div>
      <div class="cartao"><h3>Chaves com escopo</h3><p>Tokens para ler demandas, criar demandas ou ler indicadores — nunca entregam dados pessoais.</p></div>
      <div class="cartao"><h3>Dados abertos</h3><p>CSV e JSON públicos, com supressão de grupos com poucos casos para evitar reidentificação.</p></div>
      <div class="cartao"><h3>Portabilidade</h3><p>Exportação completa em JSON documentado: o município é dono dos seus dados.</p></div>
      <div class="cartao"><h3>Leve de manter</h3><p>Node.js com SQLite embutido. Roda em uma máquina simples, sem Docker nem banco externo.</p></div>
      <div class="cartao"><h3>Pronto para crescer</h3><p>Troca para PostgreSQL e login federado (OIDC) sem mudar as regras de negócio.</p></div>
    </div></div></section>`);

  add(`<section class="slide">${topo('Implantação', '{N}')}<div class="corpo largo" style="align-content:center">
    <div class="texto"><h2>Do banco limpo ao primeiro atendimento</h2><p>O sistema nasce vazio, só com o mínimo, e a própria tela de Configurações guia a implantação.</p></div>
    <div class="passos-impl">
      <div><b>1 · Instalar</b><span>Servidor com Node 22.13+ atrás de HTTPS. <code>npm install</code> e <code>npm run build</code>.</span></div>
      <div><b>2 · Primeiro acesso</b><span>Código de instalação no terminal cria a conta de administração.</span></div>
      <div><b>3 · Estrutura</b><span>Secretarias, setores e serviços com prazo e palavras-chave.</span></div>
      <div><b>4 · Território</b><span>Sede, distritos, comunidades rurais e feriados municipais.</span></div>
      <div><b>5 · Equipe</b><span>Servidores com perfil e lotação; senha provisória no primeiro acesso.</span></div>
      <div><b>6 · Linha de base</b><span>Números reais do diagnóstico, com fonte e validação por outra pessoa.</span></div>
      <div><b>7 · Teste</b><span>Um pedido de ponta a ponta, do registro à avaliação.</span></div>
      <div><b>8 · Divulgar</b><span>Endereço para o cidadão; o portal funciona sem conta.</span></div>
    </div></div></section>`);

  const req = [
    ['Registro digital, protocolo e acompanhamento', 'Formulário em 5 passos, protocolo + código, acompanhamento sem login, área do cidadão'],
    ['Descrição, localização, imagens e documentos', 'Localidade, GPS ou mapa, endereço e referência; até 5 fotos/PDFs validados pela assinatura'],
    ['Classificação, encaminhamento, responsáveis e prazos', 'Triagem com IA supervisionada, comando de encaminhar, responsável do setor, prazo em dias úteis'],
    ['Execução, impedimentos, evidências e conclusão', 'Agendar, iniciar, impedimento, pedir informação, concluir com resultado e fotos; reabertura'],
    ['Painéis com perfis e permissões', '7 perfis, escopo por setor/secretaria/município, matriz editável, verificação na API'],
    ['Indicadores e relatórios', '8 indicadores, filtros completos, exportação, relatórios com revisão do gestor'],
    ['Georreferenciamento', 'Mapa por situação e prioridade, focos de recorrência'],
    ['IA com supervisão humana', 'Classificação, prioridade, resumo, recorrência, alertas e relatórios — sempre com decisão humana auditada'],
    ['Integração por padrões abertos', 'API REST + OpenAPI 3.1, tokens com escopo, dados abertos'],
    ['Segurança, auditoria, backup e LGPD', 'Auditoria por hash, backup, retenção e anonimização, direitos do titular'],
    ['Território, conectividade e acessibilidade', 'PWA offline, envio diferido, atendimento assistido por canal, recursos de acessibilidade'],
    ['Diagnóstico e linha de base', 'Registro com fonte e validação por segunda pessoa; avisos de que dados de demonstração não são oficiais'],
  ];
  add(`<section class="slide">${topo('Requisitos do desafio', '{N}')}<div class="corpo largo" style="padding-top:8px">
    <table class="req"><thead><tr><th>O desafio pede</th><th>O Sertânia Digital entrega</th></tr></thead><tbody>${req.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div></section>`);

  add(`<section class="slide">${topo('Próximos passos', '{N}')}<div class="corpo largo" style="align-content:center">
    <div class="texto"><h2>O que falta para a produção</h2><p>Pontos conhecidos, já previstos na arquitetura:</p></div>
    <div class="cartoes">
      <div class="cartao"><h3>Notificações</h3><p>Avisos por SMS, WhatsApp e e-mail já ficam registrados; falta ligar o provedor escolhido pelo município.</p></div>
      <div class="cartao"><h3>Antivírus de anexos</h3><p>Etapa de quarentena para os arquivos enviados pelo cidadão.</p></div>
      <div class="cartao"><h3>Mapas em escala</h3><p>Servidor de mapas próprio ou contratado para o volume de produção.</p></div>
      <div class="cartao"><h3>Escala</h3><p>Migração para PostgreSQL quando o volume de secretarias e pedidos crescer.</p></div>
      <div class="cartao"><h3>Testes de interface</h3><p>Suíte automática das telas, somando-se aos testes de ponta a ponta da API.</p></div>
      <div class="cartao"><h3>Linha de base real</h3><p>Levantamento do diagnóstico com as secretarias para medir a melhoria.</p></div>
    </div></div></section>`);

  add(capa('Obrigado.', 'Sertânia Digital — cada pedido do cidadão, do protocolo à conclusão.', 'Código-fonte em TypeScript · roda com npm install && npm run dev'));
  return s;
}

export function documento(corpo, extraCss = '') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sertânia Digital — Apresentação</title><style>${CSS}${extraCss}</style></head><body>${corpo}</body></html>`;
}
