# Testing Strategy

> **Owns:** which test layer proves what, what each lane exists for, and the
> cross-cutting policies that govern lanes. **Not here:** gate ladder, lane
> matrix, CI membership → `02`; durations → `./boga timings`; fixtures and
> authoring mechanics → `docs/specs/writing-tests.md`; Maestro runtime contract
> (resets, artifacts, config, fixture users) → `11`; worktree slots → `12`.
> **Load when:** deciding what kind of test a change needs, or adding or changing
> a test lane.

## Look it up, don't memorise it

| Fact | Source |
|---|---|
| lane → gate, infra, CI, command, cwd | `./boga test --list` (registry: `scripts/lanes.tsv`) |
| changed path → default lanes | `./boga test for` (registry: `scripts/triggers.tsv`) |
| how long a lane takes | `./boga timings` (interpretation: `docs/testing/local-test-timings.md`) |
| what a Maestro flow proves | the flow's own `Proves:` header in `apps/mobile/.maestro/flows/` |
| what a backend lane asserts | its body under `supabase/tests/` |
| whether this machine can run a lane | `./boga doctor` |

Durations are owned by the measured per-run records every `./boga test` lane run
writes to `~/.config/boga/timings/records/`. Cite the reader or re-measure —
never estimate. A run above ~2-3× the recorded median is a signal something is
wrong, not a normal slow run.

## Test layers

Pick the cheapest layer that can prove the claim; each exists because the one
below it cannot reach what it covers.

| Layer | Proves | Tooling / where |
|---|---|---|
| Pure unit | Calculations, formatting, sorting, decision rules — where edge cases are enumerated. | Jest; `apps/mobile/__tests__/**` |
| Screen over real data | A screen with its real queries, caches and hooks, over an in-memory SQLite database built from the shipped migration bundle — so a broken query or stale cache fails here, not only on a simulator. | Jest + React Native Testing Library + `better-sqlite3`, via `apps/mobile/__tests__/helpers/local-data.ts` |
| Backend contract | Real auth context and RLS, RPC wire contracts, SQL functions, constraints — on a local stack, before anything deploys. | `supabase/tests/**`, via `./boga test backend` |
| Cross-stack (no UI) | The real mobile sync cycle against a real endpoint: LWW, multi-device convergence, drift, fresh-device restore, account switch. Emulated storage, no UI. | `sync-infra` → `apps/mobile/__tests__/sync/**` |
| Device e2e | What only a device shows: boot and dev-client launch, navigation stack, deep links, native modules, the on-device `expo-sqlite` runtime, real gestures/keyboard/sheets/scrolling, a real round trip to Supabase. | Maestro + iOS simulator + Expo dev client; `apps/mobile/.maestro/flows/**` |
| Two-user | That data one account produces reaches **another** account's device. | `ios-groups-e2e` — the only lane where two accounts interact |
| Hosted smoke | Environment-only behaviour: secrets/bindings, ingress, hosted auth config, migrations run on the hosted instance. | Manual; no local equivalent |

**A cheap layer is never a substitute for an expensive one when the expensive one
owns the risk.** Two standing cases:

- In-memory SQLite does not prove the *native* runtime: real `expo-sqlite`
  migration plus a smoke write/read is `ios-data-smoke`, and both are required
  for local-data confidence.
- `sync-infra` and `ios-sync-e2e` are not interchangeable. UI gating, NetInfo,
  session handoff and trigger-wiring bugs — the classes that shipped during sync
  v2 — surface only in the device lane.

## Lane design rules

The cheapest-layer rule in *Test layers* above is the first of these, and the
one this suite drifts from fastest. These five keep a lane's cost proportional
to what only that lane can prove.

1. **Name a lane for what it proves**, not for the feature it touches. A name
   that tracks a screen or a domain stops describing the lane's contents the
   first time either moves.
2. **One canonical assertion per fact.** No fact is proved in two lanes. A
   duplicate is invisible — it reads as thoroughness — and costs its full
   runtime on every run.
3. **Quarantine destructive work.** A body that rebuilds the database, stops a
   container, or takes a one-way action with no rollback belongs in an `extra`
   lane routed by `scripts/triggers.tsv`, never in a default gate. Within a
   lane it runs **last**: it leaves no configured baseline for the bodies after
   it, and a body that needs one then fails for a reason that looks nothing
   like the cause. It marks the stack first (`mark_stack_needs_reset`) and
   never resets on exit; the next preflight resets it. Until the local baseline
   is protocol-4 active, groups bodies activate it themselves, after a lane's
   pending bodies; `run-suite.sh --protocol4` lanes keep that mark.
4. **Bodies are chapters; lanes are concepts.** Split a large surface into
   several bodies in one lane for readability. Splitting it into lanes instead
   makes every piece pay the baseline preflight again.
5. **A lane's cost is justified by what only it can prove.** Cost per assertion
   is the signal: an outlier is a design smell to investigate, not a property
   of the subject. Measure with `./boga timings`; never estimate.

Setup is where rule 5 goes wrong in practice. A body that drives the full
production path dozens of times to *reach* the state it asserts on has moved
its cost into setup, where nobody reads it. Seed that state directly, and keep
the real path only where the path itself is under test.

## Default testing practice

- **Jest is always required.** Every code change adds or updates Jest coverage
  for the behaviour it changes; every feature carries at least one success-path
  and one offline/error-path test.
- Two Jest shapes, picked by what is under test rather than by habit: pure
  functions, and screens over the real data fixture. Faking the data layer
  (`jest.mock('@/src/data')` or a repository) in a screen test is the exception,
  for states real data cannot produce — loading, a failed read, a race — and the
  test names that state. New screen tests start on the real-data helper; existing
  fakes move to it when the screen is next changed. Query-only tests against real
  SQL stay where a query has many edge cases of its own (sync, tombstones);
  otherwise the screen test covers the query.
- Run a targeted test or lane after each meaningful change, then
  `./boga test fast` before closeout. Simulator and Docker lanes run as agreed
  with the operator, from the path default (`02`, "Choosing lanes").
- Fixtures and mechanics — the shared in-memory database, device SQLite parity,
  the pinned time zone, hang safety, Maestro flow rules — are in
  `docs/specs/writing-tests.md`. **Load it when you are writing a test.**

## Maestro scope policy

Maestro is the expensive tier. It covers core user journeys and what Jest cannot
reach; everything else is Jest.

- **Device-only reasons.** A Maestro claim must need at least one of the device
  reasons in the Device-e2e row above, or two users. Screen state, copy,
  formatting, conditional rendering, calculated values, and local sorting or
  toggles are Jest.
- **New Maestro coverage needs the operator.** Adding a flow, or a scenario to an
  existing flow, needs a justification (which device-only reason, and why Jest
  cannot prove it) and explicit approval *before* it is written. Removing Maestro
  coverage that Jest now owns does not.
- **Flows state what they prove**, in a header block: `Proves:` (the behaviours
  it asserts), `Why device:` (the reason for each), `Jest counterpart:` (the Jest
  files covering the rest of the feature). Runtime workarounds go below the
  header, next to the steps they explain.
- **Run the minimum** — the lanes whose flows exercise the changed behaviour.

### Every committed flow belongs to a lane

A flow no lane runs is covered by no gate and no CI, so nothing tells you when it
stops matching the app: it rots silently (four of six unlaned flows were
failing when finally run). So a new flow either earns a lane in
`scripts/lanes.tsv` or it is not committed: run it ad hoc from a branch instead
(`RUNBOOK.md`) and delete it. `scripts/tests/maestro-flow-lanes.test.sh` enforces
this in `meta-tests`.

**A new flow does not imply a new lane.** Each standalone iOS lane pays
provision, launch and teardown again, so flows that share an infra shape share a
simulator session via `apps/mobile/scripts/maestro-ios-run-flows.sh` (this is why
`ios-data-smoke` also carries the completion-share and exercise-catalogue flows).

### iOS lane shapes

Every iOS lane runs the **same** dev-client build in one of two deliberately
exclusive configurations, selected by whether the app sees
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`:

- **infra-free** (`ios-smoke`, `ios-data-smoke`, `ios-exercise-page`,
  `ios-session-view`): no Supabase. The app runs local-only with the
  login-on-start gate disabled, which keeps these lanes fast and focused on the
  local SQLite runtime — and lets `ios-data-smoke` prove a backend-less build
  seeds its own starter exercise catalog at boot.
- **Supabase-backed** (`ios-auth-profile`, `ios-sync-e2e`, `ios-groups-e2e`): a
  local stack is provisioned first, so login-on-start, fixture sign-in and sync
  are really exercised.

The selection is driven by `apps/mobile/.env.local`, which the runner pins per
lane and restores afterwards. The mechanism is owned by `11`; **do not hand-edit
`.env.local` to switch a lane.**

### What each iOS lane is for

| Lane | Exists to prove |
|---|---|
| `ios-smoke` | A freshly installed dev client cold-launches intact: Today, the four tabs, Train's Start opening an empty session view. The cold-start lane — real tab navigation, no teleport. |
| `ios-data-smoke` | Real `expo-sqlite` migration + write/read on the native runtime, backend-less catalog seeding, a workout logged through Train and read back through Progress’s pinned By Exercise switch; native history header snap-back/dismissal and independent chart scrolling; plus the native share sheet and catalogue editor. |
| `ios-exercise-page` | The exercise page's device claims: history push and native back, a set committed on the keyboard. |
| `ios-session-view` | The session view's: resume, card → exercise page → back, gym sheet and Gyms, picker sheet, finish/abandon. |
| `ios-auth-profile` | The real login/profile happy path: login-on-start enforcement, first-sync gate, Connected agents grant list, username update, sign-out. |
| `ios-sync-e2e` | First sign-in on an empty server seeds and pushes; a device-entered reading drains to 0 pending through the scheduler's own cycle; a full wipe + re-sign-in pulls it back instead of re-seeding. |
| `ios-groups-e2e` | Group data crossing accounts as a device shows it: keyboard forms, focus refresh, the friend view's native back, the record sheet, the native remove alert. |

Rules these lanes run under:

- Reset strategy is pinned per lane by the runner (taxonomy: `11`). Prefer
  `data`; `full` only where install or true cold-start behaviour is part of the
  claim — which is why the three Supabase-backed lanes and `ios-smoke` use it.
- A lane that saves a username uses a **per-run** one, so repeated runs keep
  exercising the save path.
- A lane whose claims depend on server state resets its own fixtures with the
  service role first (`supabase/scripts/sync-e2e-fixture-reset.sh`,
  `supabase/scripts/groups-fixture-reset.sh`), so repeated runs in one slot need
  no Supabase reset. **A Supabase-backed lane must pass twice in a row.**
  Credentials come from `supabase/scripts/auth-fixture-constants.sh`, one
  dedicated user per sign-in flow (rule and enforcement: `11`).
- `ios-groups-e2e` drives its second user over HTTP from Maestro `runScript`
  (`apps/mobile/.maestro/scripts/`) with the same RPCs its app would call — one
  simulator, no second device. Its scope is a *thin* pass of the device-only
  surface: server rules belong to `groups-contract` / `groups-leaderboards` /
  `groups-competitions`, and
  every call of the groups client against the live server to `groups-api-live`.
  Offline and airplane mode are out of scope — simulator networking cannot be
  toggled reliably, so offline is proven in Jest.
- Evidence for every iOS lane: the command result plus the run's artifact root
  and screenshots (artifact contract: `11`).

### What each backend lane is for

Bodies and commands are in `scripts/lanes.tsv`; these are the ones whose purpose
the name does not give away.

| Lane | Exists to prove |
|---|---|
| `backend-fast` | Runtime up + reset (migrations + seed) + schema lint + health endpoint + deterministic seed fixtures. The backend half of the fast gate. |
| `auth-authz` | Real auth context and RLS: owner success, cross-user denial, validation and unauthorized paths. |
| `groups-contract` | The group domain rules of `docs/specs/tech/groups-contract.md`: the share ledger across join/leave/rejoin, protocol-4 stream, session detail and group exercises, edit/tombstone flow-through, share-trigger failure isolation, and the membership RPC matrix including error tokens and direct-PostgREST denial. |
| `groups-leaderboards` | The evaluator: boards, certification, bodyweight (pending), then facts, targets, fault isolation and the week summary (protocol 4); direct-drain mode makes Edge assertions deterministic. |
| `groups-competitions` | `docs/specs/tech/group-competition-contract.md` on protocol 4: authorization, payload privacy, the correction matrix, write tokens, publication fences, and stored pre-protocol-4 history. |
| `groups-api-live` | The app's own groups client (`apps/mobile/src/groups/api.ts`) against the live server, so a drifted RPC name, parameter or response shape fails here instead of on a device. |
| `groups-protocol4` | The one-way competition cutover: the populated pre-cutover→protocol-4 upgrade, plus the client's protocol-4 wire. `extra`, not in `boga test backend`: it resets the stack to an old migration, so the next preflight rebuilds it. `boga test for` prints it. |
| `sync-drift` | Client Drizzle schemas vs the introspected server schema: indexes, triggers, RLS policy inventory and body hashes, soft-delete and sync columns, topological FK order. `--strict` promotes warn-only to failure. It resets the local database itself, so it is the gate's single positive drift check — `sync-v2-e2e` proves only the negative (synthetic drift) case. |
| `sync-v2-e2e` | Integration assertions across the as-built stack, including push→pull parity over every data-scope entity and tombstone visibility. Its drift body proves only the checker's CLI wiring, with no database reset: synthetic drift fails the run, and the mutated file is restored byte-exactly. |
| `sync-infra` | The cross-stack layer above — the one lane whose body is frontend and whose infra is backend. Runs last in the backend gate. |
| `mcp-smoke` | Protocol-to-data proof for the MCP service: OAuth/PKCE consent, tool discovery and calls, returned fixture ids, account-data exclusion, artifact cleanup. |
| `dev-wipe-my-data` | The developer-only RPC's guards: auth, non-production environment, owner-scoped deletion only. |

Required coverage by surface: policy, SQL-function and constraint changes need
DB-level tests; Edge Functions need runtime-native unit tests *and* local
contract tests; a mostly-PostgREST/RPC surface can have a thin unit surface
compensated by stronger DB and contract coverage. Every contract suite covers
success, validation failure, unauthorized and cross-user denial — for
`auth.users`-keyed profile tables, owner success plus cross-user denial; for
operational tables like `public.app_logs`, authenticated insert plus client-side
read/update/delete denial.

## Local Supabase baseline contract

Applies to every lane that hits a running stack rather than a mocked client.

- **Enforcement:** `supabase/scripts/ensure-local-runtime-baseline.sh` runs
  before any real-instance lane (the wrappers call it). Runtime down → start,
  reset/seed, provision fixtures. Runtime up → reuse as-is with **no reset**
  (a marked or protocol-4-active stack is reset),
  refresh stale Edge Function routing, apply pending migrations, verify baseline
  rows, re-provision fixtures idempotently.
- **Once per gate:** `./boga test <gate>` exports one `BOGA_GATE_RUN_ID`. The
  full path ends by stamping it in `public.local_runtime_bootstrap_markers`
  with a hash of its inputs (migrations, seed, fixture constants) and one of the
  state it repaired (applied migrations, fixture principals and auth users, the
  group-eval kick URL). A later lane of that gate still checks reachability and
  Edge routing, then skips the repairs only while the stamp and both hashes
  match. A reset truncates the stamp (`seed.sql`) and any changed hash means
  the full path, so a skip never rests on unchecked state. A lane run by name
  has no gate id and always runs the full path
  (`scripts/tests/baseline-stamp.test.sh`).
- **Expected baseline:** the stack is reachable and
  `public.dev_fixture_principals` holds at least `anonymous`, `user_a`, `user_b`,
  provisioned with the known credentials.
- **Data-shape contract:** baseline rows must exist, but **extra rows are
  allowed**. A suite must not assume empty tables beyond the baseline and must
  use per-run unique entity IDs, so repeated runs in one slot cannot collide.
- **Parallel runs:** bootstrap is serialised per worktree by a lock in the
  baseline script, and each worktree owns its own stack, one Metro port and one
  simulator target (`12`). Avoid manual destructive operations (`db reset`, stack
  restart) in a slot another suite is using; a suite that looks like it hit the
  wrong instance is a `./boga worktree doctor` question. Every local gate
  requires this worktree's slot lease (`AGENTS.md`), and no gate cleans up after
  another worktree.

## CI posture

`.github/workflows/ci.yml` runs the infra-free lanes only (the `CI?` column of
the lane matrix in `02`). A PR that changes only `docs/**` or root-level `*.md`
runs `docs-check` alone; every later step is skipped in the same job, and push
to `main` always runs everything. `scripts/ci-docs-only.sh` owns that rule and
`scripts/tests/ci-docs-only.test.sh` pins it — a doc that a test or script
reads at runtime must live outside `docs/`. The one exception is
`docs/product/`, whose fact tables Jest runs: a change there runs everything. Two consequences are policy, not
trivia:

- **"Not in CI" means you run it here.** This machine boots the iOS simulator and
  local Supabase; `./boga doctor` proves it. Never record a slow lane as
  "deferred" because the simulator or Docker is "unavailable". For work CI does
  not cover, the verification record states what ran locally, which slow lane the
  change triggered, and what is *genuinely* deferred (hosted smoke, which has no
  local equivalent).
- **Breakage on a local-only lane accumulates on `main` invisibly** until a human
  runs it. CI's one safety net across the restyle boundary is the
  `maestro-testids` meta-test: every Maestro `id:` selector must still exist in
  app source, so renaming an id a flow taps fails on the PR even when that flow's
  lane was not required (UIKit's own ids, e.g. `BackButton`, are exempt).

When CI coverage expands, update this doc and `02` in the same change.

## Per-feature coverage policies (colocated with the tests)

Per-feature policies live in the README of the test directory they govern — read
it when editing tests there (rule in `AGENTS.md`):

- `apps/mobile/__tests__/sync/README.md` — sync integration coverage (cycle,
  cursors, dirty bits, quarantine, `AUTH_REQUIRED`, reinstall re-pull, and the
  UI↔server e2e requirement).
- `apps/mobile/__tests__/README.md` — GPS gym-location, exercise-tag, auth
  bootstrap and profile-management coverage.

This doc keeps only the cross-cutting policies above.
