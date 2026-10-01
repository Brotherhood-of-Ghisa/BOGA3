module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/?(*.)+(test).[tj]s?(x)'],
  // Suites excluded from the default (`jest` / `npm test`) run because they need
  // live infrastructure the fast lane does not provision:
  //   - the two cycle suites drive the sync cycle against a real deployed
  //     Postgres + PostgREST + RLS endpoint, so they require a live Supabase
  //     endpoint (URL + anon key in the environment) — this is also where the
  //     reinstall/restore parity check lives now (cycle-round-trip's "a wiped
  //     client re-pulls all four rows via the layered drain" assertion);
  //   - the drift checker shells out to a database reset to materialize the
  //     server schema, so it needs a local Postgres/Supabase stack.
  //   All three run only via their own dedicated infra script, which overrides
  //   this ignore list (and the two endpoint suites fail hard when the endpoint
  //   env is missing).
  testPathIgnorePatterns: [
    '<rootDir>/app/__tests__/sync/cycle-round-trip.test.ts',
    '<rootDir>/app/__tests__/sync/cycle-multidevice-lww.test.ts',
    '<rootDir>/app/__tests__/sync/auth-required-envelope.test.ts',
    '<rootDir>/app/__tests__/sync/drift-check.test.ts',
    '<rootDir>/app/__tests__/sync/update-softdelete-roundtrip.test.ts',
    '<rootDir>/app/__tests__/sync/future-clock-clamp.test.ts',
  ],
  // Explicit per-test/hook ceiling: a hung test or hook (unresolved await,
  // infinite loop) now fails loudly here instead of stalling the run. This is
  // a DIFFERENT failure mode from a leaked handle that keeps the process alive
  // AFTER tests pass — that one is caught by the CI step timeout plus the
  // `npm run test:handles` open-handle guard, NOT by `--forceExit` (which would
  // mask the leak). 15s is generous vs the sub-second real test work, so it
  // never flakes on a slow CI runner.
  testTimeout: 15000,
  // Coverage is opt-in (`npm run test:coverage`, lane `jest-coverage`):
  // instrumentation slows the run, so plain `npm test` stays uninstrumented.
  // Every source file is listed, so a file no test imports reports 0% instead
  // of silently dropping out of the totals.
  collectCoverageFrom: [
    '{app,components,src}/**/*.{ts,tsx}',
    '!**/__tests__/**',
    '!**/*.test.{ts,tsx}',
    '!**/*.d.ts',
  ],
  // text-summary: console totals; json-summary: machine-readable totals;
  // lcov: per-file HTML report (coverage/lcov-report/index.html) + lcov.info.
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
};
