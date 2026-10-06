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

O backend executa contra a stack real. O **Marco A esta fechado** e o
**Marco B (login real com Keycloak) esta implementado e verificado no
navegador**, com uma ressalva importante na tabela abaixo.

**237 testes passando.**

| Pacote | Testes | Arquivos | Resultado |
| --- | --- | --- | --- |
| `@sertania/contracts` | 109 | 5 | passando |
| `@sertania/api` (unitarios) | 85 | 12 | passando |
| `@sertania/api` (integracao, Postgres real) | 43 | 3 | passando |
| **Total** | **237** | **20** | **passando** |

Gates: `pnpm lint` 0 problemas, `pnpm typecheck` 0 erros, `pnpm build` sem erro.

## Marco C - Interface

`apps/web` existe, com Vite, React e TypeScript no mesmo rigor da API. O fluxo do
cidadao e a primeira versao da area institucional foram construidos. A identidade
visual foi refeita para branco e verde, incluindo o tema de login do Keycloak.

### Verificado no navegador, com login real

| Passo | Evidencia |
| --- | --- |
| Tela de entrada | Duas entradas separadas, "Sou cidadao" e "Sou servidor" |
| Login real | Formulario do Keycloak aceitou `cidadao.a@exemplo.invalid` e `admin`; as sessoes de cidadao e servidor foram reconhecidas pela interface |
| Estado vazio | "Voce ainda nao tem nenhuma solicitacao", com atalho para abrir a primeira |
| Catalogo | As tres secretarias e os tres servicos vindos de `GET /catalog`, com o prazo em texto e o aviso de prazo simulado |
| Assistencia | Passos 1 a 4, escolha de servico, descricao com validacao minima, e revisao com secretaria, servico, prazo e descricao |
| Envio real | POST protegido por CSRF retornou 201 e protocolo `SER-2026-002064`; a lista e o detalhe retornaram o pedido sem nota interna |
| Operacao real | Login institucional abriu a fila; detalhe, atribuicao, SLA server-side, comando de agendamento e exibicao da previsao foram exercitados |
| Complementacao real | Pedido `SER-2026-002066` percorreu analise, pedido de informacao, mensagem cidadã e retorno para `IN_REVIEW`; a pausa persistida do SLA encerrou |
| Visual | Navegador renderizou a identidade branco/verde e os estados responsivos; modo escuro persistiu em `localStorage` |

### O que NAO esta verificado

- **CAPTCHA real em producao.** O ambiente local usa o bypass de desenvolvimento
  porque nao possui chaves Turnstile de producao.
- **Demonstracao automatizada com Playwright.** O smoke test foi executado no
  navegador interativo; ainda nao existe uma suite E2E Playwright versionada.

### Identificador institucional por e-mail

As contas de servidor agora entram com o e-mail como identificador visivel:

- `servidor.saude@exemplo.invalid` / `ServidorSaude!2026-demo`
- `servidor.infra@exemplo.invalid` / `ServidorInfra!2026-demo`
- `admin` / `admin` (gestor de demonstracao da Infraestrutura)
- `admin` / `admin` no realm cidadão (conta separada, somente como cidadão)

O Keycloak confirmou no navegador o campo "Nome de usuário ou e-mail". O realm
de servidores agora usa e-mail + senha, sem required action de autenticador
móvel. Contas demonstrativas têm `requiredActions=[]`; contas convidadas ficam
com `VERIFY_EMAIL` até confirmarem o endereço no primeiro login.
O administrador local não precisa de verificação adicional de e-mail.
O administrador local entra com `admin` / `admin`, mantém o e-mail verificado e
é aplicado por `infra/docker/keycloak/provisionar.mjs`. A mesma combinação é
provisionada no realm cidadão como outra identidade, sem vínculo ou permissão
institucional. Essas credenciais são exclusivas do ambiente demonstrativo local.

### Primeiro acesso de servidor

O administrador autenticado pode abrir `Cadastrar servidor`, informar o e-mail,
secretaria, unidade e perfil. A API cria a conta institucional desativada,
grava o vínculo municipal e envia um convite pelo SMTP configurado. O convite
leva à tela de criação de senha e mostra um QR para uma página de verificação
humana com Turnstile. A verificação libera um código de oito dígitos, com dez
minutos de validade e uso único. A senha é então registrada no Keycloak e a
conta é ativada com a required action `VERIFY_EMAIL`; o primeiro login envia a
 confirmação por e-mail e só depois libera a sessão institucional.

No desenvolvimento, quando as chaves Turnstile estão vazias, há um botão local
de teste. Em produção, o bypass não existe e `TURNSTILE_SECRET_KEY` é
obrigatória para validar o desafio no servidor.

### Navegação, acessibilidade e acesso gerencial

As áreas autenticadas de cidadão e servidor usam o menu de três barras. Ele
oferece a tela inicial e as configurações; a área institucional também mostra
fila, cadastro de servidores e dashboard conforme as capacidades devolvidas por
`/auth/me`. Configurações possuem os presets **Padrão**, **Alto contraste**,
**Texto ampliado**, **Menos movimento** e **Modo escuro**. O tema escuro também
fica disponível no cabeçalho e na entrada pública, com preferência salva no
navegador; sessão, tokens e dados autenticados continuam exclusivamente no
servidor.

O formulário de convite permite selecionar **Usuário operacional** ou
**Administrador com dashboards**. O segundo cria o papel central autorizado a
ler indicadores; a API não libera o dashboard apenas por esconder ou mostrar um
link. O e-mail do administrador master demonstrativo é configurável pelo
desenvolvedor em `KEYCLOAK_ADMIN_EMAIL` antes do provisionamento.

### Area institucional construida

`apps/web/src/telas/operacao.tsx` agora possui fila paginada, filtro por estado,
detalhe do pedido, seletor de contexto quando ha mais de um vinculo, historico
e confirmacao de comandos. Os comandos exibidos chegam de
`allowedCommandsFrom` no DTO do servidor; a autorizacao e a versao continuam
sendo conferidas pelo backend. Conflito de versao mostra mensagem para
recarregar, em vez de repetir uma acao com dados antigos. A fila e o detalhe
mostram o progresso do SLA, pausa, atraso, vencimento e momento da fotografia;
o percentual e calculado no servidor a partir da politica congelada e das
pausas persistidas, com atualização periódica na tela.

O ciclo seguinte acrescentou recursos de uso diário nos dois portais:

- o cidadão pode recuperar um rascunho da nova solicitação na mesma aba, filtrar
  o histórico, copiar ou compartilhar o protocolo e imprimir o comprovante;
  fotos continuam fora do armazenamento local e precisam ser escolhidas no envio;
- a operação possui visões rápidas de **Minha fila**, **Sem responsável** e
  **Urgentes**, atualização manual com horário da última leitura e exportação
  CSV da página autorizada;
- gestores podem selecionar vários pedidos visíveis e assumi-los em lote. Cada
  atribuição usa a versão otimista do pedido e a API revalida secretaria,
  unidade, vínculo ativo e permissão antes de atualizar o banco.

### Correcoes deste ciclo

- Foi criado `GET /api/v1/auth/csrf`, sem sessao publica, que devolve apenas o
  HMAC derivado do cookie HttpOnly. A mutacao continua exigindo sessao, Origin e
  token CSRF; a interface agora consegue enviar o primeiro pedido sem relaxar
  a proteção.
- O cookie de sessao usava `maxAge` em segundos, embora Express espere
  milissegundos. Ele expirava em 28,8 segundos. Agora dura oito horas, alinhado
  ao TTL absoluto configurado.
- Lista, fila e detalhe passaram a receber nome do servico, secretaria, estado
  em linguagem simples, data e comandos legais do backend.
- A resposta de complementacao usa `PROVIDE_INFORMATION`, retorna ao estado
  anterior registrado, marca a solicitacao como respondida e encerra a pausa de
  SLA persistida.
- O cancelamento durante `WAITING_CITIZEN` encerra a pausa aberta e marca a
  solicitacao de informacao como `CANCELLED`, sem deixar relogio ou pendencia
  aberta no banco.
- A negativa de reabertura registra a decisao sem substituir o resultado e a
  justificativa da conclusao original; a aprovacao abre um novo ciclo.
- `SCHEDULE` exige data futura, persiste a diferenca entre previsao e
  agendamento efetivo e exibe a informacao no portal do cidadao e na operacao.
- Conclusoes exibem ao cidadao o resultado traduzido, e comandos que exigem
  justificativa nao podem ser confirmados com texto vazio.
- A lista cidadã tem teste de contrato do controller garantindo que cada item
  recebe a fotografia SLA calculada no servidor, incluindo vencimento, consumo,
  compromisso publicado e instante `asOf`.
- A CLI de migration carrega o `.env` da raiz quando executada diretamente,
  sem depender apenas do script de inicializacao.

### Bugs encontrados construindo a interface

1. **A API devolvia `{ items, total, limit, offset }` e a interface esperava um
   array.** A tela quebrava com `pedidos.map is not a function` depois de um
   login bem-sucedido. Nao apareceria em teste de API, porque a resposta estava
   certa: quem estava errado era quem esperava outra coisa.
2. **O redirecionamento pos-login duplicava a regra de rotas.** A API mandava
   para `/minhas-solicitacoes`, caminho que so a interface devia conhecer, e a
   tela ficava em branco. Agora a API manda para a raiz da interface, que le
   `/me` e escolhe a rota.

### Lacuna de schema encontrada

A especificacao diz que "cada versao de servico referencia uma politica com
prazo de primeira resposta humana, prazo de conclusao, calendario, unidade de
contagem e regra de pausa". O esquema inicial **nao tinha essa coluna**, e sem
ela a interface nao tem como saber qual prazo mostrar.

Corrigido com a migration `1730000001000-LinkSlaPolicyToServiceVersion`, que
adiciona `service_versions.sla_policy_id` em tres etapas: coluna anulavel,
preenchimento, e so entao `NOT NULL` com a chave estrangeira `ON DELETE
RESTRICT`. A migration **recusa rodar** quando existe versao sem politica e nao
ha politica publicada, com mensagem que diz o que fazer. Isso aconteceu de
verdade: ela barrou a primeira execucao por causa de um servico residuo de um
teste antigo.

### Dados de demonstracao

`infra/docker/seed/seed-dev.mjs` cria as tres secretarias, um servico em cada
uma, unidade, prazo, equipe, e vincula os servidores do Keycloak as suas
secretarias lendo o `subject` pela API de administracao.

Os tres casos sao escolhidos porque cada um exercita uma regra diferente:
Infraestrutura (classificacao publica) primeiro, Saude (RESTRICTED) para o caso
de acesso negado entre areas, e Educacao (exige representacao) para o caso de
menores.

O seed **reconcilia** em vez de apenas criar. A primeira versao pulava a
secretaria que ja existisse, e o resultado foi uma secretaria de Saude com nome
trocado, sem descricao e sem servico, que o script anunciava "ja existe" em toda
execucao seguinte. Um seed que nao converge para o que o arquivo declara deixa
de ser verdade sobre o ambiente.

## Banco de dados dedicado para os testes

Os testes de integracao rodavam contra o mesmo banco das demonstracoes locais e
apagavam o conteudo. Isso nao era risco teorico: ao verificar o problema, a
identidade do cidadao criada pelo login no navegador **nao existia mais**, e o
banco de trabalho tinha dois usuarios de teste residuais.

Resolvido na raiz, com tres pecas:

| Peca | Onde | O que faz |
| --- | --- | --- |
| provisionamento idempotente | `infra/docker/postgres/provisionar.mjs` | cria `sertania_test`, os papeis `sertania_test_migrator` e `sertania_test_app`, e as extensoes. Tem `--verificar` |
| configuracao propria | `.env.test`, a partir de `.env.test.example` | banco e credenciais do ambiente de teste, com prefixo `TEST_` para nao confundir com o `.env` |
| barreira no carregamento | `apps/api/test/support/carregar-env.ts` | recusa com erro explicito antes de abrir conexao |

**Evidencia de que a barreira funciona**, e nao so de que existe:

- `.env.test` apontado para o banco de trabalho: `exit=1`, mensagem dizendo que
  os testes apagam o banco, e **nenhuma conexao aberta**.
- `.env.test` removido: `exit=1` com a instrucao de copiar o exemplo.
- Execucao normal: 43 testes passando, banco de trabalho com as mesmas contagens
  antes e depois, e o banco de teste com as 36 tabelas da migration.

Os papeis de teste foram criados **sem nenhum privilegio**: `\du` mostra
`sertania_test_app` e `sertania_test_migrator` com a coluna de atributos vazia,
contra `sertania_app`, que tem `Superuser, Create role, Create DB, Replication,
Bypass RLS`.

### `pendencia-conta-superusuario`

Ao provisionar o banco de teste, o `\du` revelou que **`sertania_app` e
SUPERUSUARIO**, e o `.env` e o `docker-compose.yml` afirmavam o contrario em
comentarios. A causa: a imagem do Postgres cria `POSTGRES_USER` como superusuario
no bootstrap, e nao ha script que reduza o privilegio depois.

Os tres comentarios foram corrigidos para dizer a verdade, mas a conta continua
superusuario. Nao foi reduzida aqui porque a conta e dona das tabelas do banco de
trabalho: tira-lhe superusuario e `CREATEDB` exige conceder `USAGE`, `SELECT`,
`INSERT`, `UPDATE` e `DELETE` nas 31 tabelas e nas sequencias, e essa concessao
precisa ser verificada contra a aplicacao em execucao antes de trocar. O banco de
teste ja serve de referencia: e exatamente a estrutura de concessoes que o banco
de trabalho precisa receber.

**Nao se pode afirmar que a aplicacao roda sem superusuario.** Ela roda com ele.

## Marco B - Login real com Keycloak

### O que foi verificado no navegador, de verdade

Nao por fixture, nao por sessao injetada no Redis: um navegador de verdade,
o formulario de login do Keycloak, e o Keycloak de verdade.

| Passo | Evidencia |
| --- | --- |
| Inicio do login | `GET /api/v1/auth/login/cidadao` responde 302 para `http://localhost:8080/realms/sertania-ciudadanos/...` com `code_challenge_method=S256`, `state` e `nonce` |
| Autenticacao real | Formulario do Keycloak aceitou `cidadao.a@exemplo.invalid`, e o navegador voltou para `http://localhost:5173/minhas-solicitacoes` |
| Sessao criada | `GET /api/v1/auth/me` devolveu `{"authenticated":true,"isCitizen":true,"can":{"openRequest":true,...}}` |
| Identidade no banco | `external_identities` com `realm = sertania-ciudadanos`, `subject` do token, e **zero** `memberships` |
| Login institucional administrativo | Conta `admin` / `admin` aceita no realm `sertania-servidores`, com `requiredActions=[]` e vínculo de gestão |
| Excecao administrativa local | O administrador de demonstração não precisa verificar e-mail novamente; o vínculo `SECRETARY_MANAGER` está na Infraestrutura |
| Primeiro acesso | Convite SMTP, código único após Turnstile/QR, criação de senha e bloqueio na tela `Verificação de email` foram percorridos contra Mailpit e Keycloak |

O fluxo atual é deliberadamente o modo demonstrativo solicitado: e-mail + senha.
O antigo bloqueio de MFA/TOTP foi removido do realm de servidores e da validação
do callback para que a conta administrativa local possa entrar sem autenticador
móvel.

### O que NAO esta verificado

- **CAPTCHA real em produção.** O fluxo foi integrado ao Turnstile, mas o
  ambiente local usa o bypass de desenvolvimento porque não possui chaves de
  produção.

### Decisoes do marco

| Decisao | Motivo |
| --- | --- |
| Rotas separadas `/login/cidadao` e `/login/servidor` | O destino fica fixo na URL. Um parametro permitiria um link malicioso de trocar o tipo de acesso. |
| `state` e `nonce` guardados no servidor | Guardados no navegador, um atacante com acesso ao storage fabricaria o par. |
| `state` de uso unico | Reaproveitar um codigo interceptado trocaria a sessao de uma pessoa por outra. |
| Codigo trocado no servidor (BFF) | Os tokens ficam fora do JavaScript do navegador. |
| Vinculo institucional **nunca** nasce no login | Um servidor sem vinculo provisioned nao tem fila nenhuma. Cadastro publico so cria identidade de cidadao. |
| Sessao rotacionada na troca de contexto | E mudanca de privilegio: um identificador capturado antes nao vale depois. |
| Politica de segundo fator em `second-factor.ts`, nao no cliente OIDC | E regra de dominio, nao detalhe de biblioteca. E porque ela e testavel: `openid-client` e ESM puro e a suite unitaria roda em CommonJS. |
| Realm provisionado por script versionado | Configuracao feita no console nao e reproduzivel. `infra/docker/keycloak/provisionar.mjs` e idempotente e tem modo `--verificar`. |

### Cinco erros de producao encontrados neste marco

Nenhum deles apareceria em teste de unidade. Todos apareceram por executar o
caminho de verdade.

1. **Descoberta OIDC no realm errado.** A descoberta usava a URL base do
   servidor, que resolve para os metadados do realm `master` e para as contas
   de administracao do Keycloak. O emissor do realm precisa ser montado antes
   de qualquer chamada de rede.

2. **`redirect_uri` com a origem errada.** A URL de callback era montada com a
   origem do Keycloak, e a biblioteca deriva o `redirect_uri` da URL que recebe
   a troca. O provedor recusava com `invalid_grant: Incorrect redirect_uri`.
   Agora a origem vem da configuracao, nunca da requisicao: um `Host`
   adulterado assim nao define para onde o token e entregue.

3. **Login institucional recusado como `sessao_invalida`.** O callback
   determinava o realm por `request.query['realm']`, que o Keycloak nunca
   envia. Todo login de servidor era tratado como login de cidadao. O realm do
   fluxo vem do `state` guardado, que e a unica fonte confiavel.

4. **Falha sem log.** O `catch` do inicio do login redirecionava sem registrar
   nada: um erro de configuracao aparecia apenas como "login nao funciona".
   Agoram o log percorre a cadeia de `cause`, que e onde a biblioteca deixa a
   resposta real do provedor.

5. **Required action corrompido pela propria API.** Um `PUT` parcial em
   `/required-actions/CONFIGURE_TOTP`, sem o campo `alias`, zerou o alias. A
   partir dai a acao ficou inacessivel por GET, PUT e DELETE, porque toda a API
   a localiza pelo alias. Registros assim so saem junto com o realm. O script de
   provisionamento envia a representacao completa e detecta registro sem alias.

### Duas armadilhas de ambiente configuration

| Achado | Consequencia se nao corrigido |
| --- | --- |
| `SESSION_COOKIE_SECURE=false` chega ao `ConfigService` como a **string** `"false"`, que e truthy | A configuracao real ficava invertida sem nenhum aviso |
| Um cookie com prefixo `__Host-` e **descartado** pelo navegador se nao tiver `Secure` | O login "funciona", o navegador nao guarda o cookie, e a pessoa volta para a tela de entrada. O `Secure` passou a ser derivado do prefixo, e a variavel de ambiente nao pode mais desligar o que o navegador exige. |

O nome do cookie saiu do ambiente: o prefixo `__Host-` e uma regra do
navegador, e o mesmo nome precisa bater entre o guard (que le) e o controller
(que escreve). Uma variavel de meio valor seria pior que nenhuma.

## Duas falhas de producao encontradas no Marco A

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

## Marco B - Login real com Keycloak

- [ ] Cliente OIDC e rotas de login, callback, sessao e logout
- [ ] Rotas de inicio, callback, sessao atual e logout
- [x] Realms de cidadaos e servidores, com login institucional por e-mail e senha
- [ ] Resolucao de vinculo por `issuer + subject`
- [ ] Rotacao de sessao no login e revogacao
- [ ] Enderecos e cookies em desenvolvimento
- [x] Seeds idempotentes com cinco secretarias, unidades, servicos e perfis
      demonstrativos

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
- [x] Rotas OIDC: login de cidadao e de servidor, callback, `/me`, troca de
      contexto, logout local e logout do provedor

## Etapa 3 - Atendimento completo

- [x] Idempotencia de abertura sob concorrencia
- [x] Eventos com informacao publica e interna separadas
- [x] Ciclo de atendimento, pausa de prazo e relogio
- [x] Conclusao exigindo resultado e justificativa publica
- [x] Entidades de solicitacao, conteudo, local, evento, mensagem, tarefa,
      ciclo, relacao e avaliacao
- [~] Endpoint de upload e download autenticado de anexos: valida assinatura e
      extensao, recusa PDF cifrado, envia para quarentena, inspeciona com
      ClamAV, libera apenas arquivo limpo, aplica autorizacao e registra acesso
      auditavel. Falta ainda teste de integracao multipart ponta a ponta.
- [~] Worker de notificacoes consumindo a outbox: reserva eventos com
      `FOR UPDATE SKIP LOCKED`, envia e-mail fora da transacao, registra entrega,
      aplica retentativa com backoff e encerra apos cinco falhas. Falta teste
      com SMTP e Postgres reais.
- [~] Mensagens cidadao-servidor: conversa autenticada por solicitacao, corpo
      cifrado em aplicacao, visibilidade publica/interna e autorizacao por
      titular ou vinculo institucional. Falta teste de integracao HTTP real.
- [~] Avaliacao de satisfacao: uma nota de 1 a 5 por ciclo e autor, disponivel
      apos conclusao, com comentario opcional, autorizacao do titular e tela
      cidada. Falta teste de integracao HTTP real.

## O que ainda NAO tem evidencia de execucao

- **Politica de segundo fator em producao.** O ambiente demonstrativo local usa
  e-mail e senha para permitir o smoke test administrativo; a exigencia de MFA,
  caso seja adotada na homologacao, ainda precisa ser percorrida com um
  autenticador real e a configuracao municipal definitiva.
- **Reduzir o privilegio de `sertania_app`.** A conta de trabalho e
  SUPERUSUARIO, contrariando o que o compose e o `.env` afirmavam. Os
  comentarios foram corrigidos; a conta ainda nao. Ver
  `pendencia-conta-superusuario`.
- **Upload e download de anexos ponta a ponta.** O controller e o fluxo de
  quarentena ate liberacao ja existem; falta evidencia de teste multipart com
  a API e o armazenamento reais.
- **Worker de notificacoes ponta a ponta.** O processo separado e o consumidor
  ja existem; falta evidencia com SMTP e Postgres reais.
- **Indicadores e paineis avancados.** O dashboard agora tem indicadores por
  estado, secretaria, servico, prioridade e recentes, com filtro por escopo;
  ainda faltam mapas e exportacoes completos.
- **Frontend automatizado.** As areas cidada e institucional, mensagens,
  anexos, SLA, tema e acessibilidade existem; falta cobertura Playwright.
- **Acessibilidade, carga e restauracao.** Os presets visuais existem; faltam
  testes automatizados e ensaios operacionais.

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
