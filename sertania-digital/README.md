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

- `npm test`: 19 testes, entre unitários e de ponta a ponta pela API HTTP.
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
5. **Primeiros passos.** A tela de Administração mostra um roteiro com o andamento:
   1. secretarias e setores;
   2. serviços com prazo e palavras-chave;
   3. localidades (incluir as comunidades rurais) e feriados municipais;
   4. servidores;
   5. linha de base do diagnóstico.
6. **Servidores.** O administrador cadastra cada servidor com perfil e lotação, e o sistema gera uma **senha provisória**. No primeiro login, a pessoa é obrigada a criar a própria senha antes de ver qualquer dado.
7. **Teste ponta a ponta e divulgação.** Registre uma solicitação de teste, percorra o fluxo até a avaliação e então divulgue o endereço. O cidadão **não precisa de conta**: basta o protocolo e o código de acesso.

Rotina: backup automático diário em `dados/backups` (copie a pasta para fora do servidor). Para gerar um na hora, use `npm run backup:prod`. Os parâmetros também podem ir na linha de comando: `node dist/server/server/index.js --porta=8080 --dados=D:/sertania --modo-inicial=limpo`.

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
| Painéis com perfis e permissões | 7 perfis com matriz de permissões e escopo (setor, secretaria ou município), verificados na API. A SAD vê tudo sem dados pessoais, o que preserva a autonomia das secretarias |
| Indicadores e relatórios | Painel com os 8 indicadores do item 7, filtros por período, secretaria, setor, serviço, situação, localidade e canal. Exportação CSV/JSON, relatórios salvos e impressão em PDF |
| Georreferenciamento | Mapa (Leaflet + OpenStreetMap) por situação e prioridade, com focos de recorrência e posição aproximada quando não há ponto |
| IA com supervisão humana | Sugestão de serviço enquanto o cidadão escreve. Na triagem, classificação, prioridade e resumo com os botões Aceitar, Ajustar e Rejeitar, todos auditados. Detecção de recorrência, alertas (prazo vencendo ou vencido, recorrência, pico por localidade) e narrativa de relatório como rascunho até a revisão do gestor. O indicador de aceitação da IA mede a confiança no apoio automático |
| Integração por padrões abertos | REST com OpenAPI 3.1 (`/api/openapi.json`, página `#/api`). Tokens com escopos (`demandas:ler`, `demandas:criar`, `indicadores:ler`) que nunca entregam dados pessoais |
| Segurança, auditoria, backup e LGPD | Senhas em scrypt, CSRF, cabeçalhos de segurança (CSP), limite de tentativas e auditoria encadeada por hash com verificação de integridade. Backup diário e manual (`VACUUM INTO`), exportação completa em JSON, retenção com anonimização automática, minimização por perfil, IA externa só com texto pseudonimizado e dados abertos com supressão de grupos pequenos. O titular pode exportar e excluir seus dados |
| Território, conectividade e acessibilidade | Funciona como PWA e abre sem internet. Solicitações feitas offline ficam no aparelho e são enviadas quando o sinal volta, sem duplicar. Layout pensado primeiro para o celular, com linguagem simples, texto maior, alto contraste, modo escuro e redução de movimento. Atendimento assistido por canal (presencial, telefone, WhatsApp, ouvidoria) |
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

- As notificações por SMS, WhatsApp e e-mail ficam registradas na tabela `notificacoes`, mas ainda não são enviadas. Falta plugar o provedor que o município escolher.
- Ainda não há inspeção antivírus dos anexos. O repositório original usava ClamAV, que pode ser religado como etapa de quarentena.
- O SQLite atende o piloto com tranquilidade. Para muitas secretarias com alto volume, o caminho é migrar para Postgres, mantendo o mesmo esquema.
- O fluxo foi verificado no navegador, mas não existe suíte automatizada de testes da interface (Playwright).
