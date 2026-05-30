module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/?(*.)+(test).[tj]s?(x)'],
  testPathIgnorePatterns: ['<rootDir>/app/__tests__/sync-reinstall-restore-parity.test.ts'],
  // Explicit per-test/hook ceiling: a hung test or hook (unresolved await,
  // infinite loop) now fails loudly here instead of stalling the run. This is
  // a DIFFERENT failure mode from a leaked handle that keeps the process alive
  // AFTER tests pass — that one is caught by the CI step timeout plus the
  // `npm run test:handles` open-handle guard, NOT by `--forceExit` (which would
  // mask the leak). 15s is generous vs the sub-second real test work, so it
  // never flakes on a slow CI runner.
  testTimeout: 15000,
};
