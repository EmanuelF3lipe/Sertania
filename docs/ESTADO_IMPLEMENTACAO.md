# Estado da implementacao

Escopo: especificacao "Plataforma municipal de Sertania", versao 1 de
28/09/2026, e o documento de continuacao de 29/09/2026.

Este arquivo e a fonte da verdade sobre o que esta feito e, mais importante,
sobre o que NAO pode ser afirmado sem execucao.

Legenda:

- `[x]` implementado e coberto por teste que roda nesta maquina
- `[~]` implementado, sem teste automatizado ainda
- `[ ]` nao iniciado
- `[!]` bloqueado por dependencia externa

## Resumo

O backend executa contra a stack real. O Marco A esta fechado: autorizacao
corrigida e testada pela cadeia HTTP, lint com regras de seguranca, suites
separadas, CI configurada, e concorrencia testada de verdade.

**204 testes passando.** Duas falhas de producao foram encontradas e corrigidas
neste ciclo, ambas invisiveis para os testes anteriores.

| Pacote | Testes | Arquivos | Resultado |
| --- | --- | --- | --- |
| `@sertania/contracts` | 109 | 5 | passando |
| `@sertania/api` (unitarios) | 55 | 4 | passando |
| `@sertania/api` (integracao, Postgres real) | 40 | 3 | passando |
| **Total** | **204** | **12** | **passando** |

Gates: `pnpm lint` 0 problemas, `pnpm typecheck` 0 erros, `pnpm build` sem erro.

## Duas falhas de producao encontradas neste ciclo

### 1. Qualquer cidadao autenticado podia executar comando de atendimento

O endpoint `POST /requests/{id}/commands/{command}` aceitava qualquer comando
de qualquer cidadao com sessao valida. Bastava `START_REVIEW`, `COMPLETE` ou
`CANCEL` em qualquer pedido.

A politica de autorizacao estava correta, com 30 testes passando. O controller
simplesmente nao a chamava. **Testar a regra isolada nao garante que ela seja
aplicada**; foi necessario um teste que passasse pela cadeia inteira.

Corrigido com `AuthorizationService`, que monta o sujeito a partir dos vinculos
reconsultados do banco, e um mapa fechado `comando -> acao`: comando ausente e
negado, e o alvo e lido do banco, nunca do corpo da requisicao.

### 2. Oito envios simultaneos com a mesma chave criavam sete pedidos

A idempotencia consultava a chave com `SELECT ... FOR UPDATE` e so depois
gravava. `FOR UPDATE` nao trava nada quando a linha ainda nao existe: oito
transacoes passaram todas pela consulta vazia, cada uma reservou um numero e
criou um pedido.

O criterio 2 da especificacao original, "repetir a mesma abertura por falha de
rede nao cria duplicata", era violado exatamente no caso que mais importa.

Corrigido com reserva atomica antes da leitura:
`INSERT ... ON CONFLICT DO NOTHING ... RETURNING` faz o banco decidir quem
cria a linha, e so o perdedor le a linha ja reservada, agora com `FOR UPDATE`
sobre algo que existe.

O teste sequencial antigo continuaria passando com o codigo quebrado. **Somente
transacoes simultaneas revelam o bug.**

## Marco A - Concluido

### A1 Reproducao, ferramentas e gates

- [x] Branch e versoes registradas: commit, Node v26.5.0, pnpm 12.6.0,
      Docker 29.8.1, 8 servicos `healthy`
- [x] Suites separadas: `test:unit` exclui integracao de forma explicita
- [x] Comandos: `typecheck`, `lint`, `build`, `test:unit`, `test:integration`,
      `test:e2e`, `verify`, `verify:full`
- [x] ESLint 9 flat config com regras de seguranca, nao esteticas
- [x] Prettier com `.prettierrc.json` e `.prettierignore`
- [x] CI em `.github/workflows/verificar.yml`, com portao estatico e portao de
      integracao que sobe Postgres, Redis e S3 e aplica migration
- [x] `pnpm install --frozen-lockfile` para instalacao reproduzivel

### A2 Autorizacao nos endpoints reais

- [x] `AuthorizationService` com vinculos reconsultados do banco
- [x] Mapa fechado `comando -> acao`, com comando ausente negado
- [x] Alvo lido do banco, nunca do payload
- [x] Fila institucional com escopo aplicado na SQL, incluindo contagem
- [x] Detalhe serve cidadao e servidor com DTOs distintos
- [x] Nota interna omitida do DTO do cidadao, e nao escondida
- [x] Negacoes registradas em `audit_events` com motivo interno
- [x] 15 testes de integracao cobrindo a cadeia controller, servico e politica

### A3 Repeticao e concorrencia

- [x] Mesma chave e mesmo conteudo em paralelo: um pedido, um protocolo
- [x] Mesma chave com conteudo diferente: conflito explicito
- [x] Contas diferentes com a mesma chave: isoladas
- [x] 15 aberturas simultaneas: 15 protocolos unicos e persistidos
- [x] Comandos concorrentes: um aplica, versao sobe uma vez, sem evento do
      perdedor
- [x] Falha no meio da transacao: sem estado parcial

## O que o lint encontrou que era bug real

| Problema | Consequencia se nao corrigido |
| --- | --- |
| `pg` devolve `timestamptz` como texto, e a politica chama `.getTime()` | Checagem de validade do vinculo quebrava em execucao, e um vinculo revogado **passaria** |
| `String(valor)` em variavel `unknown` | Validacao de ambiente aceitaria `[object Object]` como valor |
| `Membership` sem `teamIds` | Equipes habilitadas de Saude nao podiam ser verificadas |
| `AuthorizationTarget` rejeitando `undefined` explicito | Leitura de coluna anulavel quebrava ao compilar |
| `sign` do S3 `async` sem `await` | Chamador esperava promessa sem ganho |
| `isWeekend` como codigo morto | Falsa sensacao de que fim de semana era tratado |
| `zoneFormatter` pedindo `year` sem usar | Objeto `Intl` recriado com campo inutile |

## Wrapper de acesso a banco

`apps/api/src/database/typed-query.ts` resolve a causa raiz em vez de silenciar
os avisos. O `DataSource.query()` do TypeORM devolve `Promise<any>`, e com
`any` no meio da cadeia o compilador deixa de proteger o codigo depois do
banco.

Dois metodos com nomes distintos, porque o formato difere:

- `run` para SELECT: devolve lista de linhas
- `write` para UPDATE com RETURNING: devolve `[linhas, afetadas]`

Essa distincao e o que o documento de continuacao pediu explicitamente: nao
generalizar o formato de retorno de um metodo para todos. Foi a mistura dos
dois que produziu o `state` indefinido descrito adiante.

## Bugs anteriores, mantidos no registro

1. **Placeholders SQL trocados** no `UPDATE` de workflow: o `setClause`
   referenciava `$3` em diante, com parametros enviados a partir de `$1`. O
   estado seria gravado no campo errado.
2. **`1 = 1` como clausula `SET`**: gerava `SET "updated_at" = $2, 1 = 1`, que
   o Postgres recusa.
3. **`UPDATE ... RETURNING` devolvendo `[rows, affectedCount]`**: ler
   `resultado[0]` pegava o array interno e o `state` vinha `undefined` sem
   erro visivel. O typecheck passava limpo; so o teste de integracao real
   revelou.
4. **Erro de dominio virando 500**: o filtro so reconhecia `HttpException`, e
   conflito de versao aparecia como "erro do sistema" para o cidadao.
5. **Assinatura S4 sem `Version` na politica IAM**: o RustFS recusava a
   politica de bloqueio, deixando os buckets sem a protecao aplicada.
6. **`content-length` na assinatura S3**: quebrava a requisicao, porque o Node
   o recalcula ao escrever o corpo.

## Marco B - Login real com Keycloak (proximo)

- [ ] Cliente OIDC e rotas de login, callback, sessao e logout
- [ ] Rotas de inicio, callback, sessao atual e logout
- [ ] Realms de cidadaos e servidores, com MFA obrigatorio no institucional
- [ ] Resolucao de vinculo por `issuer + subject`
- [ ] Rotacao de sessao no login e revogacao
- [ ] Enderecos e cookies em desenvolvimento
- [ ] Seeds idempotentes com as tres secretarias e perfis demonstrativos

## Etapas 1 e 2 do plano original

- [x] Monorepo, TypeScript estrito, lockfile, `.env.example`
- [x] Docker Compose local completo, 8 servicos, todos `healthy`
- [x] Migracao inicial aplicada: 31 tabelas, 9 ENUMs, indice GiST, 8 CHECKs
- [x] Nenhuma FK com `ON DELETE CASCADE`
- [x] Tipos de dominio, matriz de permissao, motor de autorizacao
- [x] Servico de sessao em Redis, CSRF, conferencia de Origin, revogacao
- [x] Calendario em `America/Recife` com feriados e expediente
- [x] Protocolo em transacao por sequencia do banco
- [x] Tabela de transicoes, controle de concorrencia por versao
- [x] Outbox gravada na mesma transacao do pedido
- [x] Politica de arquivos por assinatura de magic bytes
- [ ] Rotas OIDC

## Etapa 3 - Atendimento completo

- [x] Idempotencia de abertura sob concorrencia
- [x] Eventos com informacao publica e interna separadas
- [x] Ciclo de atendimento, pausa de prazo e relogio
- [x] Conclusao exigindo resultado e justificativa publica
- [x] Entidades de solicitacao, conteudo, local, evento, mensagem, tarefa,
      ciclo, relacao e avaliacao
- [ ] Endpoint de upload e download autenticado de anexos
- [ ] Worker de notificacoes consumindo a outbox
- [ ] Mensagens cidadao-servidor
- [ ] Avaliacao de satisfacao

## O que ainda NAO tem evidencia de execucao

- **Login OIDC pelo navegador.** As sessoes funcionam, mas nos testes sao
  criadas por injecao no Redis. Isso e fixture, nao evidencia de login.
- **Upload e download de anexos pelo endpoint.** Politica e cliente de
  antivirus existem e estao testados; nao ha controller nem fluxo de
  quarentena ate liberacao.
- **Worker de notificacoes.** A outbox e gravada na transacao, mas nenhum
  processo consome a fila.
- **Indicadores e paineis.**
- **Frontend.** Nenhuma interface foi construida.
- **Acessibilidade, carga e restauracao.**

Nenhum destes deve ser declarado cumprido.

## Decisoes que precisam de validacao municipal

| Item | Valor em uso | Origem |
| --- | --- | --- |
| Formato de protocolo | `SER-AAAA-NNNNNN` | sugerido no item 6 |
| Cota de reabertura | 7 dias corridos | proposta demonstrativa |
| Limiar de supressao | 10 casos | valor inicial proposto |
| Anexos | 5 arquivos, 10 MB cada | limites iniciais propostos |
| Formatos aceitos | JPEG, PNG e PDF verificado | MVP do item 13 |
| Politica de prazo | 1 dia util e 5 dias uteis | seed de demonstracao |
| Feriados | nenhum configurado | precisa do calendario oficial |
| Horarios de sessao | 20 min ocioso, 8 h absolutas | ajustar na homologacao |
| RPO e RTO | 24 h e 8 h | propostas do item 18 |

**A politica de prazo e de DEMONSTRACAO e nao e compromisso oficial.**
`is_published_commitment` esta `false` para impedir que configuracao tecnica
vire prazo legal.

## Pendente com a prefeitura

Nomes e competencias das unidades; catalogo definitivo; exigencias de
documentos; formas de identificacao e representacao; bases legais e retencao;
prazos e calendarios; criterios de prioridade e reabertura; acesso por funcao;
hospedagem e contratos; fornecedor de mapas e mensagens; metas de recuperacao;
canais de privacidade e incidentes.
