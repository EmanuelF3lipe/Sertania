# Sertânia Digital

Plataforma web em **TypeScript** para o Desafio de Transformação Digital da Prefeitura de Sertânia/PE.
Ela registra demandas com protocolo, permite que o cidadão as acompanhe, encaminha cada uma ao setor com prazo e responsável, e gera indicadores, mapa e relatórios.
A IA apoia a triagem, a detecção de recorrências, os resumos, os relatórios e os alertas, sempre com supervisão humana.

> **Todos os dados que acompanham o sistema são de demonstração**: secretarias, serviços, prazos, coordenadas, comunidades marcadas “(exemplo)” e demandas.
> Não são estimativas oficiais. A linha de base real é registrada na aba **Administração → Diagnóstico**.

## Como rodar

Requisito: **Node.js 22.13 ou mais novo**, sem Docker nem banco externo. O SQLite já vem embutido no Node.

```powershell
npm install
npm run dev
```

Abra http://localhost:5173. Na primeira execução, a API cria `dados/sertania.db` e o preenche com cerca de 220 demandas fictícias.

| Conta (senha `Sertania2026`) | Perfil |
| --- | --- |
| `cidadao@sertania.demo` | Cidadã com conta |
| `atendimento@sertania.demo` | Atendimento / triagem (todas as secretarias) |
| `gestor.infra@sertania.demo` | Gestora da Secretaria de Infraestrutura |
| `gestor.iluminacao@sertania.demo` | Gestor do setor de Iluminação |
| `campo.iluminacao@sertania.demo` / `campo.vias@…` | Equipes de campo |
| `gestor.saude@sertania.demo` | Gestora da Saúde |
| `admin@sertania.demo` | Administração (SAD): visão consolidada e configuração |
| `auditor@sertania.demo` | Controle interno |

Para acompanhar uma demanda sem conta, use o protocolo `SER-2026-000001` com o código `DEMO01`.

Em produção:

```powershell
npm run build
npm start
```

Esse modo serve a API e a interface na porta 3000. Os outros comandos são:

- `npm test`: 37 testes, entre unitários e de ponta a ponta pela API HTTP.
- `npm run typecheck`: verificação de tipos.
- `npm run backup`: backup manual do banco (`npm run backup:prod` no build de produção).
- `npm run iniciar -- --demonstracao --recriar`: apaga e recria o banco de demonstração.

A configuração fica em `.env` (veja `.env.example`). Para usar o Claude na triagem e na redação de relatórios, defina `IA_PROVEDOR=claude` e `ANTHROPIC_API_KEY`. Sem isso, toda a IA roda localmente e nenhum dado sai do servidor.

## Implantação na prefeitura (banco limpo)

1. **Servidor.** Qualquer máquina ou VPS com Node 22.13 ou mais novo, atrás de HTTPS. Use um proxy como Caddy ou Nginx e defina `NODE_ENV=production`, para o cookie de sessão ser enviado só por HTTPS.
2. **Instalar e criar o banco vazio.**
   ```powershell
   npm install
   npm run build
   npm run iniciar -- --limpo
   ```
   O banco nasce só com o mínimo: a SAD com o setor “Protocolo Geral”, o serviço “Outro assunto / não sei o setor”, a sede e os distritos (coordenadas aproximadas) e os feriados nacionais e de PE. Com `--modelo`, ele já vem com um catálogo modelo de 7 secretarias e 15 serviços para ajustar, ainda sem pessoas nem demandas.
3. **Subir o sistema** com `npm start`. Como ainda não existe administrador, o terminal mostra um **código de instalação**, por exemplo `HTVCVMZK77`.
4. **Primeiro acesso.** Abra o endereço no navegador: a única tela disponível pede o código, o nome, o e-mail e a senha de quem vai administrar. Sem o código, que só aparece para quem tem acesso ao servidor, ninguém consegue se tornar administrador. Depois de usado, ele deixa de valer.
5. **Primeiros passos.** A tela “Meu dia” e **Configurações › Meus dados** mostram um roteiro com o andamento:
   1. secretarias e setores;
   2. serviços com prazo e palavras-chave;
   3. localidades (incluir as comunidades rurais) e feriados municipais;
   4. servidores;
   5. linha de base do diagnóstico.
6. **Servidores.** Em **Configurações › Equipe**, o administrador cadastra cada servidor com cargo e lotação (um ou mais setores ou secretarias). A senha inicial pode ser digitada ou gerada pelo sistema, e por padrão a pessoa é obrigada a criar a própria senha no primeiro login, antes de ver qualquer dado.
   - **Esqueci minha senha:** o servidor pede pela tela de login. O pedido aparece em destaque na lista da equipe, e o administrador gera uma senha provisória com um clique. A tela responde igual para e-mails que existem e que não existem, então não revela quem tem conta.
   - **Cargos e permissões:** em **Configurações › Cargos e permissões**, a Prefeitura cria, duplica, edita e exclui os próprios cargos. Cada cargo tem nome, descrição, alcance (setor, secretaria ou município todo) e permissões escolhidas por área, com busca e "selecionar todas". Os 6 perfis originais viram cargos iniciais editáveis. Toda mudança vai para a auditoria, um cargo só é excluído quando ninguém o ocupa, e o sistema nunca deixa a Prefeitura sem alguém ativo que administre a equipe.
   - **Organização:** nome do sistema, órgão, contatos, horário e um aviso para a página inicial, em **Configurações › Órgão**.
7. **Teste ponta a ponta e divulgação.** Registre uma solicitação de teste, percorra o fluxo até a avaliação e então divulgue o endereço. O cidadão **não precisa de conta**: basta o protocolo e o código de acesso.

Rotina: backup automático diário em `dados/backups` (copie a pasta para fora do servidor). Para gerar um na hora, use `npm run backup:prod`. Os parâmetros também podem ir na linha de comando: `node dist/server/server/index.js --porta=8080 --dados=D:/sertania --modo-inicial=limpo`.

## Identidade visual

- **Cores:**
  - o verde da Prefeitura (`#11643a`) como cor principal;
  - o amarelo do sol (`#f0b400`) para destaques e foco.

  O tema de noite tem tons próprios.
- **Letras:**
  - **Zilla Slab** nos títulos, que lembra os cartazes e folhetos de cordel;
  - **Atkinson Hyperlegible** no texto, uma fonte desenhada para leitura fácil.

  As duas vêm embutidas no app, funcionam sem internet e não dependem de serviços externos.
- **Marca:** sol de xilogravura nascendo atrás de um mandacaru.
- **Grafismos:**
  - faixa em zigue-zague de xilogravura;
  - cartões com sombra de carimbo;
  - selo de lotação inclinado, como carimbo de repartição.
- **Paisagem do portal:** sol, serra e mandacarus em xilogravura no topo da página inicial (`src/web/componentes/xilogravura.tsx`). É o único elemento ilustrado; o resto da interface fica sóbrio.
- **Regras de interface:**
  - listas com filetes em vez de grades de cartões;
  - ícones de traço no lugar de emojis;
  - texto em frase normal, sem rótulos em maiúsculas nem setas penduradas nos links;
  - passos numerados só onde há sequência de verdade (registro e andamento do pedido);
  - mensagens de erro e telas vazias dizem o que fazer.

Os tokens ficam em `src/web/estilos-base.css`.

## Avisos, pesquisa de satisfação e relatório mensal

Toda mudança de situação gera um aviso ao cidadão por WhatsApp, SMS e e-mail. Quando o pedido é concluído, ele recebe um link para dar a nota de 1 a 5 sem precisar do protocolo. Na primeira semana de cada mês, cada gestor de secretaria recebe por e-mail o resumo do mês anterior da sua pasta, e a administração recebe o do município.

- **Fila com novas tentativas:** as mensagens entram numa fila (tabela `mensagens`) e um trabalho em segundo plano envia a cada minuto. Se o provedor falha, tenta de novo em 5 min, 30 min, 2 h e 6 h.
- **Contato só na hora do envio:** a fila guarda o contato mascarado e busca o real na solicitação no momento de enviar. Se os dados já foram anonimizados (LGPD) ou o pedido é anônimo, a mensagem é cancelada.
- **Horário:** WhatsApp e SMS só saem entre 8h e 20h de Recife (ajustável). O e-mail sai na hora.
- **Provedores:** WhatsApp oficial da Meta, SMS pela Twilio, e-mail por SMTP, ou um webhook da Prefeitura (Zenvia, n8n etc.) para qualquer canal. As chaves ficam só no `.env`; veja `.env.example`.
- **Configurações › Avisos e mensagens:** mostra o estado de cada canal e permite:
  - enviar uma mensagem de teste;
  - escolher em que situações avisar;
  - ligar ou desligar a pesquisa e o relatório;
  - receber uma prévia do relatório;
  - ver e reenviar as últimas mensagens.

Antes da fila de envio existir, os avisos eram só registrados. Esses avisos antigos aparecem como “só registrada” e não são reenviados.

## Acessibilidade

Um botão redondo no canto de todas as telas (ou **Alt + 3**) abre o painel de acessibilidade. As escolhas ficam guardadas no aparelho.

- **Quem não enxerga:** funciona com leitores de tela, anuncia a troca de página e lê a página em voz alta ou o que for tocado ou focado, com legenda escrita.
- **Quem enxerga pouco:** três tamanhos de letra, alto contraste, modo escuro, tons de cinza, cursor grande, destaque de links e guia de leitura.
- **Quem não ouve:** tradutor de Libras VLibras, do Governo Federal. Ele só carrega quando a pessoa o liga.
- **Quem não pode digitar:** ditado por voz nos campos, com pontuação falada.
- **Quem não usa o mouse:** comandos de voz (incluindo "mostrar números" para clicar por número), atalhos de teclado no padrão eMAG e botões maiores.
- **Leitura e atenção:** fonte de leitura fácil, espaçamento maior e opção sem animações.
- **Atendimento sem o site:** a página `#/acessibilidade` mostra os contatos de atendimento da Prefeitura.

Ditado e comandos de voz dependem do reconhecimento de voz do navegador: funcionam no Chrome e no Edge, e no Chrome o áudio passa pelo serviço do Google. O código fica em `src/web/acessibilidade/`.

## Manual do sistema (PDF)

O manual completo fica em `documentacao/Sertania-Digital-documentacao.pdf` (A4, cerca de 30 páginas): guia do cidadão, da equipe e da administração, perfis e permissões, segurança e LGPD, instalação, configuração, API e arquitetura.
Para refazê-lo depois de mudar o sistema, rode `npm run documentacao:pdf`. As telas vêm de `apresentacao/capturas`, geradas por `npm run apresentacao:capturas`.

## Apresentação (PDF e vídeo)

Os arquivos ficam em `apresentacao/`:

- `Sertania-Digital-apresentacao.pdf`: 21 slides com as telas reais;
- `Sertania-Digital-apresentacao.mp4`: cerca de 3 minutos, 1280×720, navegando pelo sistema com legendas.

Para refazê-los, deixe `npm run dev` rodando e use:

```powershell
npm run apresentacao:capturas
npm run apresentacao:pdf
npm run apresentacao:video
```

Os scripts usam o Chrome instalado na máquina e, para o vídeo, o `ffmpeg` no PATH. Todas as telas mostram dados de demonstração.

## Área da equipe

Depois de entrar, servidores vão para a área da equipe (`#/equipe`):

- **Entrada:** paisagem do sertão e a pergunta “Como você quer entrar?”, com dois caminhos.
  - **Equipe:** login e “Perdi o acesso à minha senha”.
  - **Cidadão:** mostra primeiro que **não precisa de conta**, com botões para fazer e acompanhar pedidos. A conta é opcional.
- **Coluna de tinta** com seções Atender, Acompanhar, Ajustar e Portal público. Ela pode ser estreitada para ícones e vira gaveta no celular. Cada item só aparece com a permissão.
- **Barra da tela** com o título da página, o **carimbo de lotação** (secretaria e setor), leitura acessível, tema de dia ou de noite, o botão **?** com o *Guia da tela* em passos numerados, e o menu da conta.
- **Meu dia:**
  - termômetro com os números do escopo, cada um abrindo a fila filtrada;
  - **Na frente da fila**, com as 6 solicitações mais urgentes;
  - caminhos fixados;
  - “O que mudou”.
- **Configurações** com índice lateral:
  - **Você:** meus dados, senha e acesso, leitura.
  - **Prefeitura:** órgão, secretarias e serviços, localidades e feriados, linha de base.
  - **Pessoas e acesso:** a **Equipe** em crachás, com cadastro em gaveta lateral e pedidos de nova senha em destaque, e **Cargos e permissões**, com a lista de cargos, o editor e a comparação lado a lado.
  - **Dados e conformidade:** auditoria, backup, integrações e privacidade.

## Análise do repositório original

**O que foi aproveitado** (as ideias, adaptadas a uma base mais simples):

- **Fluxo por comandos de negócio** (`packages/contracts/src/workflow.ts`): o backend aceita comandos como `ENCAMINHAR` e `CONCLUIR`, nunca um PATCH genérico de status, e confere cada transição contra uma tabela única. Mantido em `src/shared/dominio.ts`.
- **Prazo em dias úteis** no fuso `America/Recife`, com feriados. A pausa vale só enquanto a demanda aguarda o cidadão, e o prazo não reinicia quando a demanda é transferida de setor (`src/shared/sla.ts`).
- **Protocolo** `SER-AAAA-NNNNNN` gerado em transação.
- **Idempotência**: reenviar com a mesma chave não cria duplicata. Isso é essencial para o envio offline.
- **Controle otimista por versão**: duas pessoas não sobrescrevem a ação uma da outra.
- **Anexos validados pela assinatura do arquivo**, não pela extensão. PDF protegido por senha é recusado.
- **Autorização na API, com escopo aplicado na consulta SQL.** O DTO do cidadão nunca contém nota interna, e o nome do servidor não aparece para ele.
- **Sessão em cookie HttpOnly com token CSRF.** O link de acompanhamento não depende de login.
- Linguagem simples para o cidadão, separada dos códigos internos.

**O que não serve para o resultado pedido:**

- **Infraestrutura pesada demais para o contexto do município.** São 8 serviços Docker: Keycloak, Postgres/PostGIS, 2 Redis, RustFS, ClamAV, Mailpit e outros. O projeto não sobe sem Docker e, nesta máquina, nem chegou a rodar. A nova versão roda com `npm install && npm run dev`. A troca do SQLite por Postgres continua possível sem mudar o domínio.
- **Faltavam capacidades centrais do desafio:**
  - mapa e georreferenciamento
  - IA (classificação, recorrência, resumos, alertas)
  - relatórios por período e localidade com exportação
  - dados abertos e transparência
  - modo offline e envio diferido
  - atendimento assistido por canal
  - módulo de diagnóstico (linha de base)
  - backup e exportação completa
  - API de integração com tokens e OpenAPI
- **Pendências registradas pelo próprio repositório:** conta de banco como superusuário, worker de notificações e upload sem teste de ponta a ponta, e nenhuma cobertura de frontend.
- **Complexidade sem retorno para o piloto**, como a dupla de realms do Keycloak e o fluxo de convite com Turnstile e QR. Pode ser reintroduzida depois, porque a autenticação está isolada em `src/server/auth.ts` e um provedor OIDC pode substituí-la.

## Requisitos do desafio → onde estão

| Capacidade pedida | Implementação |
| --- | --- |
| Registro digital, protocolo e acompanhamento | Formulário em 5 passos (`#/nova`). Protocolo e código de acesso, com acompanhamento sem login (`#/acompanhar`) e área “Minhas solicitações” para quem tem conta. Comprovante para imprimir ou compartilhar |
| Descrição, localização, imagens e documentos | Localidade (sede, distritos, comunidades), GPS, ponto no mapa, endereço e referência. Até 5 fotos ou PDFs, com compressão no aparelho |
| Classificação, encaminhamento, responsáveis e prazos | Fila com visões rápidas (triagem, minhas, sem responsável, urgentes, vencidas). Comando `ENCAMINHAR` (que permite reclassificar), atribuição restrita ao setor e prazo por serviço |
| Execução, impedimentos, evidências e conclusão | Comandos `AGENDAR`, `INICIAR_EXECUCAO`, `REGISTRAR_IMPEDIMENTO`, `SOLICITAR_INFO` (pausa o prazo) e `CONCLUIR` (exige resultado e justificativa). Registro de execução com fotos, que podem ser públicas ou internas. Reabertura cria um novo ciclo |
| Painéis com perfis e permissões | Cargos definidos pela Prefeitura, com alcance (setor, secretaria ou município) e permissões verificados na API; uma pessoa pode estar em vários setores ou secretarias. A SAD vê tudo sem dados pessoais, o que preserva a autonomia das secretarias |
| Indicadores e relatórios | Painel com os 8 indicadores do item 7, filtros por período, secretaria, setor, serviço, situação, localidade e canal. Exportação CSV/JSON, relatórios salvos e impressão em PDF |
| Georreferenciamento | Mapa (Leaflet + OpenStreetMap) por situação e prioridade, com focos de recorrência e posição aproximada quando não há ponto |
| IA com supervisão humana | Sugestão de serviço enquanto o cidadão escreve. Na triagem, classificação, prioridade e resumo com os botões Aceitar, Ajustar e Rejeitar, todos auditados. Detecção de recorrência, alertas (prazo vencendo ou vencido, recorrência, pico por localidade) e narrativa de relatório como rascunho até a revisão do gestor. O indicador de aceitação da IA mede a confiança no apoio automático |
| Integração por padrões abertos | REST com OpenAPI 3.1 (`/api/openapi.json`, página `#/api`). Tokens com escopos (`demandas:ler`, `demandas:criar`, `indicadores:ler`) que nunca entregam dados pessoais |
| Segurança, auditoria, backup e LGPD | Senhas em scrypt, CSRF, cabeçalhos de segurança (CSP), limite de tentativas e auditoria encadeada por hash com verificação de integridade. Backup diário e manual (`VACUUM INTO`), exportação completa em JSON, retenção com anonimização automática, minimização por perfil, IA externa só com texto pseudonimizado e dados abertos com supressão de grupos pequenos. O titular pode exportar e excluir seus dados |
| Território, conectividade e acessibilidade | Funciona como PWA e abre sem internet. Solicitações feitas offline ficam no aparelho e são enviadas quando o sinal volta, sem duplicar. Layout pensado primeiro para o celular, com linguagem simples e painel de acessibilidade (veja a seção Acessibilidade). Atendimento assistido por canal (presencial, telefone, WhatsApp, ouvidoria) |
| Diagnóstico e linha de base | Cadastro de indicadores reais com fonte e período. A validação exige uma segunda pessoa, e enquanto ela não acontece o painel avisa que os números não são oficiais |

## Estrutura

```
src/shared/       regras de domínio, perfis, prazos (usadas pela API e pela interface)
src/server/       API Express + SQLite (node:sqlite)
  ia/             IA local (Naive Bayes, regras de risco, recorrência, alertas) e provedor Claude opcional
  rotas/          público, conta/cidadão, gestão, administração e integração
src/web/          interface React (Vite), PWA, fila offline em IndexedDB
test/             testes de domínio e de ponta a ponta pela API HTTP
```

## Limites conhecidos

- O envio de WhatsApp, SMS e e-mail está pronto, mas só funciona depois que a Prefeitura contratar os provedores e preencher o `.env`. Sem isso, as mensagens ficam registradas como “sem canal configurado”. O WhatsApp oficial exige modelos de mensagem aprovados pela Meta.
- Os testes simulam os provedores (webhook local e chamadas à Twilio e à Meta interceptadas); nenhum envio real foi feito.
- Ainda não há inspeção antivírus dos anexos. O repositório original usava ClamAV, que pode ser religado como etapa de quarentena.
- O SQLite atende o piloto com tranquilidade. Para muitas secretarias com alto volume, o caminho é migrar para Postgres, mantendo o mesmo esquema.
- O fluxo foi verificado no navegador, mas não existe suíte automatizada de testes da interface (Playwright).
