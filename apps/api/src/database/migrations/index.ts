export { InitialSchema1730000000000 } from './1730000000000-InitialSchema';
import { InitialSchema1730000000000 } from './1730000000000-InitialSchema';

/**
 * Migracoes versionadas, em ordem.
 *
 * Rollback de aplicacao nao autoriza apagar dados para voltar o esquema: por
 * isso o `down` existe para ambiente de teste, e operacao em producao trata
 * migracao como passo unico (secao 18).
 */
export const migrations = [InitialSchema1730000000000];
