---
task_id: M24-T03-Exercise_PR_celebration_and_sharing
milestone_id: "M24"
status: completed
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M24-T03 — Exercise PR celebration and sharing

## Task metadata

- Task ID: `M24-T03-Exercise_PR_celebration_and_sharing`
- Status: `completed`
- Depends on: `M24-T01`, `M24-T02`

## Parent references

- Milestone: `docs/plans/milestones/M24-current-session-insights-and-pr-celebration.md`
- UX/UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- Recorder layout: `apps/mobile/app/(tabs)/session-recorder.tsx`,
  `apps/mobile/components/session-recorder/session-content-layout.tsx`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Turn the recorder's existing PR line into an unmistakable, exercise-specific
celebration that remains accurate as sets change and is easy to screenshot or
share.

## Scope

### In scope

- Replace recorder-local PR arithmetic with T01's shared helper.
- Upgrade expanded and collapsed exercise-card PR presentation while retaining
  the exercise name, best set, and rounded estimated 1RM.
- Add an accessible `Share PR` action to the expanded card using the built-in
  React Native platform share boundary and a stable text payload.
- Handle multiple PR exercises independently and share launch success, cancel,
  and failure without changing recorder data.

### Out of scope

Completion presentation, generated image files, social-network integration,
deep links, certification, first-ever-as-PR, and persisted achievements.

## UX Contract

### Key user flows

1. **Earn and retain a PR**
   - Trigger: confirm a valid set whose estimated 1RM strictly exceeds the
     exercise's prior completed-history maximum.
   - Steps: the owning exercise card shows `New PR` in expanded and collapsed
     states.
   - Success outcome: the accomplishment remains visible while the qualifying
     work remains in the active session.
   - Failure/edge outcome: equal/below-best/no-baseline work shows no PR; editing,
     unconfirming, or deleting the qualifying set removes it immediately.
2. **Share a PR**
   - Trigger: expand the exercise card and tap `Share PR`.
   - Steps: the platform share sheet opens with exercise, load, reps, and
     estimated 1RM text.
   - Success outcome: the user can choose a destination and returns to the same
     recorder state.
   - Failure/edge outcome: cancellation is silent; launch failure is concise,
     inline, retryable, and does not mutate the session.

### Interaction + appearance notes

- Celebration is prominent but stays inside the exercise card; it must not look
  like a session-wide metric.
- The full PR fact line fits or wraps accessibly on the smallest supported phone
  and remains visually complete for a screenshot.
- Keep the collapsed title toggle free of nested interactive controls; sharing
  is available from the expanded card and later from the completion hero.
- Reuse shared success colors, surfaces, type, buttons, and feedback patterns.
- `Share PR` has a precise accessibility label including exercise name.
- Do not add a PR tab, modal history browser, badge persistence, or raw colors.

## Acceptance criteria

1. Recorder PR visibility exactly matches T01 output in expanded and collapsed
   exercise-card states.
2. PR state survives unrelated recorder edits and disappears on qualifying-set
   reversal without stale frames.
3. Two PR exercises can render and share independently.
4. Share payload values match the visible PR card and never include credentials,
   private metadata, or an invented public URL.
5. Share cancel is a no-op; share failure is accessible and retryable.
6. Existing Past Records interactions, set editing, collapse, autosave, and
   submission remain unchanged.
7. Tokens/primitives and no-raw-color rules pass.
8. UI docs describe strict PR criteria, exercise scope, persistence/reversal,
   and sharing.

## Docs touched

- UI docs update required: **yes**.
  - `docs/specs/ui/screen-map.md`: upgraded expanded/collapsed PR state.
  - `docs/specs/ui/components-catalog.md`: reusable PR card/line/share boundary.
  - `docs/specs/ui/ux-rules.md`: strict PR, exercise scope, reversal, and sharing.
- `docs/specs/ui/navigation-contract.md`: no update; platform share is not an
  app route.
- Tokens/primitives reuse: existing success surface/text and shared actions;
  exceptions none planned.
- Required captures: no-PR, expanded PR, collapsed PR, two-PR exercises, share
  launch, and share-error state on small and large phone viewports.

## Testing and verification approach

- Add pure/helper and recorder RNTL coverage with the share API mocked.
- Extend the M24 Maestro path through PR reveal and safe share-sheet return; do
  not send content externally.
- Run `./boga test fast` and `./boga test frontend` before PR.
- Run `./boga test for --diff origin/main`; use only measured gate durations.

## Evidence

- Focused Jest/RNTL passed 50 tests across `session-insights.test.ts` and
  `session-recorder-interactions.test.tsx`, covering stable payload formatting,
  share cancellation, native launch failure/retry, strict/tied/no-baseline
  classification, immediate qualifying-set reversal, and two independently
  rendered/shared PR exercises.
- Final `./boga test fast` passed: lint/typecheck, 124 Jest suites (1,245
  tests), backend-fast, docs/meta, agent-auth-web, and MCP unit lanes.
- Final `./boga test frontend` passed all five iOS lanes. Artifact roots:
  `apps/mobile/artifacts/maestro/M24-T03-final/20260912-182236-61297`,
  `20260912-182320-62431`, `20260912-182452-63943`,
  `20260912-182630-65524`, and `20260912-182827-67308`.
- The extended history-backed PR scenario passed on the configured 402x874 pt
  phone and a temporary 375x667 pt iPhone SE simulator. Expanded, collapsed,
  two-PR, retryable-error, platform-share-sheet, and no-PR captures are under
  `apps/mobile/artifacts/maestro/M24-T03/20260912-181044-54140/maestro-output/screenshots/`
  and
  `apps/mobile/artifacts/maestro/M24-T03-small/20260912-181851-57633/maestro-output/screenshots/`.
  The native sheet was dismissed by its standard downward gesture without
  selecting a destination.

## Completion note

- What changed: replaced recorder-local PR arithmetic with the shared T01
  helper; added a tokenized expanded/collapsed exercise celebration, stable
  platform-text sharing, silent cancellation, inline retryable launch failure,
  independent multi-exercise handling, and a developer-only one-shot Maestro
  share-failure control for deterministic evidence. Updated the history-backed
  Maestro path and canonical UI docs.
- What tests ran: focused Jest/RNTL, `./boga test fast`, `./boga test frontend`,
  and the extended PR Maestro scenario on large and small phone viewports.
- What remains: M24-T04 and M24-T05.
