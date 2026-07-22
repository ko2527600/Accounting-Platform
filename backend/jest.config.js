module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  forceExit: true,
  // DO NOT use clearMocks/resetMocks/restoreMocks globally — they interfere with
  // the Prisma singleton and module-level state across integration test suites.
  // Each test file manages its own mock lifecycle via jest.clearAllMocks() in beforeEach.
  testTimeout: 30000,
};
