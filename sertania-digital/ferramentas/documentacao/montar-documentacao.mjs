// Gera documentacao/Sertania-Digital-documentacao.pdf (manual do sistema em A4).
// Uso: node ferramentas/documentacao/montar-documentacao.mjs
// As imagens vem de apresentacao/capturas (gere antes com "npm run apresentacao:capturas").
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirNavegador, RAIZ, CAPTURAS } from '../apresentacao/comum.mjs';
import { MARCA } from '../apresentacao/slides.mjs';

const SAIDA = path.join(RAIZ, 'documentacao');
fs.mkdirSync(SAIDA, { recursive: true });
const VERSAO = '1.1.0';
const DATA = 'novembro de 2026';

const fonte = (pacote, arquivo) => pathToFileURL(path.join(RAIZ, 'node_modules/@fontsource', pacote, 'files', arquivo)).href;
const temCaptura = (nome) => fs.existsSync(path.join(CAPTURAS, `${nome}.png`));
const figura = (nome, legenda, classe = '') =>
  temCaptura(nome)
    ? `<figure class="${classe}"><div class="tela"><img src="${pathToFileURL(path.join(CAPTURAS, `${nome}.png`)).href}" alt=""></div><figcaption>${legenda}</figcaption></figure>`
    : '';
const celulares = (itens) =>
  `<div class="celulares">${itens.filter(([n]) => temCaptura(n)).map(([n, l]) => `<figure><div class="cel"><img src="${pathToFileURL(path.join(CAPTURAS, `${n}.png`)).href}" alt=""></div><figcaption>${l}</figcaption></figure>`).join('')}</div>`;
const tabela = (cab, linhas, classe = '') =>
  `<table class="${classe}"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const nota = (titulo, texto, tipo = '') => `<div class="nota ${tipo}"><strong>${titulo}</strong> ${texto}</div>`;
const passos = (itens) => `<ol class="passos">${itens.map((i) => `<li>${i}</li>`).join('')}</ol>`;

// ------------------------------------------------------------------ capitulos
const capitulos = [];
const cap = (id, titulo, corpo) => capitulos.push({ id, titulo, corpo });

cap('visao', 'Visão geral', `
<p class="abre">O <b>Sertânia Digital</b> é a plataforma web da Prefeitura Municipal de Sertânia (PE) para receber, encaminhar, acompanhar e medir as solicitações dos cidadãos. Cada pedido ganha um protocolo, vai para o setor certo com prazo e responsável, e pode ser acompanhado pelo cidadão do começo ao fim, sem precisar de conta.</p>
<p>A inteligência artificial ajuda na triagem, na detecção de problemas recorrentes, nos resumos, nos alertas e na redação de relatórios. Ela <b>só sugere</b>: toda decisão é de uma pessoa da equipe e fica registrada.</p>
<h3>Para quem é</h3>
${tabela(['Público', 'O que faz no sistema'], [
  ['<b>Cidadão</b>', 'Registra pedidos (com fotos e localização), acompanha pelo protocolo, responde a pedidos de informação e avalia o atendimento. Conta é opcional.'],
  ['<b>Atendimento / triagem</b>', 'Recebe os pedidos, classifica, encaminha ao setor e registra pedidos feitos no balcão, telefone, WhatsApp ou ouvidoria.'],
  ['<b>Equipes de campo</b>', 'Veem as solicitações do seu setor, agendam, executam, registram impedimentos e concluem com evidências.'],
  ['<b>Gestores</b>', 'Distribuem o trabalho, acompanham prazos, indicadores, mapa, alertas e relatórios do setor ou da secretaria.'],
  ['<b>Administração (SAD)</b>', 'Configura o sistema: secretarias, serviços, localidades, equipe, permissões, integrações, backup e privacidade.'],
  ['<b>Controle interno</b>', 'Consulta a auditoria encadeada e os indicadores, sem alterar nada.'],
])}
<h3>Princípios</h3>
<ul class="lista">
<li><b>Linguagem simples</b> para o cidadão; códigos internos ficam só para a equipe.</li>
<li><b>Funciona no celular e com internet fraca:</b> é um app instalável (PWA) e guarda pedidos feitos sem sinal para enviar depois.</li>
<li><b>Autonomia das secretarias:</b> cada perfil vê só o seu escopo; a SAD articula e enxerga o município sem dados pessoais.</li>
<li><b>Tudo auditado:</b> cada ação fica num registro encadeado por hash, que denuncia qualquer alteração.</li>
<li><b>Simples de instalar:</b> roda com Node.js e um banco SQLite embutido, sem Docker nem servidor de banco.</li>
</ul>
${nota('Dados de demonstração.', 'As telas deste manual usam dados fictícios (secretarias, serviços, prazos, comunidades e solicitações). Não são números oficiais do Município.', 'aviso')}
`);

cap('conceitos', 'Conceitos', `
<h3>Solicitação, protocolo e código de acesso</h3>
<p>Cada pedido registrado é uma <b>solicitação</b> (ou demanda). Ela recebe um <b>protocolo</b> no formato <code>SER-AAAA-NNNNNN</code> (por exemplo <code>SER-2026-000123</code>) e um <b>código de acesso</b> de 6 letras e números. Com os dois, qualquer pessoa acompanha a solicitação sem login. Os dois aparecem no comprovante entregue ao final do registro.</p>
<h3>Situações</h3>
${tabela(['Situação (código)', 'Como o cidadão vê', 'Significado'], [
  ['<code>RECEBIDA</code>', 'Recebida', 'Entrou no sistema e aguarda triagem.'],
  ['<code>ENCAMINHADA</code>', 'Enviada ao setor responsável', 'Está com o setor que vai resolver.'],
  ['<code>AGUARDANDO_CIDADAO</code>', 'Precisamos de uma informação sua', 'A equipe pediu um dado ao cidadão. O prazo fica pausado.'],
  ['<code>AGENDADA</code>', 'Atendimento agendado', 'Tem data marcada para a execução.'],
  ['<code>EM_EXECUCAO</code>', 'Equipe trabalhando', 'O serviço está sendo feito.'],
  ['<code>IMPEDIDA</code>', 'Com impedimento', 'Algo impede a execução (falta de material, chuva…), com justificativa.'],
  ['<code>CONCLUIDA</code>', 'Concluída', 'Encerrada com resultado: resolvida, não procede, duplicada ou fora da competência do município.'],
  ['<code>CANCELADA</code>', 'Cancelada', 'Encerrada sem execução, com justificativa.'],
], 'compacta')}
<h3>Prioridade, canal e localidade</h3>
<ul class="lista">
<li><b>Prioridade:</b> baixa, normal, alta ou urgente. A IA sugere; a equipe decide.</li>
<li><b>Canal:</b> aplicativo/site, presencial, telefone, WhatsApp ou ouvidoria. Pedidos fora do site entram pelo <i>atendimento assistido</i>.</li>
<li><b>Localidade:</b> sede, distrito ou comunidade rural, além de ponto no mapa (GPS ou toque), endereço e referência.</li>
</ul>
<h3>Prazo</h3>
<p>Cada serviço tem um prazo em <b>dias úteis</b>, contado no fuso de Recife e descontando feriados nacionais, estaduais e municipais. O prazo fica pausado apenas enquanto a solicitação espera uma resposta do cidadão e <b>não reinicia</b> quando ela é transferida de setor.</p>

`);

cap('cidadao', 'Guia do cidadão', `
<p class="abre">O cidadão usa o portal público. Não precisa de conta: basta guardar o protocolo e o código de acesso.</p>
${figura('01-portal', 'Página inicial do portal: registrar, acompanhar e serviços mais procurados.')}
<h3>Registrar uma solicitação (5 passos)</h3>
${passos([
  '<b>O que aconteceu.</b> Descreva com suas palavras. Enquanto você escreve, o sistema sugere o tipo de serviço.',
  '<b>Tipo de serviço.</b> Confirme a sugestão ou escolha outro. Se não souber, use “Outro assunto / não sei o setor”.',
  '<b>Onde é.</b> Escolha a localidade (sede, distrito ou comunidade), use o GPS ou marque no mapa. Endereço e ponto de referência ajudam a equipe.',
  '<b>Fotos ou documentos</b> (opcional). Até 5 fotos ou PDFs; as fotos são comprimidas no próprio aparelho.',
  '<b>Seus dados e revisão.</b> Informe nome e contato, ou registre de forma anônima. Confira e envie.',
])}
<div class="duas">${figura('02c-recorte-servico', 'Passo 2: a sugestão de serviço já vem marcada.')}${figura('03c-recorte-local', 'Passo 3: localidade e ponto no mapa.')}</div>
<p>Ao final aparece o <b>comprovante</b> com protocolo e código de acesso, que pode ser impresso ou compartilhado.</p>
${nota('Sem internet?', 'Pode preencher normalmente. O pedido fica guardado no aparelho e é enviado sozinho quando o sinal voltar, sem duplicar.')}
<h3>Acompanhar</h3>
<p>Em <b>Acompanhar</b>, informe o protocolo e o código. A tela mostra a situação atual, o setor responsável, o prazo e a linha do tempo com cada passo dado. Quando a equipe pede uma informação, a resposta é dada ali mesmo. Depois da conclusão, o cidadão pode <b>avaliar</b> o atendimento.</p>
${figura('04-acompanhar', 'Acompanhamento pelo protocolo SER-2026-000001 (demonstração).')}
<h3>Conta opcional</h3>
<p>Quem preferir pode criar uma conta para ver todas as suas solicitações em “Minhas solicitações”. Pela conta também é possível <b>baixar os próprios dados</b> e <b>excluir a conta</b>, como prevê a LGPD.</p>
<h3>Transparência e dados abertos</h3>
<p>A página <b>Transparência</b> mostra números gerais do atendimento (volume, prazos, satisfação, por serviço e localidade). Os dados abertos nunca trazem dados pessoais, e grupos com poucos casos são suprimidos para evitar identificação.</p>
${figura('05-transparencia', 'Página de transparência.')}
<h3>Acessibilidade</h3>
<p>A barra verde no topo e o botão redondo no canto da tela abrem o painel de acessibilidade: letras maiores, contraste, leitura em voz alta, Libras, ditado e comandos de voz. Detalhes no capítulo <i>Acessibilidade</i>. O site abre sempre no tema claro.</p>
${celulares([['21-celular-portal', 'Portal no celular'], ['22-celular-nova', 'Registro no celular']])}
`);

cap('acessibilidade', 'Acessibilidade', `
<p class="abre">Qualquer pessoa consegue registrar e acompanhar uma solicitação: quem não enxerga ou enxerga pouco, quem não ouve, quem não pode digitar ou usar o mouse, quem tem dificuldade de leitura. E quem não quiser usar o site é atendido por telefone, WhatsApp ou pessoalmente.</p>
<p>Tudo fica no <b>painel de acessibilidade</b>, aberto pelo botão redondo no canto inferior direito de todas as telas (também na área da equipe), pela barra verde no topo do portal ou pelo atalho <b>Alt + 3</b>. As escolhas ficam guardadas no aparelho da pessoa.</p>
${figura('25-acess-painel', 'Painel de acessibilidade aberto sobre a página inicial.')}
<h3>O que há para cada pessoa</h3>
${tabela(['Para quem', 'Recursos'], [
  ['Não enxerga', 'Funciona com leitores de tela (NVDA, JAWS, TalkBack, VoiceOver): campos e botões têm nome, a cada troca de página o título é anunciado e recebe o foco, e avisos e erros são lidos. Sem leitor de tela, o próprio site <b>lê a página em voz alta</b> ou lê o que a pessoa tocar, selecionar ou percorrer com Tab, em três velocidades.'],
  ['Enxerga pouco', 'Letras em três tamanhos, alto contraste, modo escuro, tons de cinza, cursor grande, destaque de links e do item selecionado, guia de leitura que escurece o resto da tela.'],
  ['Não ouve', '<b>Tradutor de Libras VLibras</b>, do Governo Federal. O site não usa som para avisar nada; a leitura em voz alta aparece também como legenda escrita.'],
  ['Não pode digitar', 'Botão <b>Falar em vez de digitar</b> nos campos do registro. Ligando o ditado no painel, um microfone aparece em qualquer campo. Pontuação falada: “vírgula”, “ponto final”, “nova linha”.'],
  ['Não usa o mouse', '<b>Comandos de voz</b> para navegar, escolher, preencher e enviar; todo o site funciona só com o teclado; botões e campos maiores para quem tem tremor.'],
  ['Dificuldade de leitura', 'Linguagem simples e formulário em 5 passos, fonte de leitura fácil, mais espaço entre letras e linhas, opção sem animações.'],
])}
<h3>Comandos de voz</h3>
<p>Ligados no painel (ou com <b>Alt + 5</b>), o microfone fica ouvindo e a frase reconhecida aparece numa faixa na parte de baixo da tela. “Mostrar números” põe um número em tudo que dá para clicar; basta dizer o número.</p>
${figura('27-acess-numeros', 'Depois de “mostrar números”: diga “13” para escolher o campo e “escrever…” para preenchê-lo.', 'media')}
${tabela(['Fale', 'O que acontece'], [
  ['“ir para registrar”, “acompanhar”, “transparência”, “início”', 'Abre a página'],
  ['“mostrar números”, depois “número 3”', 'Aciona o item numerado'],
  ['“clicar em enviar”, “escolher lâmpada”', 'Aciona o botão, link ou opção com esse nome'],
  ['“continuar”, “voltar”, “enviar”', 'Avança ou volta nos passos do formulário'],
  ['“próximo campo”, “escrever …”, “apagar campo”', 'Preenche o campo selecionado'],
  ['“descer”, “subir”, “ler a página”, “parar”', 'Rola, lê em voz alta ou para a leitura'],
  ['“letra maior”, “contraste”, “modo escuro”, “ajuda”', 'Ajusta a tela ou mostra a lista de comandos'],
])}
<h3>Atalhos de teclado</h3>
${tabela(['Atalho', 'Ação'], [
  ['Alt + 1 / Alt + 2', 'Ir para o conteúdo / para o menu'],
  ['Alt + 3', 'Abrir o painel de acessibilidade'],
  ['Alt + 4', 'Ler a página em voz alta (de novo para parar)'],
  ['Alt + 5', 'Ligar ou desligar os comandos de voz'],
  ['Esc', 'Parar a leitura e fechar janelas'],
])}
<p>Os primeiros Tabs de cada página mostram os links “Ir para o conteúdo”, “Ir para o menu” e “Acessibilidade”, como no padrão eMAG do governo. No Firefox, use Alt + Shift + número.</p>
<h3>Página “Acessibilidade” e atendimento sem o site</h3>
<p>Em <code>#/acessibilidade</code> fica a declaração de acessibilidade: o que existe para cada pessoa, os atalhos, os comandos e os contatos de atendimento (telefone, WhatsApp, e-mail e endereço, puxados de <b>Configurações › Prefeitura</b>). Mantenha esses contatos atualizados: são a alternativa para quem não usa o site, e a equipe registra o pedido em <b>Registrar no balcão</b>.</p>
${figura('26-acess-pagina', 'Página de acessibilidade do portal.', 'media')}
${nota('O que depende do navegador.', 'A leitura em voz alta usa a voz do próprio aparelho. O ditado e os comandos de voz usam o reconhecimento de voz do navegador: funcionam no Chrome e no Edge (no Chrome, o áudio é processado pelo serviço de voz do Google); em outros navegadores, o botão não aparece e o microfone do teclado do celular continua disponível. O VLibras só é carregado quando a pessoa liga o tradutor e precisa de internet.', 'aviso')}
<p>O site segue como referência o eMAG e as WCAG 2.2, nível AA. Não há certificação formal; recomenda-se um teste com usuários com deficiência antes do lançamento.</p>
`);

cap('entrada', 'Entrar no sistema', `
<p class="abre">A tela <b>Entrar</b> pergunta “Como você quer entrar?” e oferece dois caminhos.</p>
<div class="duas">${figura('06c-recorte-entrada', 'Escolha do caminho.')}${figura('07c-recorte-equipe', 'Caminho da equipe.')}</div>
<ul class="lista">
<li><b>Sou da equipe da prefeitura:</b> e-mail e senha. Depois do login, o servidor vai para a <b>Área da equipe</b>.</li>
<li><b>Sou cidadão ou cidadã:</b> mostra primeiro que <b>não é preciso conta</b>, com atalhos para registrar e acompanhar. Entrar ou criar conta é opcional.</li>
</ul>
<h3>Primeiro login e troca de senha</h3>
<p>Quando o administrador cadastra um servidor, por padrão a pessoa é obrigada a <b>criar a própria senha</b> no primeiro login, antes de ver qualquer dado. A senha deve ter pelo menos 8 caracteres, e a tela mostra uma barra de força.</p>
<h3>Esqueci minha senha (servidores)</h3>
${passos([
  'Na tela de login da equipe, clique em <b>Perdi o acesso à minha senha</b> e informe o e-mail.',
  'O sistema responde sempre da mesma forma, exista ou não o e-mail, para não revelar quem tem conta.',
  'O pedido aparece em destaque em <b>Configurações › Equipe</b>. O administrador gera uma <b>senha provisória</b> com um clique e a entrega à pessoa.',
  'A sessão antiga é encerrada e, no próximo login, a pessoa é obrigada a criar uma senha nova.',
])}
${nota('Proteção contra tentativas.', 'Login e pedidos de senha têm limite de tentativas por período.')}
`);

cap('equipe', 'Área da equipe', `
<p class="abre">A área da equipe tem um <b>menu lateral</b> com as seções <i>Atender</i>, <i>Acompanhar</i>, <i>Ajustar</i> e <i>Portal público</i>. Cada item só aparece para quem tem a permissão. O menu pode ser estreitado para ícones e vira gaveta no celular.</p>
<p>No alto de cada tela ficam o título, o <b>carimbo de lotação</b> (secretaria e setor, ou “Município todo”), as opções de leitura, o tema de dia ou de noite, o botão <b>?</b> com o <i>Guia da tela</i> passo a passo e o menu da conta (Meus dados, Trocar minha senha, Sair).</p>
<h3>Meu dia</h3>
${figura('08-meu-dia', 'Meu dia: termômetro do escopo, fila prioritária e atalhos.')}
<ul class="lista">
<li><b>Termômetro:</b> abertas, em triagem, minhas, sem responsável, vencidas e urgentes. Cada número abre a fila já filtrada.</li>
<li><b>Na frente da fila:</b> as 6 solicitações abertas mais urgentes.</li>
<li><b>Caminhos fixados:</b> atalhos que cada pessoa escolhe.</li>
<li><b>Primeiros passos</b> (administração): roteiro de implantação com o andamento.</li>
</ul>
<h3>Fila de solicitações</h3>
${figura('09-fila', 'Fila com visões rápidas e filtros.')}
<p>Visões rápidas: <b>Todas</b>, <b>Para triagem</b>, <b>Minhas</b>, <b>Sem responsável</b>, <b>Urgentes</b> e <b>Prazo vencido</b>. Também há filtros por secretaria, setor, serviço, situação, localidade, canal e período. Clique numa linha para abrir a solicitação.</p>
<h3>Tratar uma solicitação</h3>
<p>O detalhe mostra a descrição, o local, os anexos, o prazo, a linha do tempo e as anotações internas. As ações disponíveis dependem da situação atual e da permissão da pessoa:</p>
${tabela(['Ação', 'De onde pode partir', 'Exige'], [
  ['Encaminhar ao setor', 'Recebida, encaminhada, agendada, em execução, impedida', 'Setor de destino (permite reclassificar o serviço)'],
  ['Pedir informação ao cidadão', 'Recebida, encaminhada, agendada, em execução, impedida', 'Texto da pergunta. Pausa o prazo'],
  ['Agendar atendimento', 'Encaminhada, em execução, impedida', 'Data'],
  ['Iniciar execução', 'Encaminhada, agendada, impedida', '—'],
  ['Registrar impedimento', 'Encaminhada, agendada, em execução', 'Justificativa'],
  ['Concluir', 'Encaminhada, agendada, em execução, impedida', 'Resultado e justificativa'],
  ['Cancelar', 'Qualquer situação aberta', 'Justificativa'],
  ['Reabrir', 'Concluída ou cancelada', 'Justificativa. Abre um novo ciclo'],
])}
<p>Além das ações, é possível <b>definir o responsável</b> (somente pessoas do setor), registrar <b>anotações internas</b> e anexar <b>evidências</b> de execução, marcadas como públicas ou internas.</p>
${nota('Sem sobrescrever o trabalho dos outros.', 'Se duas pessoas agirem na mesma solicitação ao mesmo tempo, a segunda recebe um aviso para recarregar, em vez de apagar a ação da primeira.')}
${figura('10-demanda', 'Detalhe da solicitação.')}
<h3>Atendimento assistido</h3>
<p>Em <b>Registrar no balcão</b>, o atendente registra pedidos recebidos presencialmente, por telefone, WhatsApp ou ouvidoria. O formulário é o mesmo do cidadão, com a escolha do canal, e o comprovante pode ser impresso para entregar à pessoa.</p>
<h3>Apoio da IA</h3>
${figura('11-demanda-ia', 'Sugestões da IA com Aceitar, Ajustar e Rejeitar.')}
<p>Na triagem, a IA sugere <b>serviço</b>, <b>prioridade</b> e um <b>resumo</b>, e aponta solicitações parecidas na mesma região (<b>recorrência</b>). Cada sugestão tem os botões <b>Aceitar</b>, <b>Ajustar</b> e <b>Rejeitar</b>, e a decisão humana fica registrada. O indicador de aceitação mostra quanto a equipe confia no apoio automático.</p>
<p>Por padrão a IA roda <b>no próprio servidor</b> (classificador local e regras), e nenhum dado sai da prefeitura. Opcionalmente pode usar o Claude, da Anthropic, recebendo apenas texto pseudonimizado. Detalhes, consumo e limite de gasto no capítulo <i>Inteligência artificial</i>.</p>
`);

cap('gestao', 'Gestão e acompanhamento', `
<h3>Indicadores</h3>
${figura('12-indicadores', 'Painel de indicadores.')}
<p>O painel reúne os indicadores do atendimento: volume, abertas e concluídas, cumprimento de prazo, tempo médio de solução, reaberturas, satisfação, aceitação da IA e distribuição por serviço, setor, localidade e canal. Todos os filtros (período, secretaria, setor, serviço, situação, localidade e canal) valem para os números e os gráficos. Os dados podem ser exportados em CSV ou JSON, sempre sem dados pessoais.</p>
${figura('13-indicadores-graficos', 'Gráficos do painel.')}
<h3>Mapa do município</h3>
${figura('14-mapa', 'Mapa com situação, prioridade e focos de recorrência.')}
<p>O mapa mostra as solicitações por situação e prioridade e destaca os <b>focos de recorrência</b>. Quando não há ponto marcado, usa a posição aproximada da localidade. Os mapas vêm do OpenStreetMap por padrão; para uso intenso em produção, configure um provedor próprio (veja <i>Instalação</i>).</p>
<h3>Alertas</h3>
${figura('15-alertas', 'Alertas de prazo, recorrência e pico.')}
<p>A cada 5 minutos o sistema recalcula os alertas: <b>prazo vencendo</b>, <b>prazo vencido</b>, <b>recorrência</b> no mesmo lugar e <b>pico</b> de pedidos numa localidade. Quem tem permissão marca o alerta como tratado.</p>
<h3>Relatórios</h3>
${figura('16-relatorios', 'Relatórios por período, setor e localidade.')}
<p>Os relatórios usam os mesmos filtros do painel. A IA redige uma <b>narrativa</b> que fica como rascunho até o gestor revisar e publicar. Relatórios ficam salvos e podem ser impressos em PDF pelo navegador.</p>
`);

cap('ia', 'Inteligência artificial', `
<p class="abre">A IA do Sertânia Digital <b>sugere, não decide</b>. Ela pode funcionar de dois jeitos, escolhidos no arquivo <code>.env</code> do servidor.</p>
${tabela(['', 'IA local (padrão)', 'Claude (opcional)'], [
  ['Como ativar', '<code>IA_PROVEDOR=local</code>', '<code>IA_PROVEDOR=claude</code> e <code>ANTHROPIC_API_KEY</code>'],
  ['Onde roda', 'No próprio servidor da Prefeitura', 'Na API da Anthropic, modelo <code>claude-opus-5-5</code>'],
  ['Custo', 'Nenhum', 'Cobrado por token pela Anthropic'],
  ['Dados enviados', 'Nenhum', 'Só o relato, sem dados pessoais (veja abaixo)'],
  ['Qualidade', 'Boa para casos comuns; aprende com o catálogo e o histórico', 'Entende melhor relatos longos ou confusos e escreve resumos e relatórios mais naturais'],
])}
<h3>Quando a IA é usada</h3>
${tabela(['Momento', 'O que faz', 'Qual IA'], [
  ['Cidadão digitando o relato', 'Sugere o tipo de serviço em tempo real', 'Sempre a local'],
  ['Toda solicitação nova (site ou balcão)', 'Sugere serviço, prioridade e resumo, e aponta casos parecidos na região', 'Claude, se ativado'],
  ['Botão <b>Analisar</b> numa solicitação', 'Refaz a sugestão', 'Claude, se ativado'],
  ['Gerar relatório', 'Redige a narrativa (rascunho até o gestor revisar)', 'Claude, se ativado'],
  ['A cada 5 minutos', 'Alertas de prazo, recorrência e pico', 'Sempre a local'],
])}
<p>Cada sugestão mostra qual IA a gerou e fica <b>pendente</b> até alguém da equipe aceitar, ajustar ou rejeitar. A decisão humana é registrada.</p>
<h3>Privacidade no envio ao Claude</h3>
<p>Antes de cada envio, o sistema troca CPF, e-mail, telefone e o nome do solicitante por <code>[CPF]</code>, <code>[EMAIL]</code>, <code>[TELEFONE]</code> e <code>[NOME]</code>. Na narrativa de relatórios vão apenas números agregados. A resposta do Claude é conferida contra um formato fixo e contra o catálogo de serviços; qualquer coisa fora disso é descartada.</p>
<h3>O que são tokens</h3>
<p>A Anthropic cobra por <b>tokens</b>, pedaços de texto (em português, um token tem em média 3 a 4 letras). Cada chamada tem tokens de <b>entrada</b> (as instruções, o catálogo de serviços e o relato) e de <b>saída</b> (a resposta). Os tokens de <b>cache</b> são partes repetidas da instrução que a Anthropic pode reaproveitar com desconto. O preço por milhão de tokens está na tabela de preços da Anthropic e muda com o modelo.</p>
${nota('Não confunda', 'com os <b>tokens de integração</b> (capítulo de Integração), que são chaves de acesso para outros sistemas usarem a API do Sertânia Digital.')}
<h3>Consumo e limite mensal</h3>
${figura('24-config-ia', 'Configurações › Consumo da IA.', 'media')}
<p>Toda chamada ao Claude é registrada com os tokens de entrada, saída e cache, o tipo de uso e se deu certo. Em <b>Configurações › Consumo da IA</b> (permissão de Integrações) a administração vê:</p>
<ul class="lista">
<li>o total do mês, com uma barra em relação ao limite (amarela a partir de 80%, vermelha ao atingir);</li>
<li>chamadas, tokens de entrada, saída e cache, e falhas;</li>
<li>o consumo por tipo de uso (triagem ou narrativa) e dos últimos 6 meses;</li>
<li>as 20 últimas chamadas.</li>
</ul>
<p>O <b>limite mensal</b> é definido ali mesmo, em tokens (0 = sem limite). Ao ser atingido, o sistema <b>para de chamar o Claude</b> e passa a usar a IA local até o mês virar ou até o limite ser ampliado. Nada trava para a equipe nem para o cidadão. O mês é contado no fuso de Recife, e toda mudança de limite vai para a auditoria.</p>
<h3>Quando o Claude falha</h3>
<p>Se a chave estiver errada, a API estiver fora do ar, a resposta vier fora do formato ou o limite tiver sido atingido, a <b>IA local assume na hora</b>. A falha aparece no consumo como “falhou, IA local assumiu”, e o servidor registra o motivo no log.</p>
${nota('Para estimar o gasto,', 'acompanhe alguns dias de uso real e multiplique os tokens pelo preço do modelo. Como cada solicitação nova gera uma chamada, o consumo cresce junto com o volume de pedidos. Defina um limite antes de divulgar o sistema.', 'aviso')}
`);

cap('avisos', 'Avisos, pesquisa e relatório mensal', `
<p class="abre">O cidadão é avisado por <b>WhatsApp, SMS e e-mail</b> a cada mudança de situação, recebe um link para <b>avaliar</b> quando o pedido é concluído, e cada secretário recebe por e-mail o <b>resumo do mês</b>.</p>
${tabela(['Mensagem', 'Quando sai', 'Para quem', 'Canal'], [
  ['Aviso de situação', 'A cada mudança de situação escolhida pela administração (padrão: todas)', 'Cidadão que deixou telefone ou e-mail', 'WhatsApp (ou SMS, se falhar) e e-mail'],
  ['Pesquisa de satisfação', 'Horas depois da conclusão (padrão: 2 h)', 'Cidadão que deixou telefone ou e-mail', 'WhatsApp ou SMS e e-mail, com link de avaliação'],
  ['Relatório mensal', 'Na primeira semana do mês, com os números do mês anterior', 'Gestores de secretaria (da sua pasta) e administração (município)', 'E-mail'],
])}
<p>Pedidos anônimos não geram mensagem. WhatsApp e SMS só saem entre 8h e 20h de Recife; fora disso, esperam o dia seguinte. O e-mail sai na hora.</p>
<h3>Avaliação pelo link</h3>
<p>O link da pesquisa abre uma página com cinco notas, de “Muito ruim” a “Muito bom”, e um campo opcional de comentário (que também aceita ditado). Não pede protocolo nem código. O link vale 30 dias e serve uma vez. Quem preferir continua avaliando em <b>Acompanhar</b>.</p>
<h3>Configurações › Avisos e mensagens</h3>
${figura('28-config-avisos', 'Canais de envio, mensagem de teste e números dos últimos 30 dias.')}
<ul class="lista">
<li><b>Canais de envio:</b> mostra se WhatsApp, SMS e e-mail estão prontos e o que falta configurar, sem revelar as chaves.</li>
<li><b>Mensagem de teste:</b> manda na hora para um telefone ou e-mail digitado, para conferir o provedor.</li>
<li><b>O que o cidadão recebe:</b> em quais situações avisar, se manda a pesquisa e com quantas horas, e o horário de WhatsApp e SMS.</li>
<li><b>Relatório mensal:</b> liga ou desliga, e manda uma prévia para o seu e-mail.</li>
<li><b>Últimas mensagens:</b> situação de cada uma (enviada, na fila, falhou, sem canal configurado, cancelada), com o motivo e o botão <b>Reenviar</b>.</li>
</ul>
<h3>Como os envios funcionam</h3>
<p>As mensagens entram numa fila e saem a cada minuto. Se o provedor falha, o sistema tenta de novo em 5 min, 30 min, 2 h e 6 h; depois disso, marca como falha. A fila guarda o contato <b>mascarado</b> e busca o real na solicitação só na hora de enviar: se os dados pessoais já foram anonimizados pela retenção (LGPD), a mensagem é cancelada.</p>
<h3>Provedores (arquivo <code>.env</code>)</h3>
${tabela(['Canal', 'Opções', 'O que configurar'], [
  ['WhatsApp', 'Meta (API oficial) ou webhook', '<code>WHATSAPP_TOKEN</code>, <code>WHATSAPP_NUMERO_ID</code> e dois modelos aprovados pela Meta: situação ({{1}} protocolo, {{2}} situação, {{3}} link) e pesquisa ({{1}} protocolo, {{2}} serviço, {{3}} link)'],
  ['SMS', 'Twilio ou webhook', '<code>TWILIO_SID</code>, <code>TWILIO_TOKEN</code>, <code>TWILIO_NUMERO</code>'],
  ['E-mail', 'SMTP ou webhook', '<code>SMTP_HOST</code>, <code>SMTP_PORTA</code>, usuário, senha e <code>SMTP_REMETENTE</code>'],
  ['Webhook', 'Qualquer gateway (Zenvia, n8n, barramento do município)', '<code>AVISOS_WEBHOOK_URL</code> e <code>AVISOS_WEBHOOK_SEGREDO</code>: o sistema envia um POST JSON assinado com HMAC no cabeçalho <code>X-Sertania-Assinatura</code>'],
])}
${nota('Também defina', '<code>URL_PUBLICA</code> com o endereço do sistema: ele vai nos links de acompanhamento, avaliação e painel. Sem provedor configurado, as mensagens ficam registradas como “sem canal configurado” e podem ser reenviadas depois.', 'aviso')}
`);

cap('config', 'Configurações (administração)', `
<p class="abre">Tudo o que se ajusta no sistema fica em <b>Configurações</b>, com um índice lateral em quatro grupos.</p>
${tabela(['Grupo', 'Seção', 'O que faz'], [
  ['Você', 'Meus dados', 'Nome, telefone e e-mail; crachá com perfil e lotação; último acesso.'],
  ['', 'Senha e acesso', 'Troca da própria senha, com indicador de força.'],
  ['', 'Leitura', 'Tema de noite, letras maiores, contraste forte e sem animações.'],
  ['Prefeitura', 'Órgão', 'Nome do sistema, órgão, e-mail e telefone de contato, endereço e horário de atendimento, aviso na página inicial.'],
  ['', 'Secretarias e serviços', 'Secretarias, setores e serviços, com prazo em dias úteis e palavras-chave usadas pela IA.'],
  ['', 'Localidades e feriados', 'Sede, distritos e comunidades rurais com coordenadas; feriados municipais.'],
  ['', 'Linha de base', 'Indicadores reais do diagnóstico, com fonte e período. Exige validação por uma segunda pessoa.'],
  ['Pessoas e acesso', 'Equipe', 'Servidores em crachás, cadastro e edição, pedidos de nova senha e senha provisória.'],
  ['', 'Quem pode o quê', 'Matriz de permissões por perfil, editável.'],
  ['Dados e conformidade', 'Auditoria', 'Registro encadeado de todas as ações, com verificação de integridade.'],
  ['', 'Backup e dados', 'Backups sob demanda e exportação completa em JSON.'],
  ['', 'Integrações', 'Tokens de acesso à API para outros sistemas.'],
  ['', 'Avisos e mensagens', 'WhatsApp, SMS e e-mail ao cidadão, pesquisa de satisfação e relatório mensal.'],
  ['', 'Consumo da IA', 'Tokens gastos com o Claude por mês e limite mensal.'],
  ['', 'Privacidade', 'Política de retenção e anonimização (LGPD).'],
], 'compacta')}
<h3>Equipe</h3>
${figura('17-config-equipe', 'Equipe em crachás, com busca e filtros.')}
${passos([
  'Clique em <b>Cadastrar servidor</b>. Abre uma gaveta lateral.',
  'Informe nome, e-mail, <b>perfil</b> e <b>lotação</b> (secretaria e setor, quando o perfil exigir).',
  'Defina a primeira senha ou deixe o sistema <b>gerar</b> uma. Mantenha marcada a opção que obriga a pessoa a trocar a senha no primeiro login.',
  'Entregue a senha à pessoa por um canal seguro. Ela aparece uma única vez.',
])}
<p>No mesmo lugar é possível editar perfil e lotação, desativar o acesso e gerar senha provisória para quem pediu.</p>
<h3>Quem pode o quê</h3>
${figura('18-config-permissoes', 'Matriz de permissões por perfil.')}
<p>A matriz mostra os 6 perfis da equipe lado a lado e as 18 permissões agrupadas por módulo. Em <b>Editar</b>, marque ou desmarque e salve: as mudanças ficam destacadas, as permissões sensíveis têm aviso e cada perfil pode voltar ao <b>padrão</b>. Toda mudança vai para a auditoria. A administração nunca perde o acesso a esta tela. O <b>escopo</b> de cada perfil (setor, secretaria ou município) não muda aqui.</p>
<h3>Secretarias, serviços e localidades</h3>
${figura('20-config-servicos', 'Catálogo de secretarias e serviços.')}
<p>Cada serviço pertence a um setor e tem prazo e palavras-chave. Quanto melhores as palavras-chave, melhor a sugestão automática ao cidadão. Inclua todas as comunidades rurais em <b>Localidades</b> para que apareçam no registro e no mapa.</p>
<h3>Auditoria</h3>
${figura('19-config-auditoria', 'Auditoria com verificação da cadeia.')}
<p>Cada registro guarda quem fez, o quê, quando e sobre qual item, além do hash do registro anterior. O botão de verificação confere a cadeia inteira e aponta qualquer registro alterado ou removido. Visualizações de dados pessoais também são registradas.</p>
`);

const P = {
  'Ver a fila de solicitações': [1, 1, 1, 1, 1, 1],
  'Registrar atendimento assistido': [1, 0, 0, 0, 0, 0],
  'Triar e encaminhar': [1, 0, 1, 1, 0, 0],
  'Executar e concluir': [0, 1, 1, 1, 0, 0],
  'Definir responsável': [0, 0, 1, 1, 0, 0],
  'Ver dados pessoais do cidadão ⚠': [1, 0, 1, 1, 0, 0],
  'Painel de indicadores': [0, 0, 1, 1, 1, 1],
  'Relatórios': [0, 0, 1, 1, 1, 0],
  'Tratar alertas': [0, 0, 1, 1, 1, 0],
  'Ver sugestões da IA': [1, 1, 1, 1, 1, 0],
  'Aceitar ou rejeitar a IA': [1, 0, 1, 1, 0, 0],
  'Equipe e perfis ⚠': [0, 0, 0, 0, 1, 0],
  'Secretarias, serviços e localidades': [0, 0, 0, 0, 1, 0],
  'Diagnóstico (linha de base)': [0, 0, 0, 0, 1, 0],
  'Backup e exportação completa ⚠': [0, 0, 0, 0, 1, 0],
  'Integrações (API) ⚠': [0, 0, 0, 0, 1, 0],
  'Privacidade (LGPD)': [0, 0, 0, 0, 1, 0],
  'Auditoria': [0, 0, 0, 0, 1, 1],
};
cap('perfis', 'Perfis e permissões', `
<p class="abre">São 7 perfis: o cidadão e 6 perfis da equipe. Cada perfil define o <b>escopo</b> (o que a pessoa enxerga) e um conjunto de <b>permissões</b> (o que ela pode fazer). As permissões abaixo são o padrão e podem ser ajustadas em <i>Quem pode o quê</i>; o escopo não.</p>
${tabela(['Perfil', 'Escopo', 'Resumo'], [
  ['Atendimento / triagem', 'Município', 'Recebe, classifica e encaminha; registra atendimento assistido.'],
  ['Equipe de campo', 'Setor', 'Executa e conclui as solicitações do setor.'],
  ['Gestor de setor', 'Setor', 'Distribui, acompanha e decide no setor; painel e relatórios.'],
  ['Gestor de secretaria', 'Secretaria', 'O mesmo do gestor de setor, para a secretaria inteira.'],
  ['Administração (SAD)', 'Município (sem dados pessoais)', 'Configura o sistema e acompanha o município de forma consolidada.'],
  ['Auditoria / controle interno', 'Município (sem dados pessoais)', 'Consulta auditoria, fila e indicadores, sem alterar nada.'],
])}
<h3>Escopo</h3>
<p>O escopo define <i>quais</i> solicitações cada pessoa enxerga: as do seu <b>setor</b>, da sua <b>secretaria</b> ou do <b>município</b> inteiro. Ele vem do perfil e é aplicado diretamente na consulta ao banco, então não há como “escapar” dele pela interface.</p>
<h3>Permissões padrão</h3>
<table class="matriz"><thead><tr><th>Permissão</th><th>Atend.</th><th>Campo</th><th>Gest. setor</th><th>Gest. secr.</th><th>SAD</th><th>Auditor</th></tr></thead><tbody>
${Object.entries(P).map(([k, v]) => `<tr><td>${k.replace(' ⚠', ' <span class="sens">sensível</span>')}</td>${v.map((x) => `<td class="c">${x ? '<span class="sim">●</span>' : '<span class="nao">–</span>'}</td>`).join('')}</tr>`).join('')}
</tbody></table>
${nota('Importante.', 'A verificação de permissão e de escopo é feita na API, não apenas escondendo botões. Quem não tem a permissão recebe erro mesmo chamando a API diretamente.')}
`);

cap('seguranca', 'Segurança e LGPD', `
<h3>Segurança</h3>
<ul class="lista">
<li><b>Senhas</b> guardadas com <i>scrypt</i> (nunca em texto). Senha mínima de 8 caracteres e troca obrigatória no primeiro acesso.</li>
<li><b>Sessão</b> em cookie <i>HttpOnly</i>, com token CSRF em toda alteração. Em produção o cookie só trafega por HTTPS.</li>
<li><b>Cabeçalhos de segurança</b>, incluindo política de conteúdo (CSP) e política de referência. Os únicos endereços externos liberados são o servidor de mapas e o VLibras (vlibras.gov.br e o repositório oficial dele no jsDelivr), usado só quando a pessoa liga o tradutor. O microfone só pode ser usado pelo próprio site.</li>
<li><b>Limite de tentativas</b> no login, no cadastro e nos pedidos de senha.</li>
<li><b>Anexos validados</b> pela assinatura do arquivo, não pela extensão. PDF protegido por senha é recusado.</li>
<li><b>Primeiro administrador</b> criado só com o código de instalação mostrado no terminal do servidor.</li>
<li><b>Auditoria encadeada</b> por hash, com verificação de integridade.</li>
</ul>
<h3>Proteção de dados pessoais (LGPD)</h3>
<ul class="lista">
<li><b>Minimização:</b> cada perfil vê só o necessário. A SAD e a auditoria não veem dados pessoais; quem vê tem cada visualização registrada.</li>
<li><b>O cidadão nunca vê</b> anotações internas nem o nome dos servidores.</li>
<li><b>Registro anônimo</b> disponível para quem preferir.</li>
<li><b>Retenção:</b> os dados pessoais do solicitante são anonimizados automaticamente depois de um período da conclusão (padrão de 365 dias, configurável).</li>
<li><b>Direitos do titular:</b> quem tem conta baixa os próprios dados e pode excluir a conta.</li>
<li><b>IA externa</b> (opcional) recebe só texto pseudonimizado. Com a IA local, nenhum dado sai do servidor.</li>
<li><b>Dados abertos</b> sem dados pessoais e com supressão de grupos pequenos (padrão: menos de 5 casos).</li>
</ul>
`);

cap('instalacao', 'Instalação e operação', `
<h3>Requisitos</h3>
<p><b>Node.js 22.13 ou mais novo.</b> Não precisa de Docker nem de servidor de banco: o SQLite já vem embutido no Node. Em produção, coloque o sistema atrás de HTTPS (Caddy, Nginx ou similar).</p>
${nota('No PowerShell do Windows,', 'use <code>npm.cmd</code> no lugar de <code>npm</code> se aparecer erro de política de execução de scripts.')}
<h3>Rodar para conhecer (demonstração)</h3>
<pre>npm install
npm run dev</pre>
<p>Abra <code>http://localhost:5173</code>. Na primeira execução é criado o banco <code>dados/sertania.db</code> com cerca de 220 solicitações fictícias. As contas de demonstração estão no Anexo A.</p>
<h3>Implantação na prefeitura (banco limpo)</h3>
${passos([
  '<b>Instalar e compilar:</b> <code>npm install</code> e <code>npm run build</code>.',
  '<b>Criar o banco vazio:</b> <code>npm run iniciar:prod -- --limpo</code>. Ele nasce com o mínimo: a SAD com o setor “Protocolo Geral”, o serviço “Outro assunto / não sei o setor”, sede e distritos e os feriados nacionais e de PE. Com <code>--modelo</code>, vem também um catálogo modelo de 7 secretarias e 15 serviços para ajustar.',
  '<b>Subir:</b> <code>npm start</code> (porta 3000). Como ainda não há administrador, o terminal mostra um <b>código de instalação</b>.',
  '<b>Primeiro acesso:</b> abra o endereço no navegador e informe o código, nome, e-mail e senha de quem vai administrar. O código vale uma vez e muda a cada reinício.',
  '<b>Primeiros passos:</b> secretarias e setores; serviços com prazo e palavras-chave; localidades e feriados municipais; servidores; linha de base do diagnóstico.',
  '<b>Teste ponta a ponta:</b> registre uma solicitação de teste, percorra o fluxo até a avaliação e só então divulgue o endereço.',
])}
<h3>Configuração (<code>.env</code>)</h3>
${tabela(['Variável', 'Padrão', 'Para que serve'], [
  ['<code>PORTA</code>', '3000', 'Porta do servidor.'],
  ['<code>PASTA_DADOS</code>', '<code>./dados</code>', 'Banco, anexos e backups.'],
  ['<code>MODO_INICIAL</code>', '<code>demonstracao</code>', 'Conteúdo criado quando o banco não existe: demonstracao, modelo ou limpo.'],
  ['<code>IA_PROVEDOR</code>', '<code>local</code>', '<code>local</code> (nada sai do servidor) ou <code>claude</code>.'],
  ['<code>ANTHROPIC_API_KEY</code>', '—', 'Necessária só com <code>IA_PROVEDOR=claude</code>. O limite de gasto fica em Configurações › Consumo da IA.'],
  ['<code>RETENCAO_DIAS</code>', '365', 'Dias após a conclusão para anonimizar os dados do solicitante.'],
  ['<code>LIMIAR_SUPRESSAO</code>', '5', 'Mínimo de casos para mostrar um grupo nos dados abertos.'],
  ['<code>MAPA_TILES</code>', 'OpenStreetMap', 'Endereço do servidor de mapas (modelo Leaflet).'],
  ['<code>MAPA_ATRIBUICAO</code>', '© OpenStreetMap', 'Crédito exibido no mapa.'],
  ['<code>NODE_ENV</code>', '—', 'Use <code>production</code> em produção (cookie só por HTTPS).'],
])}
<p>Os parâmetros principais também podem ir na linha de comando, por exemplo: <code>node dist/server/server/index.js --porta=8080 --dados=D:/sertania --modo-inicial=limpo</code>.</p>
<h3>Rotinas automáticas</h3>
<ul class="lista">
<li>A cada 5 minutos: recálculo dos alertas.</li>
<li>Diariamente: anonimização das solicitações vencidas na retenção e <b>backup</b> em <code>dados/backups</code>. Ambas ficam na auditoria.</li>
</ul>
${nota('Backup fora do servidor.', 'Copie a pasta <code>dados/backups</code> regularmente para outro local. Para um backup na hora: <code>npm run backup:prod</code>.', 'aviso')}
<h3>Comandos</h3>
${tabela(['Comando', 'O que faz'], [
  ['<code>npm run dev</code>', 'Desenvolvimento: API e interface com recarga automática (porta 5173).'],
  ['<code>npm run build</code> / <code>npm start</code>', 'Compila e sobe a versão de produção.'],
  ['<code>npm run iniciar -- --demonstracao --recriar</code>', 'Apaga e recria o banco de demonstração.'],
  ['<code>npm run iniciar:prod -- --limpo</code>', 'Cria o banco vazio na versão de produção.'],
  ['<code>npm run backup</code> / <code>backup:prod</code>', 'Backup manual do banco.'],
  ['<code>npm test</code> / <code>npm run typecheck</code>', 'Roda os 35 testes / verifica os tipos do código.'],
  ['<code>npm run documentacao:pdf</code> / <code>apresentacao:*</code>', 'Gera este manual / refaz capturas, PDF de apresentação e vídeo.'],
], 'compacta')}
`);

cap('integracao', 'Integração (API)', `
<p class="abre">O sistema expõe uma API REST documentada em <b>OpenAPI 3.1</b>, em <code>/api/openapi.json</code>, com uma página explicativa em <b>Área da equipe › API</b>.</p>
<h3>Tokens de acesso</h3>
<p>Outros sistemas usam um <b>token</b> criado em <i>Configurações › Integrações</i>, enviado no cabeçalho <code>Authorization: Bearer &lt;token&gt;</code>. O token aparece uma única vez e pode ser revogado a qualquer momento. Cada token tem escopos:</p>
${tabela(['Escopo', 'Permite'], [
  ['<code>demandas:ler</code>', 'Consultar solicitações (sem dados pessoais).'],
  ['<code>demandas:criar</code>', 'Registrar solicitações vindas de outro canal.'],
  ['<code>indicadores:ler</code>', 'Consultar os indicadores agregados.'],
])}
<h3>Grupos de rotas</h3>
${tabela(['Prefixo', 'Uso'], [
  ['<code>/api/publico</code>', 'Portal do cidadão: catálogo, registro, sugestão de serviço, acompanhamento, resposta, avaliação, transparência e dados abertos.'],
  ['<code>/api/auth</code>', 'Login, cadastro, troca de senha, pedido de nova senha, perfil e dados do titular.'],
  ['<code>/api/cidadao</code>', 'Solicitações de quem tem conta.'],
  ['<code>/api/gestao</code>', 'Fila, detalhe, comandos, atribuição, anotações, IA, alertas, indicadores, mapa, relatórios e exportação.'],
  ['<code>/api/admin</code>', 'Equipe, perfis, parâmetros, catálogo, diagnóstico, auditoria, backup, tokens e privacidade.'],
  ['<code>/api/integracao/v1</code>', 'Rotas para outros sistemas, com token.'],
  ['<code>/api/configuracao</code>', 'Estado da instalação e primeiro acesso.'],
])}
<p>As mudanças de situação são feitas por <b>comandos de negócio</b> (<code>POST /api/gestao/demandas/:id/comandos/ENCAMINHAR</code>, por exemplo), nunca por uma alteração genérica de status. Cada comando é conferido contra a tabela única de regras. O registro aceita uma <b>chave de idempotência</b>: reenviar com a mesma chave não cria duplicata.</p>
`);

cap('tecnico', 'Arquitetura técnica', `
${tabela(['Camada', 'Tecnologia'], [
  ['Linguagem', 'TypeScript em todo o projeto (regras de domínio compartilhadas entre API e interface).'],
  ['API', 'Node.js 22.13+, Express 5, validação com zod.'],
  ['Banco', 'SQLite embutido (<code>node:sqlite</code>). Migração para Postgres possível sem mudar o domínio.'],
  ['Interface', 'React 19 com Vite, PWA com fila offline em IndexedDB, mapas com Leaflet, ícones lucide.'],
  ['IA', 'Local: classificador Naive Bayes, regras de risco, recorrência e alertas. Opcional: Claude (Anthropic).'],
  ['Testes', 'Vitest: 35 testes de domínio e de ponta a ponta pela API HTTP.'],
])}
<h3>Estrutura de pastas</h3>
<pre>src/shared/       regras de domínio, perfis, prazos
src/server/       API Express + SQLite
  ia/             IA local e provedor Claude opcional
  rotas/          público, conta, gestão, administração, integração
src/web/          interface React (Vite), PWA
test/             testes automatizados
ferramentas/      geradores da apresentação e deste manual</pre>
<h3>Identidade visual</h3>
<p>Verde da Prefeitura (<code>#11643a</code>) e amarelo do sol (<code>#f0b400</code>); títulos em <b>Zilla Slab</b>, que lembra os folhetos de cordel, e texto em <b>Atkinson Hyperlegible</b>, fonte desenhada para leitura fácil. As fontes vêm embutidas e funcionam sem internet. A marca é um sol de xilogravura nascendo atrás de um mandacaru.</p>
<h3>Limites conhecidos</h3>
<ul class="lista">
<li>O consumo da IA é medido em tokens; o valor em reais depende da tabela de preços da Anthropic, que o sistema não consulta.</li>
<li>O envio de WhatsApp, SMS e e-mail só funciona depois que a Prefeitura contratar os provedores e preencher o <code>.env</code>; o WhatsApp oficial exige modelos aprovados pela Meta.</li>
<li>Ainda não há antivírus nos anexos (pode ser adicionado como etapa de quarentena).</li>
<li>O SQLite atende o piloto; para alto volume, migrar para Postgres.</li>
<li>Os mapas públicos do OpenStreetMap têm limite de uso; em produção, use provedor próprio ou contratado.</li>
<li>Não há testes automatizados da interface.</li>
</ul>
`);

cap('anexos', 'Anexos', `
<h3>A. Contas de demonstração</h3>
<p>Disponíveis apenas no banco de demonstração. Senha de todas: <code>Sertania2026</code>.</p>
${tabela(['E-mail', 'Perfil'], [
  ['<code>cidadao@sertania.demo</code>', 'Cidadã com conta'],
  ['<code>atendimento@sertania.demo</code>', 'Atendimento / triagem'],
  ['<code>gestor.infra@sertania.demo</code>', 'Gestora da Secretaria de Infraestrutura'],
  ['<code>gestor.iluminacao@sertania.demo</code>', 'Gestor do setor de Iluminação'],
  ['<code>campo.iluminacao@sertania.demo</code>, <code>campo.vias@…</code>', 'Equipes de campo'],
  ['<code>gestor.saude@sertania.demo</code>', 'Gestora da Saúde'],
  ['<code>admin@sertania.demo</code>', 'Administração (SAD)'],
  ['<code>auditor@sertania.demo</code>', 'Controle interno'],
])}
<p>Para acompanhar sem conta: protocolo <code>SER-2026-000001</code>, código <code>DEMO01</code>.</p>
<h3>B. Glossário</h3>
${tabela(['Termo', 'Significado'], [
  ['Solicitação / demanda', 'Pedido registrado por um cidadão ou pela equipe.'],
  ['Protocolo', 'Número único da solicitação (SER-AAAA-NNNNNN).'],
  ['Código de acesso', '6 letras e números que, junto com o protocolo, permitem acompanhar sem conta.'],
  ['Escopo', 'Conjunto de solicitações que cada perfil enxerga: setor, secretaria ou município.'],
  ['Atendimento assistido', 'Registro feito pela equipe para quem procurou a prefeitura por outro canal.'],
  ['Recorrência', 'Várias solicitações parecidas no mesmo lugar, apontadas pela IA.'],
  ['Linha de base', 'Números reais do diagnóstico inicial, para comparar a evolução.'],
  ['SAD', 'Secretaria de Administração, que articula e configura o sistema.'],
  ['PWA', 'Site que pode ser instalado no celular e funciona com internet fraca.'],
])}
`);

// ------------------------------------------------------------------ documento
const CSS = `
@font-face { font-family: 'Zilla Slab'; font-weight: 600; src: url('${fonte('zilla-slab', 'zilla-slab-latin-600-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Zilla Slab'; font-weight: 700; src: url('${fonte('zilla-slab', 'zilla-slab-latin-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 400; src: url('${fonte('atkinson-hyperlegible', 'atkinson-hyperlegible-latin-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 700; src: url('${fonte('atkinson-hyperlegible', 'atkinson-hyperlegible-latin-700-normal.woff2')}') format('woff2'); }
:root { --verde: #11643a; --verde-forte: #0b4a2a; --verde-noite: #0b3a22; --verde-suave: #e2f1e7; --sol: #f0b400; --texto: #14211a; --texto-2: #4a5850; --texto-3: #6b776f; --borda: #d7ddd3; }
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
@page capa { margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: 'Atkinson Hyperlegible', system-ui, sans-serif; color: var(--texto); font-size: 10.5pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1, h2, h3 { font-family: 'Zilla Slab', Georgia, serif; line-height: 1.15; color: var(--verde-forte); }
h3 { font-size: 14pt; margin: 18pt 0 6pt; break-after: avoid; }
p { margin: 0 0 8pt; }
p.abre { font-size: 11.5pt; }
code { font-family: Consolas, 'Cascadia Mono', monospace; font-size: 9pt; background: #eef2ec; padding: 0 3px; border-radius: 3px; }
pre { font-family: Consolas, 'Cascadia Mono', monospace; font-size: 9pt; background: var(--verde-noite); color: #e8f5ec; padding: 10pt 12pt; border-radius: 6px; border-left: 5px solid var(--sol); white-space: pre; break-inside: avoid; }
.cordel { height: 10px; background: linear-gradient(135deg, var(--sol) 25%, transparent 25%) -5px 0 / 10px 10px, linear-gradient(225deg, var(--sol) 25%, transparent 25%) -5px 0 / 10px 10px, var(--verde); }
/* capa */
.capa { page: capa; width: 210mm; height: 297mm; position: relative; overflow: hidden; color: #fff; background: linear-gradient(150deg, var(--verde) 0%, var(--verde-forte) 55%, #072c19 100%); break-after: page; display: flex; flex-direction: column; }
.capa .conteudo { flex: 1; padding: 40mm 22mm 0; position: relative; z-index: 1; }
.capa .marca svg { width: 34mm; height: 34mm; filter: drop-shadow(3px 3px 0 rgba(0,0,0,.35)); }
.capa .tipo { margin-top: 18mm; font-size: 12pt; letter-spacing: .2em; text-transform: uppercase; color: var(--sol); font-weight: 700; }
.capa h1 { color: #fff; font-size: 44pt; margin: 4mm 0 6mm; }
.capa .sub { font-size: 15pt; max-width: 140mm; line-height: 1.4; opacity: .95; }
.capa .meta { position: absolute; left: 22mm; bottom: 22mm; font-size: 11pt; opacity: .9; line-height: 1.6; z-index: 1; }
.capa .sol { position: absolute; right: -50mm; bottom: -50mm; width: 170mm; height: 170mm; }
/* sumario */
.sumario { break-after: page; }
.sumario h2 { font-size: 26pt; margin: 0 0 4mm; }
.sumario ol { list-style: none; padding: 0; margin: 8mm 0 0; counter-reset: c; }
.sumario li { counter-increment: c; display: flex; align-items: baseline; gap: 10pt; padding: 8pt 0; border-bottom: 1px dashed var(--borda); font-size: 13pt; }
.sumario li::before { content: counter(c, decimal-leading-zero); font-family: 'Zilla Slab'; font-weight: 700; color: var(--sol); background: var(--verde-noite); border-radius: 4px; padding: 1pt 6pt; font-size: 11pt; }
.sumario a { color: var(--texto); text-decoration: none; }
.sumario .dica { color: var(--texto-2); }
/* capitulos */
section.cap { break-before: page; counter-increment: cap; }
section.cap:first-of-type { break-before: auto; }
.cab { display: flex; align-items: center; gap: 12pt; margin-bottom: 10pt; }
.cab .n { font-family: 'Zilla Slab'; font-weight: 700; font-size: 20pt; color: var(--sol); background: var(--verde-noite); border-radius: 6px; width: 34pt; height: 34pt; display: grid; place-items: center; box-shadow: 3px 3px 0 var(--sol); }
.cab h2 { font-size: 24pt; margin: 0; }
.cap > .cordel { margin-bottom: 14pt; border-radius: 2px; }
ul.lista { list-style: none; padding: 0; margin: 0 0 10pt; }
ul.lista li { position: relative; padding-left: 16pt; margin-bottom: 4pt; }
ul.lista li::before { content: ''; position: absolute; left: 2pt; top: 5.5pt; width: 6pt; height: 6pt; background: var(--sol); border: 1.5px solid var(--verde-forte); transform: rotate(45deg); }
ol.passos { list-style: none; padding: 0; margin: 0 0 10pt; counter-reset: p; }
ol.passos li { counter-increment: p; position: relative; padding: 0 0 6pt 26pt; break-inside: avoid; }
ol.passos li::before { content: counter(p); position: absolute; left: 0; top: 0; width: 18pt; height: 18pt; border-radius: 4px; background: var(--verde); color: #fff; font-family: 'Zilla Slab'; font-weight: 700; display: grid; place-items: center; font-size: 10pt; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt; font-size: 9.5pt; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; background: var(--verde-noite); color: #fff; font-weight: 700; padding: 5pt 7pt; }
td { padding: 5pt 7pt; border-bottom: 1px solid var(--borda); vertical-align: top; }
tbody tr:nth-child(even) td { background: #f6f8f4; }
table.compacta td { padding: 3.5pt 7pt; }
table.matriz th:not(:first-child) { text-align: center; font-size: 8.5pt; }
table.matriz td { padding: 3.5pt 7pt; }
table.matriz td.c { text-align: center; width: 11%; }
.sim { color: var(--verde); font-size: 12pt; }
.nao { color: #b8c2bb; }
.sens { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #8a5a00; background: #fff3cf; border: 1px solid #e6c870; border-radius: 3px; padding: 0 3pt; margin-left: 4pt; }
.nota { background: var(--verde-suave); border-left: 4px solid var(--verde); padding: 7pt 10pt; border-radius: 0 6px 6px 0; margin: 6pt 0 12pt; break-inside: avoid; }
.nota.aviso { background: #fff6dc; border-left-color: var(--sol); }
.nota strong { color: var(--verde-forte); }
figure { margin: 6pt 0 14pt; break-inside: avoid; }
.tela { border: 1.5px solid var(--texto); border-radius: 6px; overflow: hidden; box-shadow: 4px 4px 0 var(--verde-forte); }
.tela img { display: block; width: 100%; }
figure.media .tela, figure.media figcaption { width: 72%; margin-left: auto; margin-right: auto; }
figcaption { font-size: 8.5pt; color: var(--texto-3); margin-top: 5pt; }
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; }
.celulares { display: flex; gap: 18pt; justify-content: center; break-inside: avoid; }
.celulares figure { width: 46mm; }
.cel { border: 2px solid var(--texto); border-radius: 14px; overflow: hidden; box-shadow: 3px 3px 0 var(--verde-forte); height: 92mm; }
.cel img { width: 100%; display: block; }
`;

const SOL = `<svg class="sol" viewBox="-100 -100 200 200" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<path d="M-4 -66 L4 -66 L0 -96 Z" fill="#f0b400" opacity=".75" transform="rotate(${i * 15})"/>`).join('')}<circle r="56" fill="#f0b400"/></svg>`;
const capa = `<div class="capa"><div class="cordel"></div>${SOL}
<div class="conteudo"><div class="marca">${MARCA}</div>
<div class="tipo">Manual do sistema</div><h1>Sertânia Digital</h1>
<p class="sub">Guia do cidadão, da equipe e da administração, com instalação, segurança e integração.</p></div>
<div class="meta">Prefeitura Municipal de Sertânia – PE<br>Versão ${VERSAO} · ${DATA}</div></div>`;

const DICAS = {
  visao: 'o que é e para quem', conceitos: 'protocolo, situações, prazo e escopo', cidadao: 'registrar, acompanhar e avaliar', acessibilidade: 'voz, Libras, ditado, teclado e ajustes de tela',
  entrada: 'login, primeira senha e recuperação', equipe: 'Meu dia, fila, ações e IA', gestao: 'indicadores, mapa, alertas e relatórios', ia: 'local ou Claude, tokens, consumo e limite', avisos: 'WhatsApp, SMS, e-mail, pesquisa e resumo do mês',
  config: 'equipe, permissões, catálogo e auditoria', perfis: 'escopo e matriz de permissões', seguranca: 'proteções e direitos do titular',
  instalacao: 'implantação, .env, rotinas e comandos', integracao: 'tokens e rotas da API', tecnico: 'tecnologias, estrutura e limites', anexos: 'contas de demonstração e glossário',
};
const sumario = `<div class="sumario"><div class="cordel"></div><h2 style="margin-top:8mm">Sumário</h2>
<ol>${capitulos.map((c) => `<li><a href="#${c.id}"><b>${c.titulo}</b></a><span class="dica">— ${DICAS[c.id] ?? ''}</span></li>`).join('')}</ol></div>`;

const corpo = capitulos
  .map((c, i) => `<section class="cap" id="${c.id}"><div class="cab"><span class="n">${i + 1}</span><h2>${c.titulo}</h2></div><div class="cordel"></div>${c.corpo}</section>`)
  .join('\n');

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sertânia Digital — Manual do sistema</title><style>${CSS}</style></head><body>${capa}${sumario}${corpo}</body></html>`;
const arquivoHtml = path.join(SAIDA, 'documentacao.html');
fs.writeFileSync(arquivoHtml, html);

const rodape = `<div style="width:100%;font-family:Segoe UI,sans-serif;font-size:8px;color:#6b776f;padding:0 18mm;display:flex;justify-content:space-between">
<span>Sertânia Digital · Manual do sistema · v${VERSAO}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;

const nav = await abrirNavegador();
const page = await nav.newPage();
await page.goto(pathToFileURL(arquivoHtml).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const pdf = path.join(SAIDA, 'Sertania-Digital-documentacao.pdf');
await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: rodape, outline: true, tagged: true });
await nav.close();
console.log('PDF:', pdf, `(${(fs.statSync(pdf).size / 1024 / 1024).toFixed(1)} MB)`);
