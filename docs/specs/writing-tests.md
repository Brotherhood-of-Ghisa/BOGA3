# Writing Tests (fixtures, settings, gotchas)

> **Load when:** you are writing or changing a test. *Which* layer a claim
> belongs in is `docs/specs/06-testing-strategy.md`; this doc is the mechanics of
> each layer — the shared fixtures, the settings that must not be "fixed", and
> the failure modes that have cost real debugging time.

## In-memory SQLite (shared fixture)

A unit test that needs a real local SQLite engine (rather than a mocked client)
uses the shared fixture `apps/mobile/__tests__/helpers/in-memory-db.ts`. It opens
an in-memory `better-sqlite3` database with **all** migrations from the generated
bundle (`apps/mobile/drizzle/migrations.generated.ts`) applied in journal order,
turns foreign-key enforcement on (as the app does at boot), and returns the
drizzle handle, the raw client and a `close()`. It migrates once per file and
hands each call a copy of that snapshot, so a fixture per test costs well under a
millisecond.

- Never hand-roll DB setup or copy DDL into a test: driving the schema from the
  generated bundle is what makes every test track the real shipped schema when a
  new migration lands.
- `createInMemoryDatabase()` in `beforeEach`, `close()` in `afterEach`. Pass
  `{ foreignKeys: false }` only to plant a deliberate orphan, with the reason at
  the call site.
- Tests about migrations themselves (upgrade paths, bundle integrity) build their
  own client and call `applyAllMigrations`. The snapshot does not exercise the
  production migrator (`drizzle-orm/expo-sqlite/migrator`, which tracks applied
  migrations), so upgrade-path coverage stays with those tests and the native
  migrator on a fresh install is proven by the `ios-data-smoke` lane.
- Exception: a test that deliberately builds a *partial* schema to assert
  negative-space behaviour keeps its bespoke setup — `clock.test.ts` creates only
  `sync_runtime_state` so a stray write to another table surfaces as a
  missing-table error, and the full-schema fixture would erase that guard.
  Bespoke fixtures still close their connections in `afterEach`.

**Device alignment.** Jest's SQLite must share major.minor with the SQLite the app
ships: `better-sqlite3`'s bundled build vs `expo-sqlite`'s vendored copy
(`node_modules/expo-sqlite/vendor/sqlite3/`, or `sqlcipher/` once the app enables
SQLCipher). `better-sqlite3` is pinned to an exact version for this, and
`apps/mobile/__tests__/sqlite-device-parity.test.ts` fails when an Expo SDK or
`better-sqlite3` upgrade breaks the match. Fix it by re-pinning `better-sqlite3`
to a release whose bundled SQLite (`deps/download.sh`) matches — prefer a patch at
or below the device's, so Jest is never the more permissive engine.

**Screens over real data.** `apps/mobile/__tests__/helpers/local-data.ts` renders
production screens, repositories and caches over this fixture, replacing only the
native database open in `apps/mobile/src/data/bootstrap.ts` (its stand-in replays
the boot steps screens depend on: infra-free starter catalog, foreign-key
integrity check, catalog-cache invalidation on reset) and seeding through the
Maestro harness fixtures (`loadMaestroFixture`). Reference use:
`apps/mobile/__tests__/stats-screen-local-data.test.tsx`.

## Time zone

`apps/mobile/jest.config.js` pins `TZ=Europe/London` for every Jest run, locally
and in CI, whatever the shell's zone. The zone observes DST, so local-calendar
tests (weeks, months, the clock changes) mean the same everywhere. Assert local
times from local fields (`new Date(y, m, d, h)`), not from UTC literals, unless
the test is about the UTC instant itself.

## Hang safety

- `npm test` is bare `jest` with **no `--forceExit`**, by design: `--forceExit`
  masks leaks, hiding the very open-handle hang this policy exists to catch. Do
  not add it.
- Two failure modes, covered separately. A hung test or hook (unresolved `await`,
  infinite loop) is bounded by `testTimeout` (15s) in
  `apps/mobile/jest.config.js`, so it fails loudly instead of stalling. A leaked
  handle that keeps the process alive *after* tests pass (unclosed connection,
  lingering timer, real Supabase transport) is caught by the CI step timeout.
  Parallel Jest may force-stop a leaking worker and only warn, so a passing run
  does not prove every worker shut down cleanly.
- `./boga test handles` runs the suite serially with `--detectOpenHandles` and
  reports lingering resources with a stack. It is a manual diagnostic for a
  shutdown warning or hang — outside CI and every gate aggregate, not a PR
  requirement. Scope it when useful: `npm run test:handles -- sync-cycle`.
- Safe-by-default mocking: `apps/mobile/jest.setup.ts` mocks
  `@supabase/supabase-js` `createClient` to an inert client (no socket, no GoTrue
  auto-refresh timer), so no suite can construct a real Supabase transport by
  forgetting a local mock. A suite needing richer behaviour overrides it with its
  own `jest.mock`.
- Any test that opens a real connection (e.g. a `better-sqlite3` `:memory:`
  handle) closes it in `afterEach`.

## Maestro flows: four load-bearing rules

1. **Assert, don't only screenshot.** A flow whose steps are `takeScreenshot`
   with `optional: true` taps between them goes green while the screen behind it
   breaks. Screenshots are evidence *for a human*; the lane's verdict must come
   from `assertVisible` / `assertNotVisible` on real ids.
2. **No hard-coded calendar dates.** Heatmap cell ids are
   `<prefix>-heatmap-cell-<weekStartDateKey>` and the `exercise-block-history`
   fixture seeds sessions relative to *now* (`daysAgo`), so a literal date is a
   time bomb. Assert the date-independent surface, or compute the key at run time
   in a `runScript` helper.
3. **Every scroll whose next step taps or asserts the SAME element carries
   `centerElement: true`.** That flag forces the scroll to keep going until the
   target is centred instead of stopping the moment Maestro calls it visible;
   without it a `scrollUntilVisible` can no-op on an element the hierarchy
   already reports, leaving it past the fold — the following `tapOn` then hits
   nothing, or the following assertion passes vacuously.
   `visibilityPercentage: 100` is Maestro's **default** (verified against
   `YamlScrollUntilVisible` in maestro-orchestra 2.8.0), so spelling it out is
   readability, not behaviour — do not credit it with a fix. Drop below 100 only
   for a target taller than the viewport, and say why in a comment.
   - Shared limit of both flags: Maestro computes visibility from the view
     hierarchy, **not** from occlusion, so an element centred inside a scroll
     container that fixed chrome overlays still counts as visible while the tap
     lands on the chrome. When a target sits under fixed chrome, drive the screen
     some other way.
   - A scroll that only positions the screen for a screenshot, or for an
     assertion on a *different* element, is outside this rule: centring the wrong
     element can push the one you care about off-screen.
   - **Exception: a target that ends (or, scrolling up, starts) its scroll
     content.** It can never reach the centre, so Maestro 2.8.0 swipes five more
     times against the end of the content (~9s, the element does not move) and
     then passes anyway; the run's `maestro.log` shows `Scrolling try count:`
     reaching 5 with identical `Element bounds:` each try. Drop `centerElement`
     there only when the target's *first* visible position is clear of fixed
     chrome, and say why in a comment — the default 100% visibility still forces
     the scroll when the target is past the fold. The first swipe can matter: the
     More screen's last row first shows over the minimised tab bar, and its tap
     misses without it.
4. **After an `openLink`, wait for something only the destination has.** A
   harness link runs its reset/fixture and then *replaces* the route, so the
   previous screen stays up for a moment and anything it shares with the
   destination (the same screen id, the same toggle, a hidden native title)
   matches early — the flow then asserts or taps the old screen. Wait on an id or
   text the previous screen cannot show, and, before tapping, on any content that
   loads in above the target. Do not tap the trust dialog or the dev-menu sheet
   away: `apps/mobile/scripts/maestro-ios-launch.sh` pre-seeds both off and fails
   the run if it cannot, and an optional tap on an absent element costs the full
   ~7s `optionalLookupTimeoutMs`, which also hides these races.

Run the insights flows on the supported small and large phone viewports when
closing changes to those presentations; their timestamped artifact roots and
screenshots are the visual evidence.
