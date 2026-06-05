---
# Minimal machine-readable task metadata
task_id: T-20260605-01-fix-first-sync-gate-offline-on-launch
milestone_id: "M13"
status: planned
ui_impact: "no"
areas: "frontend"
runtimes: "expo|maestro|supabase"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "none (confirm at closeout)"
---

# Task Card

## Task metadata

- Task ID: `T-20260605-01-fix-first-sync-gate-offline-on-launch`
- Title: Fix first-sync gate falsely reporting "offline" on launch (auth-profile lane red)
- Status: `planned`
- File location rule:
  - author active card in `docs/tasks/T-20260605-01-fix-first-sync-gate-offline-on-launch.md`
  - move to `docs/tasks/complete/` when `Status` becomes `completed` or `outdated`
- Session date: 2026-06-05
- Session interaction mode: `interactive (default)`

## ⛔ Required working mode: PLAN FIRST, then implement

**Do not write any fix code until the user has signed off on an approach.**

1. **Enter plan mode.**
2. **Explain the bug to the user in plain language** — what the user sees, why it
   happens, and where in the code it originates (cite files + lines). Use the
   evidence in this card as your starting point but verify it yourself; do not take
   the root-cause hypothesis below as proven.
3. **Discuss the solution** — present 2-3 candidate fixes with trade-offs (see
   "Candidate directions" below as a seed, not a decision), and your recommendation.
   Surface the open questions in this card and get answers.
4. **Get explicit user sign-off on the chosen approach** (ExitPlanMode), then
   implement.

The point of this card is a deliberate, discussed fix — not a fast patch.

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Maestro runtime/testing contract: `docs/specs/11-maestro-runtime-and-testing-conventions.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Architecture (sync model): `docs/specs/03-technical-architecture.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `<fill at session start>`
- Start-of-session sync completed per playbook git sync workflow?: `<yes|no|N/A>`
- Parent refs opened in this session (list exact files actually reviewed):
  - `<path>`
- Code/runtime inventory freshness checks run:
  - `<check>` - `<result/date>`
- Known stale references or assumptions (must be explicit; write `none` if none):
  - **Prior art / coordination:** at authoring time the repo's primary checkout
    was on a branch named `fix/first-sync-gate-online-and-signin-sync` (NOT merged
    to `main` as of HEAD `3ddc5d0`). **Before designing a fix, inspect that branch**
    (`git log`/`git diff origin/main...fix/first-sync-gate-online-and-signin-sync`)
    to see whether the fix already exists or is in progress, and reconcile rather
    than duplicate. If that branch already fixes this, the task may reduce to
    landing/verifying it and this card becomes `outdated`.

## Objective

The signed-in iOS lane `npm run test:e2e:ios:auth-profile` is **red on `main`
HEAD**. The first-sync gate (`SyncGate`) renders its **offline** branch ("You are
offline. We will keep setting up your data as soon as you are back online.")
immediately after sign-in on a freshly-booted simulator, instead of the
in-progress activity indicator. Make the gate correctly reflect that the device is
online and a first sync is in progress, so the lane passes deterministically — and
so real users on a connected device never see a false "offline" first-run screen.

## Evidence (observed 2026-06-05, HEAD `3ddc5d0`, clean worktree == `origin/main`)

- Lane: `npm run test:e2e:ios:auth-profile`.
  - `launch-requires-sign-in` flow → **PASS** (3/3 runs).
  - `sync-gate-first-cycle` flow → **FAIL** (3/3 runs, deterministic, not flaky):
    `Assertion is false: id: sync-gate-activity-indicator is visible`.
- Failure screenshot shows the gate block with heading "Setting up your data…",
  phase label "Preparing…", and the offline message — with full WiFi in the sim
  status bar. (Captured under
  `apps/mobile/artifacts/maestro/ad-hoc-timing-auth/<ts>/maestro-output/…/screenshot-❌-…-(sync-gate-first-cycle).png`;
  artifacts are gitignored, so re-capture in-session.)
- Flow: `apps/mobile/.maestro/flows/sync-gate-first-cycle.yaml` asserts, after
  sign-in, `sync-gate-block` + `sync-gate-phase-label` (both pass) and then
  `sync-gate-activity-indicator` (fails).

## Root-cause hypothesis (verify; do not assume)

- `apps/mobile/src/sync/SyncGate.tsx` (~L121-142): the gate renders **either** the
  offline message **or** the activity indicator, keyed on
  `progress.offline`. Offline ⇒ no `sync-gate-activity-indicator`.
- `apps/mobile/src/sync/scheduler.ts`:
  - `getSchedulerStatus()` (~L496) sets `progress.offline = !onlineProjection`.
  - `onlineProjection` initializes to `false` (~L85, reset ~L421) and only flips
    `true` when NetInfo's async `isInternetReachable === true` projection arrives
    (`handleNetInfoState`, ~L359-367).
- On a freshly-booted sim + just-started Metro, NetInfo's `isInternetReachable`
  reachability probe has not resolved to `true` by the time the gate first renders
  after sign-in, so the gate shows offline. The probe may resolve slowly, report
  `null`, or (worth confirming) never resolve `true` in this sim/network harness.

Open questions to resolve in plan mode:
- Is `isInternetReachable` genuinely unreliable on the simulator (so the gate
  should treat `null`/pending differently), or is it a pure first-render race that
  resolves shortly after?
- Should "online" derive from `isInternetReachable`, fall back to `isConnected`, or
  treat "unknown/pending" as **not-offline** until proven offline (optimistic) so a
  first cycle is attempted rather than parked behind an offline screen?
- Does the production user (real device) hit the same false-offline first-run
  screen, or is it sim-only? (Decides whether this is a product fix or a test-harness
  fix — strongly prefer a product fix if real users can see it.)

## Scope

### In scope

- Correcting how the first-sync gate / scheduler determine online vs offline at
  launch so an actually-connected device does not park on the offline screen.
- Making `sync-gate-first-cycle` (and the rest of the `auth-profile` lane) pass
  deterministically.
- Unit coverage for the online/offline projection decision (including the
  unknown/pending-reachability case).

### Out of scope

- Redesigning the gate's visual/UX (tokens, copy, layout) beyond what the fix
  requires.
- Broader sync-protocol / cursor / push-pull changes.
- The orphaned-worktree Supabase port-collision sweep gap (track separately).

## UI Impact (required checkpoint)

- UI Impact?: `no` (UI-adjacent)
  - The `SyncGate` component is touched, but the intended UI is unchanged — the fix
    makes the existing in-progress indicator show when it should, instead of a
    false offline message. No new routes/tokens/primitives. If the chosen approach
    changes gate copy or adds a state, re-evaluate and add the UI sections.

## Acceptance criteria

1. Root cause is confirmed (not just hypothesized) and explained to the user, with
   the chosen fix approach signed off in plan mode before implementation.
2. On a connected host, `npm run test:e2e:ios:auth-profile` passes **all** flows
   (`launch-requires-sign-in`, `sync-gate-first-cycle`, `settings-sync-status`,
   `auth-profile-happy-path`) — re-run at least 3x to show it is deterministic, not
   flaky.
3. A genuinely offline device still correctly shows the offline branch (the fix
   must not simply hard-code "online" / delete the offline path).
4. Unit coverage exercises the online/offline/unknown projection decision.
5. `./scripts/quality-fast.sh frontend` is green (lint + typecheck + jest), and
   `npm run test:handles` shows no leaked handles.
6. If behavior of the offline/online sync semantics changes in a way that is part
   of the shared contract, the relevant project-level docs (`03`, `06`, and the
   sync-coverage policy) are updated in the same session.

## Candidate directions (seed for discussion — NOT a decision)

- **A. Optimistic-until-proven-offline:** treat unknown/pending reachability as
  not-offline, so the first cycle is attempted; only show offline on a confirmed
  offline signal or a cycle network failure.
- **B. Seed the initial projection from NetInfo.fetch():** await an initial
  `NetInfo.fetch()` (or use `isConnected` as a fallback) so `onlineProjection`
  isn't stuck `false` until the first event.
- **C. Distinguish "checking connectivity" from "offline":** add a short
  pending/grace state so the gate shows the working indicator (or a neutral
  "Preparing…") rather than the offline message during the reachability probe.

Each has trade-offs for real offline users, flakiness, and complexity — weigh them
with the user in plan mode.

## Docs touched (required)

- Planned: `none` expected for a pure projection-logic fix. **Reassess at closeout**
  — if offline/online sync semantics become a shared-contract change, update
  `docs/specs/03-technical-architecture.md` and `docs/specs/06-testing-strategy.md`
  (sync integration coverage policy) in the same session.

## Testing and verification approach

- Planned checks/commands:
  - `./scripts/quality-fast.sh frontend`
  - `npm run test:handles` (targeted, e.g. `-- sync`)
  - `cd apps/mobile && TASK_ID=T-20260605-01 npm run test:e2e:ios:auth-profile` (3x)
  - Local Supabase baseline first: `./supabase/scripts/ensure-local-runtime-baseline.sh`
    (Docker required; lane self-bootstraps a local stack via `npx supabase`).
- Test layers: unit (scheduler/gate decision) + E2E (auth-profile Maestro lane).
- Slow-gate triggers: this change alters auth-gated first-sync/online behavior →
  `./scripts/quality-slow.sh frontend` is REQUIRED, plus the standalone
  `auth-profile` lane re-run 3x.
- CI/manual posture: the iOS Maestro lanes are NOT in CI — this fix MUST be proven
  locally with evidenced green runs in the PR (see `AGENTS.md` → "Testing is not
  optional").
- Env note: on this machine Java is provided by SDKMAN
  (`/Users/<user>/.sdkman/candidates/java/current`), NOT Homebrew OpenJDK. Do NOT
  set `JAVA_HOME=/opt/homebrew/opt/openjdk` (dead path — it breaks Maestro's
  launcher); leave `JAVA_HOME` unset (Maestro finds Java on `PATH`) or point it at
  the SDKMAN dir.

## Implementation notes

- Likely files: `apps/mobile/src/sync/scheduler.ts`,
  `apps/mobile/src/sync/SyncGate.tsx`, `apps/mobile/src/sync/progress.ts`, and the
  matching unit tests under `apps/mobile/app/__tests__/` (e.g. sync scheduler /
  gate-decision suites). Confirm during planning.
- Constraints: keep the local-first invariant — a real offline device must still
  surface the offline branch, and logging/sync must never block app flows.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend` (REQUIRED here) +
  `npm run test:e2e:ios:auth-profile` re-run 3x to prove determinism.
- Optional closeout helper: `./scripts/task-closeout-check.sh <task-card-path>`

## Completion note (fill at end)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` and move the card to `docs/tasks/complete/` when done.
- Fill the completion note before handoff.
- If shared-contract sync behavior changed, update `03` / `06` in the same session.
- Paste the evidenced green `auth-profile` (3x) + `quality-fast`/`quality-slow`
  output into the PR.
