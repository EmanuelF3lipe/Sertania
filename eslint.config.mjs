/**
 * Configuracao do ESLint (flat config, ESLint 9).
 *
 * As regras nao sao esteticas. Cada uma abaixo prev um erro concreto ja
 * observado neste projeto, e o comentario diz qual.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Ignorar o que nao e codigo nosso. `dist` contem o resultado do build e
    // passaria em qualquer analise estatica sem dizer nada.
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.cjs', '**/*.json'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // O projeto nao usa `console`: log passa por NestJS Logger, que respeita
      // o nivel configurado. Um `console.log` esquecido vaza dado em producao.
      'no-console': 'error',

      // `any` desmonta o que o TypeScript estrito construiu. Onde o tipo e
      // realmente desconhecido, o codigo deve dizer isso com `unknown`.
      '@typescript-eslint/no-explicit-any': 'error',

      // Promessa esquecida e a forma mais comum de erro silencioso em Node:
      // o processo segue e a gravacao nunca acontece.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // `async` sem `await` indica logica que achou que era assincrona e nao
      // e, o que costuma esconder um estado de carregamento que nunca sai.
      '@typescript-eslint/require-await': 'error',

      // Condicoes com valor desconhecido quase sempre expresses uma intencao
      // diferente da que o TypeScript assume. `if (valor)` em `string | undefined`
      // trata "" como falso, e o caso foi relevante ao validar upload.
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowNullableBoolean: true, allowNullableString: true, allowNullableObject: true },
      ],

      // Nomes de parametro com prefixo `_` dizem "nao usado de proposito".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      'no-param-reassign': 'error',
      'no-shadow': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Comparacao de array com indexacao, include e length ou contagem; os tres
      // aparecem com o formato de protocolo.
      'no-implicit-coercion': ['error', { boolean: false, allow: ['!!'] }],
    },
  },

  // Testes: tipagem mais frouxa, porque fixtures e mocks de driver sao
  // legitimamente `any`. As regras de CORRECAO permanecem valendo, porque
  // um teste com logica errada e pior que um teste sem.
  {
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // `async` sem `await` em helper de teste e normal: a assinatura
      // assincrona mantem a forma de chamada igual a da aplicacao.
      '@typescript-eslint/require-await': 'off',
      'no-console': 'off',
      // Variaveis de fixture nao usadas sao ruido comum em teste.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // O flat config vem antes do Prettier: ele desliga as regras de formatacao
  // que o Prettier cuida, evitando conflito entre as duas ferramentas.
  prettier,
);
