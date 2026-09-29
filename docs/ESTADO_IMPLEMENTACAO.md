# Estado da implementacao

Escopo: especificacao "Plataforma municipal de Sertania", versao 1 de
28/09/2026. Este arquivo e a fonte da verdade sobre o que esta feito e, mais
importante, sobre o que NAO pode ser afirmado sem execucao.

Legenda:

- `[x]` implementado e coberto por teste que roda nesta maquina
- `[~]` implementado, sem teste automatizado ainda
- `[ ]` nao iniciado
- `[!]` bloqueado por dependencia externa

## Estado resumido

O backend executa de ponta a ponta contra a stack real. Um cidadao autenticado
abre uma solicitacao, recebe protocolo unico, repete a abertura sem duplicar,
avanca o estado por comandos de negocio e ve a linha do tempo sem notas internas.

**200 testes passando, typecheck estrito limpo nos dois pacotes.**

| Pacote | Testes | Arquivos | Resultado |
| --- | --- | --- | --- |
| `@sertania/contracts` | 109 | 5 | todos passando |
| `@sertania/api` (unitarios) | 73 | 4 | todos passando |
| `@sertania/api` (integracao, Postgres real) | 18 | 1 | todos passando |
| **Total** | **200** | **10** | **todos passando** |

## Ambiente verificado

| Recurso | Estado |
| --- | --- |
| Node.js | v26.5.0 |
| pnpm | 12.6.0 |
| Docker Desktop | 4.93.0, Engine 29.8.1 |
| WSL2 | `docker-desktop` rodando |
| PostgreSQL | 17.5 |
| PostGIS | 3.5, `geography(Point,4326)` verificado |
| Keycloak | 26.4, realm importando |
| Redis | 8.6, sessao e fila em instancias separadas |
| RustFS (S3) | 1.0.0, buckets privados com politica aplicada |
| ClamAV | 1.5.4, 28137 assinaturas, `PONG` no daemon |
| Mailpit | 1.31.3 |

Os 8 servicos estao `healthy`. A API sobe em `http://127.0.0.1:3000` e o
endpoint `/api/v1/health` consulta o banco de verdade, devolvendo `ok` apenas
quando o Postgres responde.

## Fluxo verificado de ponta a ponta

Executado por HTTP contra a API em execucao, com sessao real no Redis:

```
1) abrir:              HTTP 201 | protocolo=SER-2026-000395 | estado=SUBMITTED
2) repetir (mesma chave): HTTP 200 | mesmo protocolo | replay=true
3) listar:              HTTP 200 | total=1
4) detalhe:            HTTP 200 | 1 evento, sem nota interna
5) comando:            HTTP 200 | IN_REVIEW, versao 2
6) conflito de versao: HTTP 409
7) sem sessao:         HTTP 401
8) banco:              protocolo persistido, 2 eventos, 1 registro na outbox
```

O passo 2 e o criterio 2 da secao 20: repetir a abertura por falha de rede nao
cria duplicata. O passo 6 e o criterio 8: duas alteracoes simultaneas dao
conflito controlado, sem sobrescrita silenciosa.

## Schema do banco, verificado por consulta

Migracao `InitialSchema1730000000` aplicada e conferida:

- **31 tabelas de dominio**, 9 ENUMs, indice espacial **GiST** em
  `request_locations.point`
- Indice unico parcial em `requests.protocol` (apenas quando nao nulo, para
  varios rascunhos coexistirem)
- 8 restricoes CHECK em `requests`, incluindo conclusao exigindo resultado,
  rascunho sem protocolo, prioridade exigindo justificativa e atendimento
  assistido exigindo metodo de verificacao
- `chk_evaluations_rating_range`: nota entre 1 e 5
- **Nenhuma FK com `ON DELETE CASCADE`**: historico administrativo nao e
  apagado em cascata, conforme a secao 11
- Tabela `protocol_sequences` com reserva atomica por
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`

## Etapa 1 - Fundacao

- [x] Monorepo com pnpm workspaces
- [x] TypeScript estrito compartilhado
- [x] `.npmrc` e `pnpm-workspace.yaml` com lista revisada de builds autorizados
- [x] `.gitattributes` normalizando LF, `.gitignore`, `.env.example` (44 chaves)
- [x] Docker Compose local completo, 8 servicos, todos healthy
- [x] Migracao inicial aplicada e conferida
- [x] Validacao de ambiente que falha na inicializacao com segredo de
  demonstracao fora do local
- [x] Cabecalhos de seguranca (CSP, nosniff, frame-ancestors, referrer)
- [x] Filtro de erro que distingue dominio de infraestrutura
- [ ] ESLint e Prettier
- [ ] Pipeline de CI
- [ ] ADRs
- [ ] Modelo de ameacas
- [ ] Frontend React

## Etapa 2 - Identidade e catalogo

- [x] Tipos de perfis, acoes, vinculos e concessoes
- [x] Matriz de permissao por perfil
- [x] Motor de autorizacao com negacao por padrao, escopo e concessoes
- [x] Filtro de escopo para consultas, listas e contagens
- [x] Servico de sessao em Redis com cookie assinado
- [x] Token CSRF e conferencia de Origin
- [x] Revogacao de sessao individual e em lote
- [x] Contratos de servico, versao e politica de prazo
- [x] Calendario municipal em `America/Recife` com feriados e expediente
- [x] Relogio de prazo com pausas e politica congelada
- [x] Entidades de identidade, organizacao, vinculo e concessao
- [~] Cliente OIDC com Keycloak: **falta implementar** (roteas de login e
  callback ainda nao existem)
- [ ] Seeds de catalogo das tres secretarias
- [ ] Provisionamento do primeiro administrador institucional

## Etapa 3 - Atendimento completo

- [x] Protocolo em transacao por sequencia do banco, sem `MAX + 1`
- [x] Idempotencia de abertura com chave por usuario e operacao
- [x] Tabela explicita de transicoes, validada pelo backend
- [x] Controle de concorrencia por versao, com conflito 409
- [x] Eventos com informacao publica e interna separadas
- [x] Ciclo de atendimento, pausa de prazo e relogio de prazo
- [x] Politica de arquivos por assinatura de magic bytes
- [x] Cliente ClamAV com limites de tempo e tamanho
- [x] Cliente S3 com buckets privados e politica de bloqueio
- [x] Outbox transacional gravado na mesma transacao do pedido
- [x] Detalhe com linha do tempo filtrada por visibilidade
- [x] Conclusao exigindo resultado e justificativa publica
- [x] Entidades de solicitacao, conteudo, local, evento, mensagem, tarefa,
  ciclo, relacao e avaliacao
- [ ] Endpoint de upload e download autenticado de anexos
- [ ] Worker de notificacoes consumindo a outbox
- [ ] Mensagens cidadao-servidor
- [ ] Avaliacao de satisfacao
- [ ] Atendimento assistido no controller

## Etapa 4 - Gestao e territorio

- [x] Filtro de escopo para consultas agregadas
- [x] Limiar de supressao de grupos pequenos declarado
- [x] Ponto geografico com indice GiST e consulta por distancia real
- [ ] Atribuicoes, transferencias controladas e tarefas compartilhadas
- [ ] Indicadores com denominador e definicao
- [ ] Supressao complementar contra descoberta por subtracao
- [ ] Mapa operacional e alternativa textual
- [ ] Exportacoes assincronas

## Bugs reais encontrados e corrigidos durante a implementacao

Registrados porque cada um era um risco silencioso:

1. **Placeholders SQL trocados no `UPDATE` de workflow.** O `setClause`
   referenciava `$3` em diante, mas os parametros eram enviados a partir de
   `$1`. O estado seria gravado no campo errado. Corrigido deslocando os
   rotulos para `$5`+.

2. **`1 = 1` como clausula `SET`.** Quando nao havia campo derivado, gerava
   `SET "updated_at" = $2, 1 = 1`, que o Postgres recusa. Corrigido com
   clausula vazia e virgula condicional.

3. **Formato de retorno do TypeORM em escrita.** `UPDATE ... RETURNING`
   devolve `[rows, affectedCount]`, nao `rows`. Ler `resultado[0]` pegava o
   array interno e o `state` vinha `undefined` sem erro visivel. Descobrir isso
   exigiu um teste de integracao real, porque o typecheck passa.

4. **Erro de dominio virava 500.** O filtro de erro so reconhecia
   `HttpException`, entao conflito de versao aparecia como "erro do sistema"
   para o cidadao. Agora erro de dominio tem status 4xx previsivel.

5. **Assinatura S4 sem `Version` na politica IAM.** O RustFS recusava a
   politica de bloqueio do bucket com 400, deixando os buckets sem a protecao
   que o metodo existe para aplicar.

6. **`content-length` na assinatura S3.** Assinar esse cabecalho quebra a
   requisicao, porque o Node o recalcula ao escrever o corpo.

## O que ainda NAO tem evidencia de execucao

Nao declarar estes criterios como cumpridos:

- **Fluxo de login OIDC com navegador.** As rotas de inicio, callback e logout
  nao existem. As sessoes funcionam, mas sao criadas por injecao no Redis nos
  testes, nao por Keycloak.
- **Upload e download de anexos pelo endpoint autenticado.** A politica e o
  cliente de antivirus existem e estao testados, mas nao ha controller nem
  fluxo de quarentena ate liberacao.
- **Worker de notificacoes.** A outbox e gravada na transacao, mas nenhum
  processo consome a fila.
- **Indicadores e paineis.**
- **Frontend.** Nenhuma interface foi construida.
- **Acessibilidade, carga e restauracao.**

## Decisoes que precisam de validacao municipal

| Item | Valor em uso | Origem |
| --- | --- | --- |
| Formato de protocolo | `SER-AAAA-NNNNNN` | sugerido no item 6 |
| Cota de reabertura | 7 dias corridos | proposta demonstrativa |
| Limiar de supressao | 10 casos | valor inicial proposto |
| Anexos | 5 arquivos, 10 MB cada | limites iniciais propostos |
| Formatos aceitos | JPEG, PNG e PDF verificado | MVP do item 13 |
| Politica de prazo | 1 dia util de resposta, 5 dias uteis de conclusao | seed de demonstracao |
| Feriados | nenhum configurado | precisa do calendario oficial |
| Horarios de sessao | 20 min ocioso, 8 h absolutas | ajustar na homologacao |
| RPO e RTO | 24 h e 8 h | propostas do item 18 |

**A politica de prazo acima e de DEMONSTRACAO e nao e compromisso oficial.**
`is_published_commitment` esta `false` justamente para impedir que o sistema
trate configuracao tecnica como prazo legal.

## Pendente com a prefeitura

Nomes e competencias das unidades; catalogo definitivo; exigencias de
documentos; formas de identificacao e representacao; bases legais e retencao;
prazos e calendarios; criterios de prioridade e reabertura; acesso por funcao;
hospedagem e contratos; fornecedor de mapas e mensagens; metas de recuperacao;
canais de privacidade e incidentes.
