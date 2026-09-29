/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // APENAS unitarios. Testes que tocam infraestrutura ficam em
  // `jest-integration.config.js`, porque exigem Postgres e Redis no ar.
  //
  // A separacao e explicita, e nao por convencao de nome, para que uma suite
  // obrigatoria nunca fique verde por nao encontrar teste nenhum.
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.unit.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/test/integration/',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { warnOnly: false } }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
};
