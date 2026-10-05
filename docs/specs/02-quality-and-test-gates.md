# Quality & Test Gates (Always-Load Quickref)

> **Owns:** the gate ladder, the (generated) lane matrix, path→gate triggers, CI posture. **Not here:** per-test purpose and policies → `06`; durations → `./boga timings`. **Load when:** always (always-load).

The single source of truth for how to verify a change in this repo: how to set up,
the exact commands, and which gate to run for what you changed. One of the three
always-load docs (with `03-technical-architecture.md` and `09-project-structure.md`).

The deep per-test catalog and strategy live in `06-testing-strategy.md`; cite it,
don't restate it here.

## Run the gates (`./boga`, from anywhere in the repo)

```bash
./boga test fast       # mobile quality + docs/meta + consent/MCP unit + backend fast smoke
./boga test backend    # local Supabase auth/agent/sync contracts + real MCP smoke
./boga test frontend   # boots the iOS simulator, runs Maestro smoke + data-smoke + exercise page + session view + auth-profile + sync e2e + two-user groups e2e
./boga test frontend-ui  # the frontend lanes that need no backend (smoke, data-smoke, exercise page, session view)
./boga sweep [--ref <ref>]  # every gate lane on origin/main (or <ref>) in a dedicated worktree — required before a release build
./boga test --list     # every lane: name, gate, infra, CI?, command
./boga test <lane>     # one lane by name (e.g. ./boga test sync-push-contract)
./boga doctor          # verify THIS machine can run every lane
```

Bodyweight has no Maestro lane: none of its UI claims needs a device (spec 06,
"Maestro scope policy"). Jest over real data proves the exercise-page logger,
the session-view row, the body weight log, the Settings rows and the editor's
contribution field (`bodyweight-logging-ui.test.tsx`, `bodyweight-screen.test.tsx`,
`exercise-catalog-screen.test.tsx`); `ios-sync-e2e` enters a reading through
the real weight sheet on device. Pure/backend coverage owns policy variants,
exact date selection, migration, strict group omission, non-disclosure and
certification invalidation.

Lanes are defined in `scripts/lanes.tsv` (the lane registry — names there are
the canonical lane names everywhere: this doc, the timing records, `boga`).
The legacy `./scripts/quality-fast.sh` / `./scripts/quality-slow.sh` forward to
`boga` with their old argument forms.

Every `./boga test` run (gate or lane, `fast` included) first requires this
worktree's slot lease from `./boga worktree start` and fails hard without it.
Each lane then bootstraps what it needs (idempotent) and `cd`s into the right
workspace — installing deps if missing and booting/seeding the local Supabase, so
you do not set env vars or provision infrastructure by hand (Docker must be running
for the slow lanes). (`npm run …` scripts live only in `apps/mobile/package.json` —
there is no root `package.json` — but invoke the gates above, not the raw scripts.)
Worktree lifecycle (open, PR, release) and prerequisites: `01-worktree-and-environment.md`.

## This dev environment runs EVERY gate — "not in CI" ≠ "can't run here"

This machine can run **every** local gate, including the slow ones: the iOS
Maestro lanes (booted simulator + Metro + dev client) and the local Supabase
backend lanes (Docker). **"Not in CI" means you must run it locally — not that it
cannot be run.** Never defer a gate by claiming the simulator or Supabase is
"unavailable" in your environment: that is a recurring false assumption. Verify
capability with the command, don't assume absence:

```bash
xcrun simctl list devices available   # bootable iOS sims (e.g. iPhone 17 Pro) → Maestro lanes runnable
maestro --version                     # Maestro CLI present → boga test frontend runnable
xcodebuild -version                   # Xcode present → dev-client build / sim runnable
docker info                           # Docker up → local Supabase → boga test backend runnable
```

The **only** thing that genuinely "can't run" the iOS/Supabase slow gates is
**CI's** Linux runner (no iOS simulator) — a CI-runner fact, **not** a
this-machine fact. CI-can't ≠ this-machine-can't. If a check above fails, fix the
tool and run the gate; do not skip it.

## The test-lane map (read this once)

**One idea explains the whole gate structure: a lane's *infrastructure
dependency* decides everything — how fast it is, which gate it sits in, and
whether CI can run it.** "Fast/slow" and "frontend/backend" are labels that track
that one axis; when they seem to disagree, infra wins.

- **No infra (pure Node/jest)** → CI-safe. The only lanes CI runs today.
- **Local Supabase + Docker** → CI-*able*, but kept local **by choice** today
  (Docker boot cost). A regression here lands on `main` green until a human runs
  the backend gate; the cheap way to add CI coverage is to run this gate in CI —
  not to rewrite the tests as infra-free.
- **iOS simulator + Metro** → can **never** run on CI's Linux runners. Local-only
  by necessity.

So "fast" does **not** imply "in CI" (the backend fast smoke needs Docker and is
local-only), and "not in CI" is not a property of a *test* — it is where the repo
currently draws the line.

### Lane matrix (what runs where)

The one table that joins all four facts. **Generated** from `scripts/lanes.tsv`
and the measured timing records — edit those and run `./boga docs gen`; the
`docs-check` lane fails if this table drifts. Never quote a duration you didn't
get from `./boga timings` or a run.

<!-- boga:gen:lane-matrix — generated from scripts/lanes.tsv + timings records; edit those, then run ./boga docs gen -->
| Lane | Run via | In which gate | CI? | Measured median† |
| --- | --- | --- | :--: | --- |
| *Infra: none — CI runs these* | | | | |
| lint | `./boga test lint` | `boga test fast` (frontend half) | ✅ | ~1.8s |
| typecheck | `./boga test typecheck` | `boga test fast` (frontend half) | ✅ | ~4.1s |
| jest-full | `./boga test jest-full` | `boga test fast` (frontend half) | ✅ | ~13s |
| ui-guardrails | `./boga test ui-guardrails` | `boga test fast` (frontend half) | ✅ | ~0.2s |
| docs-check | `./boga test docs-check` | `boga test fast` (repo half) | ✅ | ~1.3s |
| meta-tests | `./boga test meta-tests` | `boga test fast` (repo half) | ✅ | ~54s |
| agent-auth-web | `./boga test agent-auth-web` | `boga test fast` (repo half) | ✅ | ~2.7s |
| mcp-unit | `./boga test mcp-unit` | `boga test fast` (repo half) | ✅ | ~3.5s |
| handles | `./boga test handles` | — (run by name) | ❌ | ~1.3m |
| jest-sync | `./boga test jest-sync` | — (run by name) | ❌ | ~3.6s |
| jest-coverage | `./boga test jest-coverage` | — (run by name) | ❌ | ~22s |
| complexity | `./boga test complexity` | — (run by name) | ❌ | ~8.2s |
| dependencies | `./boga test dependencies` | — (run by name) | ❌ | ~0.9s |
| *Infra: local Supabase + Docker — CI-able, local-only today* | | | | |
| backend-fast | `./boga test backend-fast` | `boga test fast` (backend half) | ❌ | ~46s |
| auth-authz | `./boga test auth-authz` | `boga test backend` | ❌ | ~9.0s |
| groups-contract | `./boga test groups-contract` | `boga test backend` | ❌ | ~27s |
| groups-leaderboards | `./boga test groups-leaderboards` | `boga test backend` | ❌ | ~3.8m |
| groups-api-live | `./boga test groups-api-live` | `boga test backend` | ❌ | ~56s |
| agent-api | `./boga test agent-api` | `boga test backend` | ❌ | ~1.4m |
| sync-v2-schema | `./boga test sync-v2-schema` | `boga test backend` | ❌ | ~8.4s |
| sync-push-contract | `./boga test sync-push-contract` | `boga test backend` | ❌ | ~8.4s |
| sync-pull-contract | `./boga test sync-pull-contract` | `boga test backend` | ❌ | ~7.0s |
| dev-wipe-my-data | `./boga test dev-wipe-my-data` | `boga test backend` | ❌ | ~6.0s |
| sync-drift | `./boga test sync-drift` | `boga test backend` | ❌ | ~40s |
| sync-v2-e2e | `./boga test sync-v2-e2e` | `boga test backend` | ❌ | ~2.0m |
| sync-infra | `./boga test sync-infra` | `boga test backend` | ❌ | ~20s |
| mcp-smoke | `./boga test mcp-smoke` | `boga test backend` | ❌ | ~10s |
| *Infra: iOS simulator + Metro — never CI-able (+ local Supabase where noted)* | | | | |
| ios-smoke | `./boga test ios-smoke` | `boga test frontend` + `frontend-ui` | ❌ | ~39s |
| ios-data-smoke | `./boga test ios-data-smoke` | `boga test frontend` + `frontend-ui` | ❌ | ~1.5m |
| ios-exercise-page | `./boga test ios-exercise-page` | `boga test frontend` + `frontend-ui` | ❌ | ~40s |
| ios-session-view | `./boga test ios-session-view` | `boga test frontend` + `frontend-ui` | ❌ | ~1.3m |
| ios-gates | `./boga test ios-gates` | — (run by name) | ❌ | ~2.2m |
| ios-auth-profile *(+ local Supabase)* | `./boga test ios-auth-profile` | `boga test frontend` | ❌ | ~1.5m |
| ios-sync-e2e *(+ local Supabase)* | `./boga test ios-sync-e2e` | `boga test frontend` | ❌ | ~1.6m |
| ios-groups-e2e *(+ local Supabase)* | `./boga test ios-groups-e2e` | `boga test frontend` | ❌ | ~2.4m |

† Median of each lane's 5 newest green runs (all machines, by `recorded_at`) in the generating machine's timing store (`~/.config/boga/timings/records/`); `./boga docs gen` keeps a committed figure until that median moves more than 20% from it. `N/A` = no measured data yet, **not** "instant" — run the lane to record it. Per-machine numbers over a time window: `./boga timings`.
<!-- /boga:gen:lane-matrix -->

Two traps this table exists to kill:

- **`test:handles` is an optional diagnostic** (registry gate `extra`). It
  runs outside CI and every gate aggregate. Use `./boga test handles` when
  investigating a Jest shutdown warning or hang; it is not a PR requirement.
- **Two lanes cross the FE/BE line, and they are NOT interchangeable:**
  **sync-infra** is a mobile jest body driving the *real* `runSyncCycle` against a
  *real* Supabase endpoint — breadth coverage (LWW, multi-device, drift, a
  fresh-device restore and a re-sync after changing account) with emulated
  storage and no UI; it sits at the end of `boga test backend`.
  **iOS sync e2e** is the device-level proof — real session view / exercise page UI, real cycle, real
  local Supabase (log a workout → pending drains to 0 → full wipe → re-sign-in
  restores from the remote DB). Bugs in UI gating, NetInfo, session handoff, and
  trigger wiring only surface in the e2e lane; a green sync-infra is not evidence
  for them.

## Choosing lanes

Lane choice is **judgement, agreed with the operator** — paths give a default,
not a requirement. The simulator and Docker lanes are the expensive part of the
ladder, and a path match says little about risk (a restyle of a screen matches
the same rows as a rewrite of its logic).

1. **Jest is always required.** Every code change adds or updates the Jest
   coverage for the behaviour it changes and runs `./boga test fast` to green.
   This is the one gate that is never negotiable.
2. **Start from the default.** `./boga test for [--diff <range>] [paths…]`
   prints the default lanes for the diff (`scripts/triggers.tsv`, summarized in
   the table below) and the rule that selected each.
3. **Propose, then agree.** Before running any lane beyond `./boga test fast`,
   the agent proposes a lane set to the operator (the human it works with):
   the default, lowered or raised by judgement, with a one-line reason per
   change. Lowering the default uses one
   of these categories:
   - `cosmetic` — colours, fonts, spacing, icons, and styling that do not change
     what renders, when it renders, or where an interactive element sits. Not
     cosmetic: conditional rendering, `testID`s, layout that can push a control
     off-screen or under the keyboard, list/scroll structure. Cosmetic evidence is
     a screenshot against the design target (`ui/ai-design-policy.md`), not a
     Maestro run.
   - `copy-only` — user-visible text changes with no logic change.
   - `test-only` — only Jest tests or test helpers changed.
   - `docs-only` — only documentation changed.
   - `covered-by-jest` — the changed behaviour has no device-only aspect (spec
     06, "Maestro scope policy") and the Jest tests in the diff prove it.

   Raise the default when the change carries risk its paths do not show (a
   shared hook, a boot-time effect, a native call). The operator's answer is
   final. The dev-client rebuild after a native iOS change (below) is not a
   lane choice and is never lowered.
4. **Run the smallest Maestro set.** Pick the lanes whose flows exercise the
   changed behaviour, not every lane a path matches.
5. **Record what ran.** The PR lists the lanes that ran, their result, and that
   the set was agreed with the operator (`.github/pull_request_template.md`).
   No checker validates it; reviewers read it.

### Default lanes by path

Machine-readable form: `scripts/triggers.tsv`, queried with
`./boga test for`. The table below is the human summary; keep both in sync.

| You changed… | Default |
| --- | --- |
| Any `apps/mobile` TS/JS logic | `./boga test fast` |
| `apps/mobile` UI screens / components / navigation (`app/**`, `components/**`) | `./boga test fast` **+** `./boga test frontend-ui` (**+** the area e2e lane below, if any) |
| …the root layout (`app/_layout.tsx`), the root stack and route access (`components/navigation/root-stack.tsx`, `components/navigation/auth-route-guard.tsx`, `src/navigation/root-route-access.ts`), or the Maestro harness (`app/maestro-harness.tsx`) | `./boga test fast` **+** `./boga test frontend` (every lane boots / resets through them) |
| …sign-in, profile, or connected-agents screens | the UI row **+** `./boga test ios-auth-profile` |
| …the sync-status surface (`components/sync-status/**`) | the UI row **+** `./boga test ios-sync-e2e` |
| …only group screens (`app/group/**`, `app/group-session/**`, `app/(tabs)/groups.tsx`, `app/exercise-link.tsx`, `components/groups/**`) | `./boga test fast` **+** `./boga test ios-smoke` **+** `./boga test ios-groups-e2e` |
| Only jest suites (`apps/mobile/__tests__/**`) | `./boga test fast` (no simulator; `__tests__/sync/**` also `backend`) |
| One Maestro flow (`apps/mobile/.maestro/flows/<flow>.yaml`) | the lane that runs that flow **+** `meta-tests` (runner / config changes: `./boga test frontend`) |
| Sync / boot / auth (`apps/mobile/src/sync/**`, `src/auth/**`, scheduler, data bootstrap/migrations, `drizzle/**`, sync RPCs) | `./boga test fast` **+** `./boga test backend` **+** `./boga test ios-sync-e2e` (the UI↔server e2e lane) |
| Backend (`supabase/migrations/**`, `functions/**`, RLS/policies, sync RPCs) | `./boga test backend` |
| Groups (`apps/mobile/src/groups/**`, group migrations `supabase/migrations/*group*`, `groups-fixture-reset.sh`) | the rows above **+** `./boga test groups-api-live` (the app's groups client against the live server) **+** `./boga test ios-groups-e2e` (the two-user UI↔server e2e lane) |
| Group evaluator (`supabase/functions/group-eval/**`, the TS it loads: `src/groups/set-facts.ts`, `src/exercise-calculations/**`, `src/data/set-types.ts`, `src/exercise-calculations/effort-policy.ts`) | the rows above **+** `./boga test groups-leaderboards` (already inside `boga test backend`) |
| Agent consent web (`apps/agent-auth-web/**`) | `./boga test fast` |
| MCP server (`services/boga-mcp/**`) | `./boga test fast` **+** `./boga test mcp-smoke` |
| Added/removed/upgraded a **native iOS** dependency (iOS pod, native Expo module, or an iOS-affecting native field / config plugin in `apps/mobile/app.config.ts`) | **First** `./boga ios build-client --force`, then `./boga test frontend` |

### Why the UI default is `frontend-ui`, not the whole frontend gate

The path default is deliberately **selective for UI**: a
screen/component change runs the backend-free simulator lanes, while the three
Supabase-backed e2e lanes (`ios-auth-profile`, `ios-sync-e2e`,
`ios-groups-e2e`) run for their own screens and for the sync / auth / groups /
migration rows. Those lanes prove server round-trips, which a restyle rarely
touches, and they are the slowest part of the gate (`./boga timings`). What a UI
change *can* do to them is rename or drop an element id a flow taps; two
controls cover that instead:

1. **`maestro-testids`** (in `meta-tests`, so the fast gate and CI): every
   Maestro `id:` selector must still exist in app source. Chip/segment ids
   built through a generic `${prefix}-${value}` join are only loosely checked
   (see the script header).
2. **The full sweep** — `./boga sweep [--ref <ref>]`
   (`scripts/full-sweep.sh`) runs every gate lane on `origin/main` (or a pushed
   branch) in its own long-lived worktree (`$(boga_worktree_root)/full-sweep`,
   own slot) and writes a summary under `~/.config/boga/sweep/latest/`. It is
   not scheduled.
   - **Required** on the `main` commit you are about to ship as a release
     build (TestFlight / App Store), before building
     (`apps/mobile/README-LOCAL-DEV-BUILD.md`, `RUNBOOK.md`).
   - **Otherwise a suggestion to the operator, never a requirement.**
     `./boga test for` prints a *SUGGEST TO THE OPERATOR* sweep line for a diff
     touching shared UI chrome (`components/ui/**`, `components/navigation/**`,
     the tab layout) or 15+ screen/component files; the agent passes that
     suggestion on and the operator decides.

   A RED sweep means the ref has a regression the PR gates did not select —
   bisect with `./boga test <lane>`. It needs the machine awake (a lid-closed
   Mac pauses Docker).

Any UI change may still run `./boga test frontend` — it covers `frontend-ui`
and the three Supabase-backed e2e lanes.

Run the agreed lanes **to green before opening the PR**, and put the evidence
(command output / Maestro artifact path) in the PR. A pure-JS or
config-only change never needs the dev-client rebuild (Metro bundles it at
runtime); a native iOS change always does, or every worktree's Maestro run fails at
boot with `Cannot find native module`. Android-only fields in `app.config.ts` (e.g.
`android.package`, Android icons) do not alter the iOS dev-client binary or affect
iOS Maestro lanes and are exempt from the iOS dev-client rebuild and frontend gate.

## Quality targets (run once before the PR)

Three lanes hold the mobile app to its quality targets. They sit outside every
gate and outside CI: the agent runs each **once, on the finished change, before
opening the PR**, and lists all three in the PR's Tests table. All must be green.

| Lane | Target | Where it lives |
| --- | --- | --- |
| `jest-coverage` | Whole-suite floor: **80% branches, 80% lines** (`app/**`, `components/**`, `src/**`, tests excluded). Branches is the tight one (82.2% when the floor landed; lines 92.6%). | `coverageThreshold` in `apps/mobile/jest.config.js` |
| `complexity` | Per function in the same source: cognitive complexity (`sonarjs`) **≤ 25**, **≤ 200** lines (blank lines and comments excluded), nesting depth **≤ 4**, **≤ 5** parameters. | `apps/mobile/eslint.complexity.config.js` |
| `dependencies` | Import direction in the same source (dependency-cruiser, type-only imports included): no cycles; `src/**` never imports `app/**` or `components/**`; `src/data` and `src/exercise-calculations` import only the layers spec 09 ("Import direction") allows. | `apps/mobile/dependency-cruiser.config.cjs` |

- **Cognitive, not cyclomatic.** ESLint's cyclomatic `complexity` counts every
  `?.`, `??` and `&&` as a path, so it flagged flat, readable guards and prop
  defaults and pushed splits that did not aid reading; branch coverage
  (`jest-coverage`) already measures how much of each function is tested.
  Cognitive complexity scores what is hard to read: nested control flow.
- **Grandfathered offenders.** The functions already over a complexity limit
  when it landed are listed, as counts per file and rule, in
  `apps/mobile/eslint-complexity-suppressions.json` (ESLint bulk
  suppressions). A new offender, or one more in a listed file, fails the lane.
- **The list only shrinks.** Splitting a listed function leaves a stale
  suppression, which also fails the lane until you run
  `npm run lint:complexity -- --prune-suppressions` (from `apps/mobile/`) and
  commit the smaller file.
- **Grandfathered imports.** The imports that already broke a dependency rule
  when it landed are listed in
  `apps/mobile/dependency-cruiser-known-violations.json`; any other violation
  fails the lane. A fixed entry does not fail the lane by itself: run
  `npm run lint:deps:prune` (from `apps/mobile/`, shrink-only) and commit the
  smaller file.
- **The fix is the code, never the target.** Add tests, split the function,
  or move the code to the layer a rule allows. Lowering a threshold, raising a
  limit, relaxing a dependency rule, or adding a suppression or baseline entry
  needs the operator's agreement, stated in the PR's Deviations section.
- **Coverage is global, so run the whole suite.** A scoped
  `npm run test:coverage -- <path>` counts every other file as 0% and always
  fails the floor; scope it only to read the per-file report
  (`coverage/lcov-report/index.html`).

## What CI runs

CI (`.github/workflows/ci.yml`) runs every infra-free lane marked `CI? ✅`:
mobile `lint`, `typecheck`, and `jest-full`; repository `docs-check` and
`meta-tests` (including stubbed Android launcher/SDK regression fixtures);
the consent-web `agent-auth-web` lane; and the MCP `mcp-unit` lane.
It installs each workspace from its own lockfile.
`test:handles` is an optional local `jest --detectOpenHandles` diagnostic for
shutdown warnings or hangs; CI does not rerun the suite with it. `npm test`
remains bare `jest` (no `--forceExit`), with the CI step timeout bounding a
process that hangs. Jest may force-stop a leaking worker and only warn, so
investigate shutdown warnings with the optional diagnostic.

**Everything else is local-only** (see the `CI?` column in the lane matrix). The
backend/sync-v2 suites are CI-*able* but kept local by choice; the Maestro iOS
lanes can never run on CI's Linux runners. Either way, breakage on those lanes
accumulates on `main` invisibly until a human runs them — so run the slow gate for
your area (table above) before the PR.

## Maintenance

Update this doc — **including the lane matrix above** — in the same change
whenever you alter a gate or lane: `scripts/lanes.tsv` (the registry `./boga`
runs from), `scripts/triggers.tsv` (the path-trigger registry behind
`boga test for`), `supabase/scripts/run-suite.sh` / `test-*.sh`,
`apps/mobile/scripts/maestro-run-lane.sh` (moving a flow between lanes means
updating its `triggers.tsv` row — `test-for.test.sh` enforces it),
`scripts/full-sweep.sh`, an `apps/mobile/package.json`
`test*`/`lint`/`typecheck` script, or `.github/workflows/ci.yml`. If a fact here
ever disagrees with `scripts/lanes.tsv` or the scripts, the registry/scripts
win — fix the doc.

**Source-of-truth ownership** (so the test docs can't drift apart again):
this doc owns the lane matrix + CI membership; `06-testing-strategy.md` owns each
test's purpose/why; durations are owned by the measured records in each machine's timing store
`~/.config/boga/timings/records/` (written by every `./boga test` lane run,
read via `./scripts/test-timings.sh` — no doc hand-maintains them). Each links by lane
name; none restates another's column.

## Deeper docs (load when relevant)

- `06-testing-strategy.md` — per-test-entry-point catalog (purpose / infra / when), coverage policies, hang-safety rationale.
- `11-maestro-runtime-and-testing-conventions.md` — Maestro runtime contract.
- `12-worktree-config-and-isolation.md` — slot model and isolation.
- `./scripts/test-timings.sh` — measured per-lane wall-clock times (interpretation: `docs/testing/local-test-timings.md`).
