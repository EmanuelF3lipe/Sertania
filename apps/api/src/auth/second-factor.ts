/**
 * Politica de segundo fator (especificacao secao 20, criterio 7).
 *
 * Este arquivo existe por dois motivos, e os dois importam.
 *
 * Primeiro, e uma decisao de DOMINIO, nao um detalhe do OIDC. A pergunta "isto
 * prova segundo fator?" tem a mesma resposta para o Keycloak de hoje e para
 * qualquer provedor de amanha. Deixar a resposta dentro do cliente OIDC
 * prenderia a regra a uma biblioteca.
 *
 * Segundo, e testavel. O `openid-client` e distribuido so como ESM, e a suite
 * unitaria roda em CommonJS: um teste que importasse o servico OIDC nao
 * carregaria. Separar a politica mantem a regra verificavel por teste de
 * verdade, sem simular o provedor de identidade.
 *
 * A verificacao de que o token REAL tem segundo fator continua sendo feita na
 * troca, com o token do provedor. O que esta politica decide e o significado
 * do campo `amr`.
 */

/**
 * Metodos de autenticacao que Keycloak e provedores OIDC declaram no campo
 * `amr` do token quando houve segundo fator.
 *
 * `otp` e o nome legado do TOTP e aparece em provedores mais antigos. `mfa` e
 * aceito por alguns emissores, mas NAO entra aqui: e um rotulo generico que
 * nao diz qual fator foi provado, e um rotulo generico nao serve de prova.
 */
const METODOS_DE_SEGUNDO_FATOR: ReadonlySet<string> = new Set([
  'totp',
  'webauthn',
  'otp',
]);

/**
 * O token prova posse de segundo fator?
 *
 * A checagem e pelo campo `amr`, e nao pela presenca de senha. Senha com MFA
 * continua sendo senha: o que muda e que o provador passou a declarar um
 * segundo metodo.
 *
 * Ausencia de `amr` significa ausencia de prova. Um provedor que nao declara
 * o campo nao tem como provar nada, e tratar a ausencia como "provavelmente
 * tem" transformaria uma mudanca do provedor em liberacao silenciosa.
 */
export function tokenProvaSegundoFator(amr: readonly string[] | null | undefined): boolean {
  if (amr === null || amr === undefined) return false;
  return amr.some((metodo) => METODOS_DE_SEGUNDO_FATOR.has(metodo));
}

/** Metodos reconhecidos, para mensagem de log e para documentacao. */
export function metodosDeSegundoFatorConhecidos(): readonly string[] {
  return [...METODOS_DE_SEGUNDO_FATOR];
}
