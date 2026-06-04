module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // The live-endpoint launch suites that sign in as the provisioned auth
  // fixture: the same-device reinstall restore, the fresh second-device restore,
  // and the v1 server-object absence check. The wrapper script provisions the
  // backend (and the auth fixture) and points the live-branch env at it before
  // invoking this config. These are kept OUT of `test:sync:infra` on purpose:
  // that lane's drift checker runs `supabase db reset`, which drops the auth
  // fixture mid-run and would strand any sign-in suite sharing the process.
  testMatch: [
    '<rootDir>/app/__tests__/sync/launch-reinstall-restore.test.ts',
    '<rootDir>/app/__tests__/sync/launch-second-device-restore.test.ts',
    '<rootDir>/app/__tests__/sync/no-v1-server-objects.test.ts',
  ],
};
