/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // O config vive em `test/`, entao `rootDir` precisa subir um nivel para que
  // os caminhos de `testMatch` e `tsconfig` resolvam a partir de `apps/api`.
  rootDir: '..',
  // APENAS integracao. Os testes unitarios ficam no config principal, e a
  // separacao evita que uma suite fique verde por nao encontrar teste nenhum.
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  // `testPathIgnorePatterns` garante que unitarios nao entrem aqui, mesmo que o
  // padrao de nome mude no futuro.
  testPathIgnorePatterns: ['/node_modules/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { warnOnly: false } }],
  },
  // Timeout alto: conexao com o Postgres e concorrencia real.
  testTimeout: 60_000,
};
