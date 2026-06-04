module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // The reinstall / second-device restore-parity suites: they prove a wiped
  // local store (same-device reinstall) and a never-before-seen device both
  // restore the full account from the live endpoint within the foreground
  // window. The wrapper script provisions the backend and points the live-branch
  // env at it before invoking this config.
  testMatch: [
    '<rootDir>/app/__tests__/sync/launch-reinstall-restore.test.ts',
    '<rootDir>/app/__tests__/sync/launch-second-device-restore.test.ts',
  ],
};
