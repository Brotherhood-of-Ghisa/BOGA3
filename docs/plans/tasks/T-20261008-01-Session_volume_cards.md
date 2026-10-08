# Session volume cards

- Status: in_progress — implementation pushed; awaiting design review
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
- Try a symmetric linear scale with the median at the center. Include the
  current reading in its extent so outliers remain visible. This compresses
  the interquartile interval when the current reading is far from the median.
- With fewer than six prior observations, show the current volume and a quiet
  Building history label in its value row. The user selected this option.
- Keep the set count directly beside the exercise or muscle name, consistent
  across low-data and data-rich cards. Unavailable volume has no history label.
- Keep this card current with the latest requirements, without a decision log.

## Design target and UX contract

Repo-native brief: the requirements above, using the existing card, theme,
typography, and exercise/muscle selector. The low-data choice is settled;
the centered scale and overall design remain subject to the user's review.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Read volume | Open session Summary or the live comparison; switch By exercise / By muscle | Current volume with sets beside the name; at six prior observations, P25/median/P75 with a current dot | Fewer observations show Building history; unavailable volume stays dashed without the label |
| Compare unusual volume | Read a card below P25 or above P75 | Median stays centered; the current dot stays visible on the same linear scale | Crowded annotations show only Median and its value; equal quartiles collapse to a line; identical current and history overlap naturally |
| Share summary | Open Share from completion | The same card semantics in the captured image | Existing share errors and privacy rules remain intact |

## Delivery

- Commit and push major changes.
- Do not run tests or open a PR until the user approves the design and is
  happy to proceed. Update Jest coverage now; leave it unrun.
- At that point, agree the slower lane set and run the fast and quality gates
  plus the agreed device lanes before opening the PR.
- Review the rendered browser options and native card preview now. Capture
  the accepted states on small/large phones in their session routes before
  closeout; the standalone previews do not complete device acceptance.
- Delete this card when the work ships; preserve lasting behavior in the
  component, tests, and owning product/spec documentation.
