module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/app/__tests__/sync-reinstall-restore-parity.test.ts'],
};
