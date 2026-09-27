# Bodyweight entry and comparison — implementation target (M27)

**Status: dated-reading and added-weight simplification accepted by the user on 2026-09-27; focused native verification passed on three phone sizes.** Existing captures govern the visual recipes;
older screenshots document their original implementation and are not evidence
that the dated-reading behavior passed.

## Accepted dated-reading revision — 2026-09-27

The user accepted this repo-native brief and the existing reference captures
below. Existing Settings, View Session, logger and group recipes govern layout.
This revision supersedes frozen-weight/correction/fill interactions below; those
older rendered captures document the previous implementation only.

- Settings retains dated add/edit/delete and reading history, with required
  date/time. Remove historical fill and warnings about effects on past workouts
  or group results. Save/delete feedback names only the completed action.
- Session weight is a read-only derived fact: kg and “Reading from <date/time>”.
  No session-only override. Missing context reads “No reading on or before this
  session” with “Add dated reading”, prefilled at the session start instant.
  The dated form stays editable.
- Friend sessions show source context without entry/edit actions. The logger
  keeps added weight, kg/lb, reps, effort and confirmation; removes all assistance
  choices and legacy conversion. Existing weights mean added weight. Volume and
  RM use total load; RM results subtract body contribution and display added weight.
- Capture the focused native path: a dated reading changes RM and volume
  from unavailable to calculated values on the supported phone sizes. Compare typography, spacing, source clarity and action visibility with
  the selected references; preserve every independent logging action.

The one-flow native path passed at 375×667pt
(`artifacts/maestro/ad-hoc/20260927-190736-37314`), 402×874pt
(`artifacts/maestro/ad-hoc/20260927-185542-77483`) and 440×956pt
(`artifacts/maestro/ad-hoc/20260927-190919-38582`). Its before/after
screenshots show the missing-reading action, then an 82 kg dated reading and
the same 20 kg × 8 set at 48.2 kg added 1RM and 816 kg volume. Source date,
labels and set controls remained readable without clipping at all three sizes;
there were no material deviations from the accepted layout recipes. These
runtime artifacts stay outside Git.

## Target and authority

- Settings/history: [More and Settings](more-settings.md).
- Read-only session context: [View Session](view-session.md).
- Exercise metadata: [catalogue and editor](exercise-catalogue.md).
- Added-weight logging and projection: [exercise/session](exercise-session-v5.md).
- Group standards/linking: [group exercise linking](group-exercise-unlink.md)
  and current [group recipes](../ux-rules.md).
- Behavior/calculation: [bodyweight contract](../../tech/bodyweight-load-contract.md).
- Shared tokens, field/sheet/list semantics and accessibility stay governed by
  [design language](../design-language.md), [UI rules](../ux-rules.md) and
  [design policy](../ai-design-policy.md). No external design service is required.

## Brief

- Keep `paper`, PageHeader, micro section labels and Card/ListRow hierarchy.
  Use existing FormField, SegmentedControl, Sheet, Notice and StatePanel. Numeric
  values use the existing mono face; explanation and source dates use muted text.
- Add a Body weight row to Settings with latest value, explicit unit and date,
  or `No weight recorded`. The destination contains dated entry and history. Local/offline saves use the normal sync domain.
- Show session weight as a named fact with source/date, never embedded invisibly
  in set weights. Show `Reading from <date/time>` beside derived kg. Missing
  context links to a dated form prefilled with the session start.
- Keep the logger's in-place editing and one confirmation control. A bodyweight
  exercise labels its value `Added weight`; B and effective load
  are secondary context. Use `Unavailable · session weight missing` with a
  dated-entry action and unavailable metrics. Valid reps remain loggable.
- Boards retain podium/list/record-sheet recipes. Metric names include units
  (Reps, Relative strength ×BW, Absolute strength kg), alongside Certified/All.
  The declared group standard is visible. Rebuilding and unavailable scores are
  textual states; offline uses the accepted offline recipe, not an error color.

## Flows and required rendered states

| Flow | Trigger and steps | Success | Failure / edge evidence |
| --- | --- | --- | --- |
| Record reading | More → Settings → Body weight → value/unit/date → Save | Latest reading and history update; next session uses it | Blank/0/negative/nonfinite input stays editable; offline local save; empty history |
| Inspect session | View Session → read kg/source; if missing → Add dated reading | Applicable reading changes dependent history | Missing/invalid reading, save failure, friend context read-only |
| Configure/log | Exercise editor → contribution/standard/loading method → Save → logger amount/reps → Confirm | Bodyweight-only and added values retain meaning | Invalid coefficient/combination, missing B, planned/unperformed row |
| Project load | Exercise records → Loading estimate → target reps and B | Added-weight RM estimate and total-load context both labelled | No valid historical estimate, missing target B, target requiring assistance, invalid reps, high-rep estimate; one-rep convention explained |
| Compare | Groups → board's default metric → switch metric/scope → record detail | Correct reps/×BW/kg, added kg/%BW, source B/provenance | Empty/unavailable, cached offline, rebuilding/stale cursor, former/archived legacy revision |
| Set group standard | Admin exercise editor → coefficient/standard/method/default → preview impact → Save | Rules revision shown; entire board publishes together | Member cannot edit; offline write retains form; incompatible link explained |
| Certify | Record detail → inspect attested inputs/source → Certify | Attested metric dependencies and certifier shown | Applicable reading is explicit; self-certification denied; reading-change invalidation; reps-only survives B-only edit |

Loading projections distinguish raw estimates from any plate rounding. No new
primary accent is added to the Settings overview or the read-only set row.

## Reference captures and verification

Capture baseline from `a34708c0` with `TASK_ID=M27-baseline`, the isolated
worktree simulator and the existing Maestro flows. Select existing Settings,
exercise editor and View Session captures; use the committed group link
reference below for the group treatment. These illustrate existing accepted
recipes only, **not rendered M27 states or their visual acceptance**.

The selected captures are from `M27-baseline/20260926-182813-13085`, BOGA wt1,
iOS 26.4, 402×874pt (1206×2622 pixels, 3×), light. Settings and editor flows
passed. The session capture was taken before the same flow later encountered
an XCTest `viewHierarchy` HTTP 500; it is valid visual reference, not evidence
of a green session flow. The full `TASK_ID=M27-foundation ./boga test frontend`
rerun subsequently passed at `0f0ec368`, including that completion flow, on the
same device. Logger and board references below come from this green run
(`20260926-185543-38596` and `20260926-190504-46947` respectively).

| Reference | Existing state / source |
| --- | --- |
| [Settings](bodyweight/settings-reference.png) | Settings preferences; `ios-ui-regression` |
| [View Session](bodyweight/session-reference.png) | View Session facts/Summary; `ios-ui-regression` |
| [Exercise editor](bodyweight/editor-reference.png) | Exercise editor; `ios-ui-regression` |
| [Logger](bodyweight/logger-reference.png) | Confirmed and planned set rows with active editing; `ios-exercise-page` |
| [Group board](bodyweight/board-reference.png) | Existing All / 1RM board; `ios-groups-e2e` |
| [Group exercise reference](group-exercise-unlink/baseline-group.png) | Existing group exercise list; accepted group-link target |

Capture every relevant flow above in the running app, at baseline phone
width plus a smaller and larger supported phone layout for new dense forms,
preview lists and boards. Record actual device/viewport, screenshot paths and
material deviations in the PR. Keep runtime comparisons under the gitignored
Maestro artifact tree. Reference captures are the only selected stills committed
here; no speculative M27 mockup is treated as evidence.

## Rendered implementation comparisons

App/server source: `b636f234` (integrates `origin/main` at `8b5c47c1`). Later
commits adjust Maestro gestures and documentation without changing runtime
behavior. Captures and `visual-review.md` comparisons remain under
`apps/mobile/artifacts/maestro/`, as required above.

| Layout | Personal forms, review, backfill and analytics | Group boards and actual API outage |
| --- | --- | --- |
| Small, 375×667pt | `M27-merged-small/20260927-123024-51355`, `M27-small-editor/20260927-124806-63030`, `M27-small-final/20260927-134013-94101`, `M27-small-logging-recovery/20260927-135422-98663` | `M27-merged-small/20260927-121530-37307`, `20260927-122152-39234`; `M27-network-small/20260927-122313-40437` |
| Baseline, 402×874pt | `M27-review-viewport/20260927-112539-413` | `M27-review-viewport/20260927-115139-11377`, `20260927-115956-13621`; `M27-network-baseline/20260927-120516-16517` |
| Large, 440×956pt | `M27-large-bodyweight-final/20260927-131619-80994`, `M27-large-entry-final/20260927-133637-90619` | `M27-merged-large/20260927-125834-66605`, `20260927-130700-68964`; `M27-network-large/20260927-130833-70173` |

The comparisons record source/provenance labels, explicit missing or partial
coverage, independently reviewed actual/planned loads, unit-aware estimates,
relative/absolute ranking reversal, rules revision and attestation changes.
Outage captures use the real isolated API gateway and verify that a failed
publication retains input without changing the server revision. Small and
large invalid-coefficient captures show the entered 101, its 0%–100% error and
the fixed Save control. Failed attempts remain in their artifact roots and are
not counted as successful flows; transition frames are not layout evidence.

## Resolved conflicts with earlier targets

- Exercise/session v5 says numbers are always shown. M27 requires load-dependent
  numbers to be unavailable when context is missing; keep the column structure
  and show an unavailable label, never a fabricated 0. Planned rows can display
  a labelled projection but cannot enter performed aggregates.
- Current group recipes use Weight/e1RM and a Certified 1RM podium default.
  Conventional exercises retain them; bodyweight exercises use the explicit
  metric default and three unit-aware boards from the new domain contract.
- Current View Session summary uses entered weight × reps. M27 switches eligible
  bodyweight rows to effective resistance and carries incomplete coverage through
  comparisons. The Card and Summary/Sets layout remains the reference.

These are behavioral changes explicitly requested in M27; the existing visual
targets govern layout, not the previous load semantics.
