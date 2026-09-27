---
task_id: M27-T05-Configure_exercises_and_bodyweight_logging
milestone_id: M27
status: in_progress
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/00-product.md, docs/specs/05-data-model.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/components-catalog.md, docs/specs/ui/screen-map.md"
---

# M27-T05 — Configure exercises and bodyweight logging

- Status: `in_progress`
- Depends on: M27-T02, M27-T03.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D1, D2, D5, D7.

## Objective and scope

Make load meaning explicit in exercise setup and the set logger while preserving
legacy training data. Read AGENTS.md, specs 02/03/05/08/09, bodyweight contract,
UI index/policy and the import contract if import handling changes. Refresh the
catalog/import/seed inventory and HEAD; read test-directory READMEs before edits.

## Deliverables and acceptance

1. Extend exercise validation/editor fields for bodyweight contribution and
   movement/loading convention, independently of total/per-side external input.
   Enforce T01's allowed combinations, not equipment-name guesses.
2. Use reviewed seed IDs for 100% pull/chin-ups and parallel-bar dips, 70%
   standard push-ups, and 0% conventional exercises. Do not assign 70% to every
   push-up variant or 100% to machine dips. Preserve user-customized metadata.
3. Inventory existing/imported weight semantics and implement the review path:
   clearly choose added/assisted load versus already-total load before activating
   bodyweight calculations for ambiguous history. Preview any conversion, preserve
   the original values for review, and never silently double-count B. If B is
   unavailable for conversion, leave affected values unresolved and unranked.
4. Label the logger's input Added weight or Assistance and retain positive numeric
   entry. Unweighted is explicit zero after existing blank canonicalization.
   Preserve actual/planned modes through copy, autosave, completion and edits;
   confirming a row still requires the existing explicit action.
5. Coefficient edits explain retroactive personal recalculation. A materially
   different movement uses a separate exercise; edits do not change group rules.
   Unknown band assistance receives no invented numeric conversion.

## UX Contract

Target: T01's bodyweight brief, using existing exercise editor/logger targets.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Configure exercise | Open editor → select bodyweight contribution/loading method → save | Clear input meaning and previewed calculation | Invalid combination/coefficient explained inline; values retained |
| Log set | Open row → choose Added weight or Assistance → enter amount/reps → confirm | BW-only, weighted and assisted sets preserve their meaning | Missing B permits logging but dependent metrics remain unavailable |
| Resolve old logs | Enable BW semantics on an existing exercise → review old entry meaning and any conversion → apply | Only reviewed data is converted/activated | Cancel preserves raw data; missing context blocks unsafe conversion |

Reuse ExerciseCoreFields and logger recipes plus shared UI tokens/fields/sheets;
no raw style exceptions proposed. Capture BW-only/added/assisted/missing/invalid
and legacy review states; attach comparisons and interaction evidence to the PR.

## Verification and closeout

Test seeds for fresh/existing/custom users, import round-trips, ambiguous entries,
planned versus actual, confirmation eligibility and external-mode restoration.
Run `./boga test fast`, `./boga test backend`, `./boga test frontend`; derive
additional lanes with `./boga test for` (including group paths/shared helpers).
Graduate product/load/UX semantics as delivered, attach evidence, mark the
milestone entry complete and delete this card when shipped.


## Local implementation checkpoint

Exercise rules, guarded seed generation, explicit logger metadata, transactionally
revalidated legacy review and versioned import context are implemented locally.
`./boga test fast` passed (171 suites / 2043 mobile tests), as did the backend
aggregate and open-handle lane. Latest sheet accessibility/layout repair also
passed `fast-frontend` (171 / 2043). Evidence:
`/tmp/boga-m27-load-fast.log`, `/tmp/boga-m27-load-backend.log`,
`/tmp/boga-m27-load-fast-frontend-fit.log`.

The default 402×874pt phone passed both `ios-bodyweight` flows. Captures are in
`apps/mobile/artifacts/maestro/M27-load/20260926-225742-11336/` (BWL00–BWL10):
invalid coefficient, clear source interpretation, conversions, BW-only/added/
assisted/unquantified logging, restart restoration and missing-B correction.
The review remains inside one native sheet: this fixes the observed loss of
accessibility controls on return to the workout. Short option labels plus
wrapping descriptions fix the observed truncation in the review choices.

The 375×667pt phone also passed both flows on the final logger layout:
`/tmp/boga-m27-load-small-fit.log`, captures in
`apps/mobile/artifacts/maestro/M27-load-small/20260926-233954-24889/`.
BWL03 and BWL07 were inspected: conversion values/source descriptions wrap and
all three logger mode labels fit. The editor dismisses its keyboard on drag;
the flow waits for scrolling to settle and asserts selected review options.
Restart opens the dev-client URL once from a stopped app. Redundant launch/open
and immediate optional dialog probes caused observed native/AX failures.

The 440×956pt phone passed both flows on the same source:
`/tmp/boga-m27-load-large-fit.log`, captures in
`apps/mobile/artifacts/maestro/M27-load-large/20260926-234538-27299/`.
BWL02 and BWL09 were inspected: review descriptions and the missing-weight
message remain readable, with no clipped controls.

The final default-device repeat passed at `e2bc65ba`:
`/tmp/boga-m27-load-resume-ios-bodyweight.log`, captures in
`apps/mobile/artifacts/maestro/M27-load-frontend-resume/20260927-001636-38972/`.
BWL02/BWL07/BWL09 were compared with the native brief: the reviewed meanings,
explicit unavailable metrics and all three mode labels are readable. Historical
records still use their pre-T07 projection at this checkpoint; broad analytics
adoption is the next personal-metrics task.

Every frontend lane passed at `e2bc65ba`. Smoke and data-smoke passed in
`/tmp/boga-m27-load-frontend-fit.log`; UI-regression, exercise-page, session-view,
bodyweight and auth-profile passed in `/tmp/boga-m27-load-resume-<lane>.log`.
The session-completion visibility timeout passed on repeat without an assertion
or app-code change; its failed capture and hierarchy both contained the card.
UI/server sync and both group flows passed in their corresponding resume logs.
Group captures are under `M27-load-frontend-resume/20260927-002744-46246/`
and `20260927-003134-47771/`. `./boga timings` and `./boga test for` ran;
outputs are `/tmp/boga-m27-load-timings-final.log` and
`/tmp/boga-m27-load-test-for-final.log`. No lane was waived and no PR opened.
Completed simulator system logs were losslessly
compressed, with checked SHA-256 hashes recorded in
`apps/mobile/artifacts/maestro/M27-compressed-simulator-logs.json`;
screenshots and active-run logs remain in place.

Offline-upgrade follow-up (2026-09-27): complete actual/planned load review now
allows intentional replacement of unavailable metadata after explicit rule setup.
The UI queues separate unit/meaning choices and rejects partial tuples; ordinary
autosave and concurrent hydration protection remain. Real old-schema migration,
wire/pull and UI coverage is integrated, with BWO00–05 added to the logging flow.
Full fast passed (178 suites / 2,127 mobile tests), including the real upgrade
and independent review vectors, consent-web and MCP checks. Log:
`/tmp/boga-m27-offline-fast-final.log`. Backend and three-size native verification
are pending; this follow-up is not yet complete.

First offline small-phone attempt: entry passed; logging reached the replacement
notice but Preview still had an unkept current selection, so the intended
partial-tuple assertion failed. The remaining flows were covered by the still
open review modal and timed out; their screenshots confirm that cascade. Evidence:
`M27-offline-small/20260927-031048-55068/`, log
`/tmp/boga-m27-offline-small-verified.log`. The flow now checks each chosen
meaning/unit/row and the kept-choice count, and runs the offline scenario first
within logging to diagnose failures earlier. Full native verification remains
pending; no assertion or guard was removed.
