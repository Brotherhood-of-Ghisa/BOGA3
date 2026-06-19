# Recorder History UX Improvements

## Status

Completed in the current PR.

## Context

The recorder history comparison currently exposes two different weak ideas:
visible `rm` buttons for removable set rows, and a capped `Past blocks` panel
that presents "previous" history without a clear max scope. This task replaces
both with a cleaner mobile interaction model.

## Goal

Improve the recorder history/set-row UX with one consistent historical dataset:
all available completed, non-deleted history for the exercise by default. Max
values in the panel must derive from the same records the user can swipe
through.

## UX Contract

### Flow: Stats History Toggle

- Trigger: user views `Stats / History`.
- Steps: the user toggles between muscle and exercise history modes.
- Success outcome: the chip keeps a stable size and `By Exercise` remains on one
  line.
- Failure/edge outcome: longer chip text shrinks within the stable chip instead
  of wrapping or resizing the header row.

### Flow: Swipe Delete Set

- Trigger: user wants to remove a removable set row in `session-recorder`.
- Steps: user swipes left on a compact or editable removable set row.
- Success outcome: the row is removed through the existing
  `removeSetFromExercise` mutation path.
- Failure/edge outcome: planned target rows still show `Skip`; they do not expose
  delete as a competing action.

### Flow: Past Records Review

- Trigger: user taps a logged exercise card's `Past Records` bar.
- Steps: panel expands below tags, shows metric label / selected record date /
  `Current` / `Max`, and left/right swipes change the selected record.
- Success outcome: current values update live from unsaved sets, selected record
  values and current values use `uiColors.heatmapBucket4` when they tie or beat
  max as applicable, and max values come from the same loaded records.
- Failure/edge outcome: empty/error messages appear only after expansion, and
  tapping the collapsed bar while a set row is editable collapses that row first
  without opening or hydrating another row.

## Acceptance Criteria

- User-facing `Past blocks` copy is replaced with `Past Records`.
- `Past Records` loads all available completed non-deleted exercise history when
  no numeric limit is supplied.
- Optional numeric limits remain supported for tests/future callers.
- The panel has no visible `<<` / `>>` controls.
- Swipe left/right navigates historical records.
- Metric rows remain `Est. 1RM`, `Volume`, `Highest`, and `Near failure`.
- Historical values are PR-highlighted when they equal `Max`.
- Current unsaved values are PR-highlighted when they meet or beat `Max`.
- Compact and editable removable set rows delete via left swipe, not a visible
  `rm` button.

## Docs Plan

- Update `docs/specs/ui/ux-rules.md` for Past Records and swipe-delete
  semantics.
- Update `docs/specs/ui/screen-map.md` for the renamed/redesigned recorder
  section.
- Do not update `docs/specs/08-ux-delivery-standard.md`; this is task-local
  recorder behavior, not a reusable app-wide UX pattern yet.

## Gate Plan

Required by the UI/app-code path triggers:

```bash
./boga test fast
./boga test frontend
```

## Evidence

- Targeted Jest:
  `npm test -- --runTestsByPath app/__tests__/exercise-block-history.test.ts app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-submit.test.tsx --runInBand`
  passed: 3 suites, 44 tests.
- `./boga test fast` passed:
  - lint completed with existing warning-level findings only,
  - typecheck passed,
  - Jest passed: 98 suites, 865 tests,
  - backend-fast local runtime smoke passed,
  - docs-check and meta-tests passed.
- `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true ./boga test frontend`
  passed:
  - `ios-smoke`: `apps/mobile/artifacts/maestro/ad-hoc/20260619-170708-25221`
  - `ios-data-smoke`: `apps/mobile/artifacts/maestro/ad-hoc/20260619-170758-26149`
  - `ios-auth-profile`: `apps/mobile/artifacts/maestro/ad-hoc/20260619-170905-27410`
  - `ios-sync-e2e`: `apps/mobile/artifacts/maestro/ad-hoc/20260619-171027-28747`

## Completion Note

Implemented the `Past Records` recorder redesign, swipe-delete set-row
interaction, unbounded default exercise history loading, Stats toggle sizing,
and matching UI docs/tests.
