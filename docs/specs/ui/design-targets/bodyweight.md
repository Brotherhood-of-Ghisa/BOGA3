# Bodyweight entry and comparison — implementation target (M27)

**Status: repo-native brief for planned behavior.** The user requested the M27
milestone on 2026-09-26. That authorizes its behavioral scope; it does not imply
visual acceptance of screens that have not been rendered. Existing accepted
targets below govern their visual language. New-state captures and comparisons
are required before the corresponding UI work is complete.

## Target and authority

- Settings/history: [More and Settings](more-settings.md).
- Session snapshot/correction: [View Session](view-session.md).
- Exercise metadata: [catalogue and editor](exercise-catalogue.md).
- Added/assisted logging and projection: [exercise/session](exercise-session-v5.md).
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
  or `No weight recorded`. The destination contains the entry and history plus
  `Fill missing session weights`. Local/offline saves use the normal sync domain.
- Show session weight as a named fact with source/date, never embedded invisibly
  in set weights. `Estimated from <date>` remains visible beside estimated kg.
  Explicit correction opens a sheet without changing the Settings reading.
- Keep the logger's in-place editing and one confirmation control. A bodyweight
  exercise labels its value `Added weight` or `Assistance`; B and effective load
  are secondary context. Use `Unavailable · session weight missing` with a
  correction route rather than a zero metric. Valid reps remain loggable.
- Boards retain podium/list/record-sheet recipes. Metric names include units
  (Reps, Relative strength ×BW, Absolute strength kg), alongside Certified/All.
  The declared group standard is visible. Rebuilding and unavailable scores are
  textual states; offline uses the accepted offline recipe, not an error color.

## Flows and required rendered states

| Flow | Trigger and steps | Success | Failure / edge evidence |
| --- | --- | --- | --- |
| Record reading | More → Settings → Body weight → value/unit/date → Save | Latest reading and history update; next session uses it | Blank/0/negative/nonfinite input stays editable; offline local save; empty history |
| Inspect/correct session | View Session → Body weight → inspect source → Correct → preview impact → Save | Session tuple changes; reading history stays unchanged | Unknown/estimated source, deleted source reading, save failure, active session stays fixed after new weigh-in |
| Fill history | Settings → Fill missing session weights → range/selection → Preview → Apply | Count and each source date shown; estimated later-reading fallback explicit; progress/result | No readings, no matches, invalid range, stale preview, row filled meanwhile, repeat operation |
| Configure/log | Exercise editor → contribution/standard/loading method → Save → logger mode/amount/reps → Confirm | Bodyweight-only, added and assisted values retain meaning | Invalid coefficient/combination, unknown band assistance, missing B, planned/unperformed row |
| Review legacy | Enable bodyweight exercise → select rows → inspect original values/units and interpretation → Preview → Apply | Explicit conversion or confirmation only; unavailable saved metadata offers Sync first or intentional full-tuple replacement, with independent actual/planned choices | Unknown unit, missing B, partial review refusal, cancel/no writes, unresolved rows stay unranked |
| Project load | Exercise records → Loading estimate → target reps and B | Total estimate and positive added/assistance amount both labelled | No valid historical estimate, missing target B, invalid reps, high-rep estimate; one-rep convention explained |
| Compare | Groups → board's default metric → switch metric/scope → record detail | Correct reps/×BW/kg, added kg/%BW, source B/provenance | Empty/unavailable, cached offline, rebuilding/stale cursor, former/archived legacy revision |
| Set group standard | Admin exercise editor → coefficient/standard/method/default → preview impact → Save | Rules revision shown; entire board publishes together | Member cannot edit; offline write retains form; incompatible link explained |
| Certify | Record detail → inspect attested inputs/source → Certify | Attested metric dependencies and certifier shown | Estimated B is explicit; self-certification denied; correction invalidation; reps-only survives B-only edit |

Backfill preview is a selectable list, with a summary count and one primary
Apply action. A date/weight/source label is present on each affected row.
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
