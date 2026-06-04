module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/?(*.)+(test).[tj]s?(x)'],
  // Suites excluded from the default (`jest` / `npm test`) run because they need
  // live infrastructure the fast lane does not provision:
  //   - the cycle / restore suites drive the real sync cycle and the first-sign-in
  //     bootstrapper against a real deployed Postgres + PostgREST + RLS endpoint,
  //     so they require a live Supabase endpoint (URL + anon key in the
  //     environment): the cycle round-trip, the no-JWT envelope case, the
  //     same-device reinstall restore, the fresh second-device restore, and the
  //     v1 server-object absence check;
  //   - the drift checker shells out to a database reset to materialize the
  //     server schema, so it needs a local Postgres/Supabase stack.
  //   All run only via their own dedicated infra script, which overrides this
  //   ignore list (and the endpoint suites fail hard when the endpoint env is
  //   missing, so a missing endpoint can never pass silently).
  testPathIgnorePatterns: [
    '<rootDir>/app/__tests__/sync/cycle-round-trip.test.ts',
    '<rootDir>/app/__tests__/sync/auth-required-envelope.test.ts',
    '<rootDir>/app/__tests__/sync/drift-check.test.ts',
    '<rootDir>/app/__tests__/sync/launch-reinstall-restore.test.ts',
    '<rootDir>/app/__tests__/sync/launch-second-device-restore.test.ts',
    '<rootDir>/app/__tests__/sync/no-v1-server-objects.test.ts',
  ],
  // Explicit per-test/hook ceiling: a hung test or hook (unresolved await,
  // infinite loop) now fails loudly here instead of stalling the run. This is
  // a DIFFERENT failure mode from a leaked handle that keeps the process alive
  // AFTER tests pass — that one is caught by the CI step timeout plus the
  // `npm run test:handles` open-handle guard, NOT by `--forceExit` (which would
  // mask the leak). 15s is generous vs the sub-second real test work, so it
  // never flakes on a slow CI runner.
  testTimeout: 15000,
};
