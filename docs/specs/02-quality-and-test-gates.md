# Quality & Test Gates (Always-Load Quickref)

> **Owns:** the gate ladder, the (generated) lane matrix, path→gate triggers, CI posture. **Not here:** per-test purpose and policies → `06`; durations → `./boga timings`. **Load when:** always (always-load).

Which lanes exist, which to run for a change, what must be green before the PR.

## Run the gates (`./boga`, from anywhere in the repo)

```bash
./boga test fast         # mobile quality + docs/meta + consent/MCP unit + backend smoke
./boga test backend      # local Supabase auth/agent/sync contracts + real MCP smoke
./boga test frontend     # iOS sim: every Maestro lane
./boga test frontend-ui  # iOS sim: only the lanes needing no backend
./boga test <lane>       # one lane by name (e.g. sync-push-contract)
./boga test for [--diff <range>] [paths…]   # a diff's default lanes + the rule behind each
./boga test --list       # every lane: name, gate, infra, CI?, command
./boga sweep [--ref <ref>]   # every lane on a ref, in its own worktree
./boga doctor            # can THIS machine run every lane?
./boga timings [lane]    # measured durations — never quote an unmeasured one
```

`scripts/lanes.tsv` is the lane registry; its names are the canonical lane names
everywhere (this doc, the timing records, `boga`). Legacy
`./scripts/quality-{fast,slow}.sh` forward here. Each lane `cd`s into the right
workspace and installs deps itself, so never invoke the raw `npm run …` scripts
(they live only in `apps/mobile/package.json`; there is no root one). Worktree
lifecycle and the slot lease every lane requires:
`01-worktree-and-environment.md`.

## Why a lane sits where it does

**A lane's *infrastructure dependency* decides everything — how fast it is, which
gate it sits in, and whether CI can run it.** "Fast/slow" and "frontend/backend"
are labels that track that one axis; when they seem to disagree, infra wins.

- **No infra (pure Node/jest)** → CI-safe. The only lanes CI runs today.
- **Local Supabase + Docker** → CI-*able*, kept local **by choice** (Docker boot
  cost). A regression here lands on `main` green until a human runs the backend
  gate; the cheap way to close that is to run this gate in CI, not to rewrite the
  tests as infra-free.
- **iOS simulator / Android emulator + Metro** → can **never** run on CI's Linux
  runners.

"Fast" does not imply "in CI": backend-fast needs Docker.

### Lane matrix (what runs where)

**Generated** from `scripts/lanes.tsv` and the measured timing records: edit
those, run `./boga docs gen`; `docs-check` fails if this table drifts.

<!-- boga:gen:lane-matrix — generated from scripts/lanes.tsv + timings records; edit those, then run ./boga docs gen -->
| Lane | Run via | In which gate | CI? | Measured median† |
| --- | --- | --- | :--: | --- |
| *Infra: none — CI runs these* | | | | |
| lint | `./boga test lint` | `boga test fast` (frontend half) | ✅ | ~1.6s |
| typecheck | `./boga test typecheck` | `boga test fast` (frontend half) | ✅ | ~4.9s |
| jest-full | `./boga test jest-full` | `boga test fast` (frontend half) | ✅ | ~24s |
| ui-guardrails | `./boga test ui-guardrails` | `boga test fast` (frontend half) | ✅ | ~0.2s |
| docs-check | `./boga test docs-check` | `boga test fast` (repo half) | ✅ | ~1.6s |
| meta-tests | `./boga test meta-tests` | `boga test fast` (repo half) | ✅ | ~1.1m |
| agent-auth-web | `./boga test agent-auth-web` | `boga test fast` (repo half) | ✅ | ~2.7s |
| mcp-unit | `./boga test mcp-unit` | `boga test fast` (repo half) | ✅ | ~3.5s |
| handles | `./boga test handles` | — (run by name) | ❌ | ~1.3m |
| jest-sync | `./boga test jest-sync` | — (run by name) | ❌ | ~3.6s |
| jest-coverage | `./boga test jest-coverage` | — (run by name) | ❌ | ~16s |
| complexity | `./boga test complexity` | — (run by name) | ❌ | ~8.2s |
| dependencies | `./boga test dependencies` | — (run by name) | ❌ | ~0.9s |
| *Infra: local Supabase + Docker — CI-able, local-only today* | | | | |
| backend-fast | `./boga test backend-fast` | `boga test fast` (backend half) | ❌ | ~1.3m |
| auth-authz | `./boga test auth-authz` | `boga test backend` | ❌ | ~7.2s |
| groups-contract | `./boga test groups-contract` | `boga test backend` | ❌ | ~19s |
| groups-leaderboards | `./boga test groups-leaderboards` | `boga test backend` | ❌ | ~1.4m |
| groups-api-live | `./boga test groups-api-live` | `boga test backend` | ❌ | ~4.4s |
| agent-api | `./boga test agent-api` | `boga test backend` | ❌ | ~10s |
| sync-v2-schema | `./boga test sync-v2-schema` | `boga test backend` | ❌ | ~6.6s |
| sync-push-contract | `./boga test sync-push-contract` | `boga test backend` | ❌ | ~5.2s |
| sync-pull-contract | `./boga test sync-pull-contract` | `boga test backend` | ❌ | ~3.5s |
| dev-wipe-my-data | `./boga test dev-wipe-my-data` | `boga test backend` | ❌ | ~2.3s |
| sync-drift | `./boga test sync-drift` | `boga test backend` | ❌ | ~40s |
| sync-v2-e2e | `./boga test sync-v2-e2e` | `boga test backend` | ❌ | ~1.0m |
| sync-infra | `./boga test sync-infra` | `boga test backend` | ❌ | ~20s |
| mcp-smoke | `./boga test mcp-smoke` | `boga test backend` | ❌ | ~5.9s |
| groups-protocol4 | `./boga test groups-protocol4` | — (run by name) | ❌ | ~3.0m |
| *Infra: iOS simulator + Metro — never CI-able (+ local Supabase where noted)* | | | | |
| ios-smoke | `./boga test ios-smoke` | `boga test frontend` + `frontend-ui` | ❌ | ~57s |
| ios-data-smoke | `./boga test ios-data-smoke` | `boga test frontend` + `frontend-ui` | ❌ | ~2.1m |
| ios-exercise-page | `./boga test ios-exercise-page` | `boga test frontend` + `frontend-ui` | ❌ | ~56s |
| ios-session-view | `./boga test ios-session-view` | `boga test frontend` + `frontend-ui` | ❌ | ~1.7m |
| ios-gates | `./boga test ios-gates` | — (run by name) | ❌ | ~2.2m |
| ios-auth-profile *(+ local Supabase)* | `./boga test ios-auth-profile` | `boga test frontend` | ❌ | ~1.5m |
| ios-sync-e2e *(+ local Supabase)* | `./boga test ios-sync-e2e` | `boga test frontend` | ❌ | ~1.6m |
| ios-groups-e2e *(+ local Supabase)* | `./boga test ios-groups-e2e` | `boga test frontend` | ❌ | ~2.4m |
| *Infra: Android emulator + Metro — never CI-able* | | | | |
| android-smoke | `./boga test android-smoke` | `boga test frontend-android` | ❌ | ~2.0m |
| android-data-smoke | `./boga test android-data-smoke` | `boga test frontend-android` | ❌ | ~2.3m |

† Median of each lane's 5 newest green runs (all machines, by `recorded_at`) in the generating machine's timing store (`~/.config/boga/timings/records/`); `./boga docs gen` keeps a committed figure until that median moves more than 20% from it. `N/A` = no measured data yet, **not** "instant" — run the lane to record it. Per-machine numbers over a time window: `./boga timings`.
<!-- /boga:gen:lane-matrix -->

Two traps this table exists to kill:

- **The `extra`-gate lanes sit in no gate and no CI job** — `handles`,
  `ios-gates`, `jest-sync`, `groups-protocol4`, plus the three quality-target
  lanes below. `handles` is an optional `--detectOpenHandles` diagnostic, not a
  PR requirement. `groups-protocol4` is a real contract lane whose one-way
  activation the next preflight resets: run it when `boga test for` prints it.
- **`sync-infra` and `ios-sync-e2e` both cross the FE/BE line, and they are NOT
  interchangeable.** `sync-infra` (a mobile jest body at the end of
  `boga test backend`) drives the real `runSyncCycle` against a real Supabase
  endpoint, with emulated storage and no UI. `ios-sync-e2e` is the device-level
  proof: real UI, real cycle, real local Supabase. Bugs in UI gating, NetInfo,
  session handoff and trigger wiring surface only there — a green `sync-infra` is
  not evidence for them.

## Choosing lanes

Lane choice is **judgement, agreed with the operator** — paths give a default,
not a requirement, because a path match says little about risk (a restyle of a
screen matches the same rows as a rewrite of its logic) and the simulator and
Docker lanes are the expensive part of the ladder.

1. **Jest is always required**, and is the one gate that is never negotiable:
   every code change adds or updates the Jest coverage for the behaviour it
   changes and runs `./boga test fast` to green.
2. **Start from the default.** `./boga test for` prints the default lanes for
   your diff and the rule that selected each, out of the path-trigger registry
   `scripts/triggers.tsv` (`AGENTS.md` carries the short human summary).
3. **Propose, then agree.** Before running any lane beyond `./boga test fast`,
   propose a lane set to the operator: the default, lowered or raised by
   judgement, one line of reason per change. Lowering uses one of these
   categories:
   - `cosmetic` — colours, fonts, spacing, icons, styling that do not change what
     renders, when it renders, or where an interactive element sits. Not
     cosmetic: conditional rendering, `testID`s, layout that can push a control
     off-screen or under the keyboard, list/scroll structure. Its evidence is a
     screenshot against the design target (`ui/ai-design-policy.md`), not a
     Maestro run.
   - `copy-only` — user-visible text, no logic change.
   - `test-only` — only Jest tests or test helpers changed.
   - `docs-only` — only documentation changed.
   - `covered-by-jest` — the changed behaviour has no device-only aspect (spec
     `06`, "Maestro scope policy") and the Jest tests in the diff prove it.

   Raise the default when the change carries risk its paths do not show (a
   shared hook, a boot-time effect, a native call). The operator's answer is
   final; the dev-client rebuild below is not a lane choice and is never lowered.
4. **Run the smallest Maestro set** — the lanes whose flows exercise the changed
   behaviour, not every lane a path matches. Some areas have no Maestro lane at
   all (bodyweight: Jest over real data plus `ios-sync-e2e` covers it); adding a
   flow needs the operator's approval first (spec `06`, "Maestro scope policy").
5. **Run the agreed lanes to green before opening the PR**, and record each one
   there with its result, its evidence (command output or Maestro artifact path)
   and that the set was agreed. No checker validates this; reviewers read it.

**Why the UI default is `frontend-ui`, not `frontend`:** the three
Supabase-backed e2e lanes (`ios-auth-profile`, `ios-sync-e2e`, `ios-groups-e2e`)
prove server round-trips a restyle rarely touches and are the slowest lanes, so
they run only for their own screens and for the sync / auth / groups / migration
triggers. The one thing a UI change *can* break in them — renaming an element id
a flow taps — is caught by `maestro-testids` inside `meta-tests` (so in the fast
gate and CI): every Maestro `id:` selector must still exist in app source, except
generic `${prefix}-${value}` joins, which are only loosely checked.

### Native dev-client rebuild (never lowered)

A new or changed **native** dependency — an iOS pod, a native Expo module, or an
iOS- or Android-affecting native field / config plugin in `app.config.ts` — needs
a forced rebuild **before** the Maestro lanes, or they fail at boot with
`Cannot find native module`: `./boga ios build-client --force` (iOS),
`./scripts/maestro-android-dev-client-build.sh --force` (Android). Pure-JS and
config-only changes never need it (Metro bundles them at runtime). Cache rules:
spec `11`.

### Full sweep

For production releases, load `docs/runbook-hosted-operations.md` for the required
hosted migration and verification gate alongside the sweep.

`./boga sweep [--ref <ref>]` (`scripts/full-sweep.sh`) runs every gate lane on
`origin/main` or a pushed branch in its own long-lived worktree and slot, writing
a summary under `~/.config/boga/sweep/latest/`. It is never scheduled.

- **Required** on the `main` commit you ship as a release build
  (TestFlight / App Store), before building
  (`apps/mobile/README-LOCAL-DEV-BUILD.md`, `RUNBOOK.md`).
- **Otherwise a suggestion.** `./boga test for` prints a
  *SUGGEST TO THE OPERATOR* sweep line when a diff touches shared UI chrome or
  many screens; pass it on, the operator decides.
- A RED sweep means the ref has a regression the PR gates did not select —
  bisect with `./boga test <lane>`. It needs the machine awake; a lid-closed Mac
  pauses Docker.

## Quality targets (run once before the PR)

Three `extra` lanes hold the mobile app to its quality targets. They sit outside
every gate and outside CI, so nothing runs them for you: run each **once, before
opening the PR**, and list them green in the PR's Tests table. `AGENTS.md` states
the thresholds; this is where they live.

| Lane | Target | Enforced in |
| --- | --- | --- |
| `jest-coverage` | Whole-suite branch + line floor over `app/**`, `components/**`, `src/**` (tests excluded); branches is the tight one | `coverageThreshold` in `apps/mobile/jest.config.js` |
| `complexity` | Per function, same source: cognitive complexity (`sonarjs` — not ESLint's cyclomatic `complexity`, which counts every `?.`/`&&` as a path and flags flat guards; do not swap it back), length (blanks/comments excluded), nesting depth, parameter count | `apps/mobile/eslint.complexity.config.js` |
| `dependencies` | Import direction, same source (dependency-cruiser, type-only included): no cycles, only the layers spec `09` ("Import direction") allows | `apps/mobile/dependency-cruiser.config.cjs` |

- **Grandfathered offenders, shrink-only.** Pre-existing offenders are baselined
  in `apps/mobile/eslint-complexity-suppressions.json` (per file and rule) and
  `apps/mobile/dependency-cruiser-known-violations.json`. A new offender fails the
  lane — and so does a *stale* entry after you fix one, until you prune it:
  `npm run lint:complexity -- --prune-suppressions` / `npm run lint:deps:prune`
  (from `apps/mobile/`), then commit the smaller file.
- **The fix is the code, never the target.** Add tests, split the function, or
  move the code to the layer a rule allows. Lowering a threshold, relaxing a
  rule, or adding a baseline entry needs the operator's agreement, stated in the
  PR's Deviations section.
- **Coverage is global, so run the whole suite.** A scoped
  `npm run test:coverage -- <path>` counts every other file as 0% and always
  fails the floor; scope it only to read the per-file report
  (`coverage/lcov-report/index.html`).

## What CI runs

CI (`.github/workflows/ci.yml`) runs exactly the lanes marked `CI? ✅` above,
installing each workspace from its own lockfile; a docs-only PR runs
`docs-check` alone (`06`, "CI posture"). **Everything else is
local-only** — backend/sync by choice, Maestro iOS/Android by necessity — so
breakage there accumulates on `main` invisibly until a human runs the gate. Run
the slow gate for your area before the PR.

## Maintenance

Changing a gate or lane means updating the registries in the same change:
`scripts/lanes.tsv` (lanes, gate membership, CI flag — then `./boga docs gen`)
and `scripts/triggers.tsv` (path defaults; moving a flow between lanes means
moving its row, which `scripts/tests/test-for.test.sh` enforces). If a fact here
disagrees with the registries or the scripts, **they win — fix the doc.** This
doc owns the lane matrix and CI membership; `06-testing-strategy.md` owns each
test's purpose; `./boga timings` owns durations.

## Deeper docs (load when relevant)

- Adding/changing a lane, or writing an unfamiliar kind of test:
  `06-testing-strategy.md` (per-entry-point catalog, coverage policies).
- Writing or debugging a Maestro flow: `11-maestro-runtime-and-testing-conventions.md`.
- A slot-lease or isolation failure: `12-worktree-config-and-isolation.md`.
- Interpreting a measured duration: `docs/testing/local-test-timings.md`.
