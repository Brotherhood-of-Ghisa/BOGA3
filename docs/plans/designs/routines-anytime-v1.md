# Routines mock v1 — proposed, not accepted

Build input for the anytime-routines task. Delete this brief and its HTML mock
when the implementation ships. No production UI has been implemented.

## Artifact and review scope

- Prototype: `docs/plans/designs/routines-anytime-v1.html`.
- Rendered evidence: `apps/mobile/artifacts/routines-anytime/v1/` (gitignored).
- Normal phone: 390 × 844 pt; small phone: 320 × 700 pt.
- Acceptance: **changes requested** by the operator on 2026-11-06. Explicit
  response: “Request revisions”. The operator subsequently clarified that
  Routine is a property of the same plan, enabled with a tick in the current
  creation card. V1's separate framing and destructive conversion are rejected.
  Revised plan/mock: `docs/plans/designs/routines-anytime-v2.md`. V1 is preserved
  as rejected history and must not guide implementation.

The HTML is a presentation mock, not an Expo screen or production component.
Its labels, source-derived colours, font files and geometry follow the current
mobile design vocabulary. Native controls and system chrome are represented
for review; running-native comparisons are required after implementation.

## Pattern selection proposal

Recommend the existing plan composition: Card + ListRow `density="list"`,
SwitchRow `density="list"`, ActionButton primary/outline, FormField, Notice and
Sheet. These are existing production exports in the components catalog. This
is a `custom` composition of catalog primitives, with no promoted-template
claim. ListCard/compact ListRow would change existing plan-row density and are
unnecessary for this task. No shared typography, density or component API change.

The bounded delta is a Routines section, one Routine switch in the shared plan
editor, outcome metadata in existing rows/detail and Start/Resume + Skip in
routine detail. No explanatory subtitles or footnotes in product screens.

## Proposed product choices — operator decision pending

1. **Conversion.** Save with Routine enabled clears the scheduled date and
   detaches programme membership. If either exists, confirm those consequences
   explicitly before committing. Preserve the same plan identity, original
   blocks, prior consumption, completed workouts and their links. The routine
   appears once in Routines and does not enter Today, ordinary planning queues
   or the append-block picker. The original programme loses that child once;
   subsequent routine uses cannot change its progression. This is an explicit
   detach, not an implicit skip/completion of the removed child.
2. **Historical dates.** Seed outcomes from qualifying linked completed workouts
   and explicit all-skipped source outcomes only. Use recoverable completion or
   block-resolution instants, never updatedAt/createdAt as an invented date.
   Known legacy outcomes with no timestamp retain their wording and show Date
   unavailable. A partial previous workout can establish Last completed even
   when the original ordinary plan still had pending blocks.
3. **Qualifying finish.** At least one confirmed source-derived routine set
   awards Last completed when its workout finishes; manual-only work and an
   empty Finish do not. Preserve existing recorder cleanup and empty-workout
   handling. No unperformed block is automatically skipped. Abandon leaves
   both outcome dates unchanged.
4. **Turn off.** The same Edit switch removes future routine availability;
   restore ordinary unscheduled-plan visibility according to its original
   consumption state. Do not restore an old date/programme automatically.
   Any active use can still be resumed/finished; history and use records survive.
   Re-enabling restores reuse and its known dates.
5. **Correction, deletion, Undo.** Completion dates are derived from surviving
   qualifying completed workouts: a date correction moves the outcome, deletion
   removes it and Undo restores it. If correction removes all qualifying work,
   that workout ceases to award completion. Keep explicit skip uses independent
   of performed history. The first version has no standalone skip-date editor
   or skip-history UI; cancelling its confirmation writes nothing.
6. **Offline/concurrency.** Start and Skip are idempotent within the same next
   use, across repeated taps/retries and two devices. An active same-routine use
   resumes; another active workout blocks Start. Start racing Skip must never
   discard entered work; any converged active/performed use takes precedence
   over a skip for that use. Stale definition saves refuse and retain typed
   input with a local conflict message. Any conflict recovery preserves actuals.

Product facts to graduate: reusable intent independent of use progress;
partial-use completion allows a full fresh start; explicit skips produce no
workout/figures. Narrow the existing planner facts to consumable ordinary
plans/programmes and state the separate routine-use outcome rule.

## Technical findings and proposed direction

Freshness base: `a941bf6e` (merged planning PR). Existing consumed block locks,
source uniqueness and deterministic IDs match the task's assumptions. Current
completed-plan support is present and must remain intact.

Recommend **separate synced use identity**, with normal performed rows carrying
per-use provenance and their already-supported snapshots of names/targets.
Keep ordinary-plan uniqueness and consumed locks intact. Routine definition
edits must not reset consumed source state or rewrite performed snapshots.
Availability is independently editable, including on attached/completed plans.

Before coding, finish the schema/concurrency design against the sync contract:
owner-scoped uses, fresh identity across uses and deterministic arbitration
within one use, terminal outcome/date sources, migration parity, old-client
reader/writer compatibility, FK topology, account wipe and group exclusion.
The mock does not imply that generic LWW alone can enforce Start/Skip safety.

## Review sets

- Core: Sessions among existing sections; Edit on an already completed plan;
  idle routine detail.
- Outcomes: never used, completed, latest skip.
- Active: Resume, unrelated active-workout guard, explicit Skip confirmation.
- Authoring: new-plan Routine choice, saving, save failure retaining input.
- Sequence: two of four exercises performed → Finish → all four fresh on Start.
- Edges: long titles at both widths, legacy date unavailable, read failure.
- Conversion: scheduled programme child confirmation, removing availability,
  zero-confirmed-work Finish using existing cleanup.
- Loading: first read, empty section, failed Skip with unchanged dates.
- Future edits: editable used Routine with stale-save feedback, unchanged
  targets in an active use, and revised targets in the next use.

Rendered all nine sets at both widths (18 gallery captures). The browser
self-check found no page-script errors or horizontal content overflow. The
mock's partial-use/fresh-start and Skip/Abandon examples passed their assertions.
Evidence is `render-check.json` beside the captures. This verifies the mock
only; it does not verify persistence, accessibility in React Native or sync.

After acceptance, freeze v1 as the build input; do not adjust it to match the
implementation. Material layout/interaction changes need renewed acceptance.

## Gates after implementation

Run `./boga test for` on the actual production diff and agree the lane set with
the independent reviewer. Expected fast + backend + ios-sync-e2e and only
frontend flows that exercise changed surfaces. Also jest-coverage, complexity
and dependencies; real-data lifecycle/sync coverage, independent code/product
reviews, native screenshot comparison at both widths, running-UI human
acceptance, PR and green CI. No gate has been claimed from this mock.
