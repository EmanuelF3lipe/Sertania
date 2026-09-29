/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // O config vive em `test/`, entao `rootDir` precisa subir um nivel para que
  // os caminhos de `testMatch` e `tsconfig` resolvam a partir de `apps/api`.
  rootDir: '..',
  // Os testes de integracao ficam num projeto separado: exigem a stack no ar e
  // nao devem rodar num `pnpm test` de CI sem servicos.
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { warnOnly: false } }],
  },
  // Timeout alto: conexao com o Postgres e concorrencia real.
  testTimeout: 60_000,
};
