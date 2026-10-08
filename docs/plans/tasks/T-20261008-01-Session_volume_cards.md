# Session volume cards

- Status: in_review — implementation, human review and agreed checks complete
- Branch: `codex/session-volume-quartiles`
- Areas: frontend; UI impact: yes

## Objective and current requirements

Update the session-summary volume cards in both By exercise and By muscle,
including the live comparison and share surfaces that reuse the card.

- Replace P5/P95 calculations and labels with P25/P75.
- Use the black dot for the current volume; vertical lines for P25, median,
  and P75. Highlight the interval between the quartiles.
- Center each P25, Median and P75 label above its own vertical marker, with
  its value directly below. If the annotations would overlap or run beyond
  the bar, show only Median and its value; retain the markers and current dot.
- Remove prior-session subtitles and redundant comparison footnotes.
- Show the percentile comparison only after six known prior comparable
  sessions, matching the weekly heatmap's observation cutoff via one shared
  constant. The cutoff gates both the chart and the median delta. Preserve the
  existing history scope and eligibility, including genuine zero observations.
- Use a symmetric linear scale with the median at the center. Include the
  current reading in its extent so outliers remain visible. This compresses
  the interquartile interval when the current reading is far from the median.
- With fewer than six prior observations, show the current volume and a quiet
  Building history label in its value row. The user selected this option.
- Keep the set count directly beside the exercise or muscle name, consistent
  across low-data and data-rich cards. Unavailable volume has no history label.
- Keep this card current with the latest requirements, without a decision log.

## Design target and UX contract

Repo-native brief: the requirements above, using the existing card, theme,
typography, and exercise/muscle selector. The user approved the rendered
design, including the low-data state and centered scale.
Only the approved card wording ships: name, sets, Vol, median delta,
P25 / Median / P75 and Building history. Add no headings or explanatory copy.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Read volume | Open session Summary or the live comparison; switch By exercise / By muscle | Current volume with sets beside the name; at six prior observations, P25/median/P75 with a current dot | Fewer observations show Building history; unavailable volume stays dashed without the label |
| Compare unusual volume | Read a card below P25 or above P75 | Median stays centered; the current dot stays visible on the same linear scale | Crowded annotations show only Median and its value; equal quartiles collapse to a line; identical current and history overlap naturally |
| Share summary | Open Share from completion | The same card semantics in the captured image | Existing share errors and privacy rules remain intact |

## Delivery

- Commit and push major changes.
- Design and human code review are approved; the agreed checks are green.
- Agreed lane set: fast, jest-coverage, complexity, dependencies,
  ios-data-smoke and ios-session-view. The last two cover completion/share
  and the session view; other frontend-ui lanes are outside this card change.
- Browser and native screenshots match the approved target; no material
  design deviations. Actual session routes were checked on small/large phones.
- Delete this card when the work ships; preserve lasting behavior in the
  component, tests, and owning product/spec documentation.

## Validation

Production code checked at `f2306e9d`; subsequent changes only update docs.
Local evidence is under `apps/mobile/artifacts/volume-cards-preview/`.

| Agreed lane | Result | Evidence file |
| --- | --- | --- |
| fast | Pass, including 251 mobile Jest suites / 3,377 tests | `fast-final.log` |
| jest-coverage | Pass: branches 86.61%, lines 94.20% | `coverage-final.log` |
| complexity | Pass; retired the card's old exemption | `complexity-final.log` |
| dependencies | Pass; no new violations | `dependencies-final.log` |
| ios-data-smoke | Pass: runtime smoke, completion/share, catalogue | `ios-data-smoke.log` |
| ios-session-view | Pass: session view | `ios-session-view.log` |

Additional docs-check passed (`docs-check-final.log`). Product review: clean;
the approved behavior is owned by `session.volume-comparison`.
The operator agreed to narrow frontend-ui to the two relevant iPhone lanes;
the other flows and release sweep are outside this card change.

Native evidence under `native/` uses iPhone 17e (390 × 844) and iPhone 18 Pro
Max (440 × 956), iOS 27, with isolated fixture data:

- `small-summary-exercise.png`, `small-summary-muscle.png`,
  `large-summary-exercise.png`, `large-summary-muscle.png`: rich and low-data
  cards in historical Summary, both groupings.
- `small-compare-exercise.png`, `small-compare-muscle.png`: full references
  in the comparison route, both groupings.
- `small-live-exercise.png`, `small-live-muscle.png`: active-session comparison
  with the selected low-data state and sets beside each name.
- `large-compare-outlier.png`, `large-compare-muscle-outlier.png`,
  `large-compare-zero.png`: median-only crowded annotations and equal zero
  references, with current and median positions retained.
- `small-compare-unavailable.png`: unavailable Volume has no history label.

Completion and captured share-image evidence is in
`apps/mobile/artifacts/maestro/session-volume-cards/20261008-212548-94658/`;
the session-view lane is in the sibling `20261008-213147-10938/` directory.
Screenshots remain ignored artifacts; no new Maestro flow was added.
