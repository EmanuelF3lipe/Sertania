# Aprendizado

Registro do que foi aprendido errando, na ordem em que aconteceu. Nao e um
manual: sao as situacoes em que a solucao obvia estava errada, e o que a
tentativa ensinou.

A ideia e esta: quando algo quebra de um jeito que nao faz sentido, quase
sempre a causa esta em uma camada diferente da que o codigo sugere. Ler a
mensagem de erro com atencao economiza horas.

---

## 1. A entrada manual do TOTP do Keycloak devolveu erro interno

**Sintoma.**.Login de servidor parava em "Ocorreu um erro interno no servidor"
ao clicar em "Nao foi possivel ler o codigo QR?". O log do servidor trazia:

```
Caused by: freemarker.core.InvalidReferenceException: The following has evaluated to null or missing
  at org.keycloak.theme.freemarker.DefaultFreeMarkerProvider.processTemplate
```

**O que era.** Erro de template do tema do Keycloak 26.4. Nao havia o que
configurar do lado da aplicacao: faltava uma traducao na tela de entrada
manual.

**Aprendizado.** Um erro 500 do provedor com stack trace em `FreeMarker` e um
defeito do provedor, nao da sua integracao. Antes de procurar solucao na sua
configuracao, le a stack trace ate a biblioteca que falhou. Ativar
`internationalizationEnabled` no realm removeu o seletor de idioma do meio do
login, mas **nao** consertou a tela: o defeito continua la.

**O que ficou faltando.** Sem essa tela nao da para configurar o segundo fator
sem um aplicativo autenticador de verdade, entao o login institucional
completo continua sem prova de execucao. Isso esta registrado como pendencia
em `ESTADO_IMPLEMENTACAO.md`, e nao como funcionalidade pronta.

---

## 2. Um `PUT` parcial deixou um registro de required action inalcancavel

**Sintoma.** Depois de um `PUT /required-actions/CONFIGURE_TOTP` com apenas
`{defaultAction: true, priority: 10}`, a acao de TOTP sumiu da listagem sem
`alias`. `GET`, `PUT` e `DELETE` passaram a responder 404.

**O que era.** O `PUT` sobrescreveu `alias` com `null`. Toda a API do Keycloak
localiza um required action **pelo alias**, entao um registro com alias nulo e
invisivel para todas as tres operacoes. O unico jeito de limpar era apagar o
realm inteiro.

**Aprendizado.** Em uma API de atualizacao que substitui o recurso inteiro
(`PUT`), omitir um campo nao significa "manter o que estava": significa
"gravar vazio". Antes de atualizar, **leia o recurso e mande de volta a
representacao completa, acrescida da mudanca**. Uma representacao parcial em
`PUT` e um `PATCH` disfrazado, e o servidor nao avisa.

**Como ficou protegido.** `infra/docker/keycloak/provisionar.mjs` monta a
representacao inteira, e o modo `--verificar` detecta registro sem `alias` e
recusa em voz alta em vez de fingir que esta tudo bem.

---

## 3. `registrationEmailAsUsername` cria a conta com o e-mail como username

**Sintoma.** O script de provisionamento criou `cidadao.a`, e na listagem
aparecia `cidadao.a@exemplo.invalid`. Na execucao seguinte, o script tentou
criar de novo e recebeu `409 User exists with same email`. O `--verificar`
ficava vermelho mesmo com tudo no lugar.

**O que era.** Com `registrationEmailAsUsername: true`, o proprio Keycloak
grava o e-mail no campo `username`. O script procurava pelo username, nao
achava, e tentava recriar.

**Aprendizado.** Um 409 "ja existe" nao significa sempre "a busca por
identificador falhou". Vale a pena confirmar qual campo o servidor gravou, e
nao apenas o que voce mandou. E um script idempotente precisa de um criterio
de identidade que o servidor respeita: aqui, comparar **as duas colunas**.

**Como ficou protegido.** A busca passou a comparar `username` e `email`, e
`--verificar` passou a ser de fato idempotente.

---

## 4. O realm `master` e o lugar mais perigoso do Keycloak

**Sintoma.** O login redirecionava para a tela de erro. A causa estava a tres
campos de distancia: a descoberta OIDC usava `http://localhost:8080`, a URL
**do servidor**, em vez do emissor do realm.

**O que era.** A descoberta acontece em
`{emissor}/.well-known/openid-configuration`. Com a base do servidor, essa URL
resolve para os metadados do realm `master`, que e o realm de administracao. O
login teria funcionado **com as contas de administracao do Keycloak**.

**Aprendizado.** `issuer`, `audience` e `redirect_uri` nao sao enfeite: cada um
e uma ancora de comparacao. Um valor generico demais ancoreia no lugar errado e
o sistema continua funcionando, o que e o pior tipo de bug. Vale a pena
perguntar, para cada URL de configuracao: "qual e o valor mais especifico que
esta configuracao deveria ter?".

**Como ficou protegido.** `OidcService.issuerFor(realm)` monta o emissor do
realm antes de qualquer chamada de rede, e ha teste para isso.

---

## 5. A biblioteca deriva o `redirect_uri` da URL que recebe a troca

**Sintoma.** `invalid_grant: Incorrect redirect_uri`, com o login correto, o
estado correto e o codigo correto.

**O que era.** A URL de callback era montada assim:

```ts
new URL(request.originalUrl, this.oidcOrigin)   // oidcOrigin = Keycloak
```

O `redirect_uri` e extraido dessa URL, e a origem estava sendo a do Keycloak em
vez da da propria API.

**Aprendizado.** O detalhe que resolveu nao foi a URL errada, foi a **origem de
verdade**. Um caminho certo e um `Host` adulterado poderia definir para onde
um token seria entregue. A base passou a vir da configuracao, e o caminho
recebido e conferido contra o configurado. A moral: quando um valor de
seguranca vem de uma requisicao, a pergunta certa nao e "esta malformado?", e
"devo usar o valor da requisicao ou o que eu configurei?".

---

## 6. Parametro que o servidor nunca envia

**Sintoma.** Login de cidadao funcionava. Login de servidor caia sempre em
`sessao_invalida`.

**O que era.** O callback lia o realm do fluxo de `request.query['realm']`. O
Keycloak devolve `code`, `state`, `session_state` e `iss`. Nenhum `realm`. O
valor era sempre `undefined`, o fluxo era lido como "cidadao", e a comparacao
com o `state` guardado falhava.

**Aprendizado.** O que o provedor **de fato** manda importa mais do que o que
o seu codigo espera. Um parametro que nunca chega nao e um valor opcional: e um
valor que voce inventou. E o `state` guardado ja tinha a resposta certa, que e
justamente o que um `state` guarda.

---

## 7. `ConfigService` devolve texto, e a string `"false"` e verdadeira

**Sintoma.** `.env` com `SESSION_COOKIE_SECURE=false` produzia um cookie
`Secure`, o oposto do que estava escrito.

**O que era.** `config.get<boolean>('SESSION_COOKIE_SECURE')` nao converte nada.
O que volta e a **string** `"false"`, e em JavaScript string nao vazia e
truthy.

**Aprendizado.** `get<T>()` do `@nestjs/config` e um_ASSERT de tipo, nao uma
conversao: ele promete `boolean` e entrega `string`. Tipos genericos em leitura
de ambiente sao uma fonte silenciosa de bug. A leitura correta compara o texto.

**E o detalhe que quase passou.** Um cookie `__Host-` sem `Secure` e
**descartado pelo navegador, sem aviso**. O login "funciona", o navegador nao
guarda o cookie, e a pessoa volta para a tela de entrada na requisicao
seguinte. O sintoma aponta para o login, e a causa esta no navegador. Agora o
`Secure` e derivado do prefixo do nome do cookie, e a variavel de ambiente nao
consegue mais desligar o que o navegador exige.

---

## 8. Verificacao de teste que dava "0 erros" sem rodar o compilador

**Sintoma.** Achei 10 erros de TypeScript e o comando de verificacao/reportava
`erros TS: 0`.

**O que era.** O `tsc` escreve a saida colorida. O texto na tela e
`error` com codigo de cor, depois `TS2552`. Filtrar por `"error TS"` nao casa
com nada, porque existe um codigo de escape entre as duas palavras. O filtro
encontrava zero ocorrencias, e zero era um numero legitimo.

**Aprendizado.** Um verificador que filtra texto do console nao verifica nada:
ele verifica o quanto o filtro casou. Confirme o **codigo de saida** do
processo, e nao a contagem de linhas. Este foi o erro de metodo mais
perigoso do projeto, porque produziu uma afirmacao falsa com aparencia de
verificacao.

Regra que ficou: `exit=0` e a unica evidencia de que o compilador passou.

---

## 9. `openid-client` e ESM puro, e a suite unitaria roda em CommonJS

**Sintoma.** `SyntaxError: Cannot use import statement outside a module` ao
importar o servico OIDC num teste. A solucao ingenua e mapear um stub da
biblioteca.

**O que a solucao ingenua teria custado.** Um stub de `openid-client` faria o
teste passar sem exercitar a biblioteca real, e um substituto permanente
para uma dependencia de seguranca.

**Aprendizado.** Quando um teste nao roda, a pergunta nao e "como faco o teste
passar". E "o que neste arquivo e politica, e o que eodo da biblioteca?".

A politica de segundo fator ("isto prova segundo fator?") e regra de dominio:
a resposta nao muda se o provedor e o Keycloak. Ela foi para
`apps/api/src/auth/second-factor.ts`, ficou testavel de verdade, e continua
sendo a mesma regra. O mesmo raciocinio tirou a guarda de `state` para
`authorization-state.store.ts`: `state` de uso unico e a propriedade de
seguranca mais importante do login, e nao podia ficar num arquivo que nao da
para testar.

**A regra geral.** Um teste que precisa de um substituto para a dependencia
real, muitas vezes esta testando o lugar errado. Mover a regra para o arquivo
certo costuma ser menos trabalho e deixa mais honesto.

---

## 10. "Nome de usuario ou senha invalido" que nao era senha

**Sintoma.** Login de servidor recusado, com a senha vinda do script de
provisionamento.

**O que era.** Nao era a senha. O realm tem `bruteForceProtected`, e varias
tentativas erradas travam a conta por 15 minutos. A mensagem de login e a
mesma nos dois casos.

**Aprendizado.** Mensagem de erro igual para causas diferentes e uma
armadilha: ela leva a conclusao errada e faz perder tempo no lugar errado. Quando
"a senha esta certa" e o login falha, a proxima coisa a checar e o **estado da
conta**, nao o texto da senha. Vale ter um caminho na ferramenta para ver o
estado: `GET /admin/realms/{realm}/attack-detection/brute-force/users/{id}`.

**Detalhe que custou tempo.** O caminho de limpeza de bloqueio e
`/realms/{realm}/attack-detection/...`. Sem o segmento do realm, a requisicao
cai em outro recurso e responde **405**, que parece erro de metodo e nao de
endereco. `405` num caminho de administracao quase sempre e caminho errado.

---

## 11. Historico de senhas nao aparece na listagem de credenciais

**Sintoma.** O script de provisionamento falhava ao redefinir a senha de
demonstracao, com `must not be equal to any of last 3 passwords`.

**O que era.** O realm exige `passwordHistory(3)`, e o historico nao aparece
em `GET /users/{id}/credentials`. Nao ha como apagar pela API.

**Aprendizado.** Faca o simples: o script **nao redefine senha** em conta que
ja existe. Um script de provisionamento que troca senha a cada execucao seria
perigoso em um realm com contas reais, e aqui nem seria possivel. Vale a pena
perguntar, para cada operacao de um script: "esta operacao e idempotente? E
ela e segura num ambiente com dados reais?".

---

## 12. O frontend roda em `localhost`, e a API em `127.0.0.1`

**Aprendizado.** Trocar `localhost` por `127.0.0.1` (e o contrario) parece
um detalhe, mas muda tres coisas ao mesmo tempo: o dominio do cookie, o
`Origin` do CORS, e o `redirect_uri` comparado byte a byte pelo Keycloak. A
URL do navegador e a URL que o token vai percorrer tem de ser a mesma, e ela e
`localhost`. Nas configuracoes, `KEYCLOAK_URL` e `KEYCLOAK_REDIRECT_URI` sao
duas variaveis diferentes **de proposito**: a segunda e a URL da API, a primeira
e a do provedor.

---

## 13. Um teste de concorrencia que falhava "as vezes" estava errado, nao instavel

**Sintoma.** `dois comandos com a mesma versao esperada: um vence e o outro
recebe conflito` falhou com 1 de 40. O perdedor tinha recebido
`ILLEGAL_TRANSITION` em vez de `VersionConflictError`.

**O que era.** O teste clasificava os resultados por `status` da promessa:
`fulfilled` contava como "aplicou". Mas um comando recusado por estado responde
`ok: false` **e a promessa cumpre normalmente**. Entao o perdedor contava como
sucesso, e `concretizados` vinha com dois elementos.

Isso e um teste dependente de ordem: passa quando o perdedor acorda do lock e ve
a versao incrementada, falha quando acorda e le o estado novo. **Nenhuma das
duas respostas esta errada.** Depois que o vencedor moved `SUBMITTED ->
IN_REVIEW`, um segundo `START_REVIEW` e uma transicao invalida de verdade.

**Aprendizado.** Duas coisas, e a segunda e a mais importante.

1. Ao testar concorrencia, afirme o **invariante**, nao o caminho especifico.
   Aqui o invariante e: exatamente um aplicou, a versao subiu uma vez, e existe
   um evento. Quem ganhou o lock nao e o que esta em teste.

2. Um teste que falha em uma execucao e passa na seguinte **esta errado**, e a
   pergunta nao e "como deixo ele passar?". E "qual das duas respostas reais o
   meu codigo produz, e as duas sao aceitaveis?". Um teste de concorrencia que
   exige uma unica resposta posible esta medindo a sorte, nao o sistema.

O codigo de producao nao mudou. So o teste, que passou a descrever o
comportamento real.

**Cuidado com o outro lado.** Corrigir "teste instavel" mexendo no codigo de
producao para deixar o teste passar e o caminho errado. Aqui o codigo estava
certo desde o Marco A: `FOR UPDATE` mais a clausula de versao ja garantiam o
invariante. Os dois asserts que sempre passaram (`versao subiu uma vez`, `um
evento`) eram a prova de que nao havia bug.

---

## 14. Comentario que afirma o contrario do que o codigo faz

**Sintoma.** Ao provisionar o banco de teste, o `\du` mostrou:

```
sertania_app  Superuser, Create role, Create DB, Replication, Bypass RLS
```

O `.env` e o `docker-compose.yml` diziam, com todas as letras:

> `app` roda com synchronize:false, **sem superusuario** e sem ALTER.

**O que era.** A imagem do Postgres cria `POSTGRES_USER` como superusuario no
bootstrap do cluster. Nada depois disso reduz o privilegio. A configuracao nao
fazia o que o comentario dizia.

**Aprendizado.** Um comentario que descreve uma propriedade de seguranca e uma
**afirmacao verificavel**, e por isso mesmo a que mais precisa de conferencia. Nao
verifiquei porque o texto estava ali e parecia description, nao codigo.

Duas coisas a fazer quando se encontra um comentario assim: corrigir o comentario
imediatamente, mesmo que a situacao ainda nao esteja resolvida (um comentario
errado e pior que nenhum, porque desvia quem procura depois), e registrar a
pendencia com nome proprio.

O detalhe que e facil perder: **corrigir o comentario nao corrige o problema**.
Um arquivo que passou a dizer a verdade sobre um superusuario continua sendo um
arquivo com um superusuario. Por isso a pendencia ficou nomeada e listada, e nao
apenas anotada no comentario.

Vale notar como isso foi encontrado: nao por revisao, e por `\`du\`, um comando
que ninguem pensou em rodar porque o problema nao era o banco de teste. Ver o
proximo item.

---

## 15. Ferramenta de linha de comando antes de procurar no codigo

**O que aconteceu.** A tarefa era criar um banco de teste. O caminho obvio era
escrever o script, rodar os testes e seguir. Rodei `\du` por curiosidade, para
conferir os papeis que o script tinha criado.

Apareceu o superusuario acima, que nao tinha nada a ver com a tarefa.

**Aprendizado.** Quando um comando de verificacao devolve um estado, ele nao
responde so a pergunta que voce fez. `\du` perguntava "os papeis de teste existem?",
e respondeu tambem "a conta de trabalho tem privilegios que ninguem pediu".

O habito que ajuda: depois de qualquer comando que mostre estado, le a saida
inteira, e nao so a linha que voce esperava. Saida de ferramenta e barata;
o que e caro e a proxima hora de alguem descobrir a mesma coisa.

---

## 16. Guarda de seguranca escrita ao contrario

**Sintoma.** Escrevi a primeira versao da checagem assim:

```ts
if (process.env['POSTGRES_DB'] === bancoDoTeste) {
  throw new Error('cada ambiente precisa do seu proprio banco');
}
```

O script recusou rodar com a mensagem "POSTGRES_DB e TEST_POSTGRES_DB apontam
para o mesmo banco", sendo que os dois valores **precisam** ser iguais: e assim
que `.env.test` aponta o processo para o banco de teste.

**O que a guarda deveria dizer.** O perigo nao e "os dois nomes sao iguais". O
perigo e o `.env.test` faltar, o `.env` vencer, e sobrar o banco de
demonstracao. Entao a checagem correta e: o banco em uso tem de ser o banco de
teste, e o banco de teste tem de ser diferente do banco de trabalho. Sao duas
condicoes, e as duas vao na mesma direcao.

**Aprendizado.** Ao inverter a condicao de uma checagem, a falha aparece rapido e
aparece com a mensagem, que e a melhor forma de ela aparecer. Se a guarda
recusasse um estado legitimo, ela estaria valendo.

E o cuidado maior: uma guarda invertida que so falha em condicao errada passa
despercebida em todos os testes, porque o cenario legitimo nao acontece com
frequencia. Aqui apareceu porque o script foi rodado de verdade, e nao olhando o
codigo.

---

## 17. `CREATE ROLE` nao aceita parametro ligado

**Sintoma.** `there is no parameter $1` no provisionamento, com uma mensagem
que aponta para a sentenca e nao para a forgottenca de um `await`.

**O que era.** Duas causas, uma atras da outra:

1. `CREATE ROLE "x" LOGIN PASSWORD $1` - a senha precisa ser literal. E
   `COMMENT ON ROLE "x" IS $1` tambem.
2. O helper `consulta(sql)` aceitava so a sentenca e descartava o array de
   parametros, entao ate a consulta que usava `$1` corretamente falhava.

**Aprendizado.** A segunda e a mais instrutiva: um helper com assinatura
`(sql)` chamado de `consulta(sql, valores)` funciona para consultas sem
parametro e falha misteriosamente nas com parametro. A mensagem de erro
("no parameter $1") sugere problema na sentenca, quando o problema era um
argumento que nao chegava.

Quando a mensagem de erro aponta para um lugar, desconfie tambem do caminho que
levou ate la. E `escapeLiteral` do driver resolve o caso do literal sem
introduzir concatenacao de senha em SQL, que e o jeito classico de injetar
codigo num script "que so roda local".

---

## 18. Verificar e uma atividade, nao um detalhe

Ao longo do Marco B, varias vezes a resposta a um erro foi rodar o
`--verificar` do provisionamento, ou abrir o navegador, antes de mexer no
codigo. Duas vezes isso eviteu um conserto no lugar errado: o script dizia que
estava correto e a diferenca estava em um campo que o script nao escrevia.

`provisionar.mjs --verificar` existe por isso. Ele nao aplica nada: compara o
que existe com o que deveria existir e sai com codigo diferente de zero. Da
para colocar em CI sem risco, e ele conta uma historia diferente da que a
suite de teste conta.

---

## 14. `maxAge` do Express nao esta na mesma unidade do TTL do Redis

**Sintoma.** O login funcionava, a interface carregava o catalogo, mas uma
mutacao seguinte recebia `401`. O sintoma parecia perda de sessao ou problema
de CSRF.

**O que era.** O Redis mantinha a sessao por horas, mas o cookie era criado com
`maxAge: 8 * 60 * 60`. O Express interpreta `maxAge` em milissegundos, então o
navegador removia o cookie depois de 28,8 segundos. O servidor e o navegador
discordavam sobre a vida da mesma sessao.

**Aprendizado.** Ao configurar tempos em camadas diferentes, confirme a unidade
de cada biblioteca. O valor agora e `8 * 60 * 60 * 1000`, e o teste real voltou
a manter `/me`, CSRF e POST funcionando na mesma sessão.

---

## 15. CSRF precisa de um caminho para a interface, sem tornar a mutacao publica

**Sintoma.** O botão de enviar não produzia um pedido válido: a guarda exigia
`X-CSRF-Token`, mas o cookie de sessão era HttpOnly e a interface não tinha de
onde ler o token derivado dele.

**O que era.** A proteção estava correta, mas o contrato de leitura estava
faltando. Um endpoint autenticado não resolvia o caso quando a sessão do
navegador expirava; um endpoint sem proteção que aceitasse a mutação seria pior.

**Aprendizado.** O token de leitura pode ser público quando ele apenas calcula um
HMAC do cookie enviado pelo navegador, desde que a mutação continue exigindo
sessão válida, Origin permitido e conferência do HMAC. `GET /auth/csrf` devolve
somente esse valor e não altera estado; `POST` continua protegido. O cliente
mantém o token apenas em memória e o apaga ao sair ou trocar contexto.

---

## 16. E-mail como identificador pode ser o fluxo demonstrativo escolhido

**Decisao.** O ambiente demonstrativo passou a usar e-mail + senha no realm
institucional, sem a required action `CONFIGURE_TOTP`.

**Por que.** `loginWithEmailAllowed` já permite e-mail no formulário do
Keycloak. Reescrever o `username` de contas existentes não era necessário — e
o Keycloak 26 o trata como somente leitura. O provisionamento passou a manter
o username legado, procurar por e-mail quando necessário e deixar
`emailVerified=true` nas contas de demonstração.

**Aprendizado.** O administrador local não precisa verificar o e-mail novamente
e as contas comuns são provisionadas como verificadas. Isso atende ao fluxo de
demonstração, mas e-mail + senha não deve ser tratado como equivalente a MFA em
produção; um ambiente real deve reativar um segundo fator ou outro controle
forte.
