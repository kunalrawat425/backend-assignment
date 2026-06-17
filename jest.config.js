/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 15000,
  clearMocks: true,
};
