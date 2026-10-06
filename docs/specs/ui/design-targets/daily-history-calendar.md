# Accepted target — daily history calendar

**Status: accepted design; implementation pending.** Approved by the operator
on 2026-10-06, including the final amendments below. This record governs the
Daily chart in both muscle and exercise history.

## Target and authority

- [Layout reference](daily-history-calendar/reference.png): Product
  Design / ImageGen revision `exec-f7732201-c46f-4a94-a51a-2052d04462f1`.
  Only the accepted image is retained; earlier proposals remain outside the repo.
- Mobile portrait, nominal **390 × 844pt**, illustrated in Warm. Dates and
  figures are examples anchored to Tuesday 6 October 2026, not fixtures or a
  fixed palette. All colours follow the active theme.
- When integrating this chart, load [design language](../design-language.md)
  for tokens and formatting, and [heatmap semantics](../../../../apps/mobile/components/heatmaps/README.md)
  for calculations, target grading, availability and saved preferences.
- The reference governs the calendar and tile layout. The read-only and
  metric-colour amendments below supersede its black outlines and active
  metric fill. The
  current [history container](history-popup.md#amended-container-2026-10-06)
  governs the host: keep its shared PageSheet and dismissal controls. The
  image's older full-height shell and dismissal hint do not amend that contract.

## Approved brief

- Stack calendar months vertically, newest month first; each month uses
  Monday–Sunday columns and an eighth **Week** column. Older history is reached
  by vertical scrolling, without horizontal scrolling.
- Every day and week is a tile. The Week header has no metric subtitle, and
  weekly tiles contain the formatted value on a full heat background, without
  a bar or progress track.
- Each Week tile uses the same week's metric value, formatting, heat colour
  and availability semantics as the weekly heatmap. Keep the existing sum/best
  aggregation and independent colour meaning; do not introduce a universal
  percentage score. A week crossing a month boundary retains its full
  Monday–Sunday value in either month where it appears.
- Show metric values inside the tiles. Rest tiles have no **Rest** text;
  genuine zero remains numeric zero. Unavailable/incomplete data retains its
  distinct existing meaning instead of becoming rest.
- Show the day-of-month number only in Monday tiles. Full dates remain in
  accessible labels. Adjacent-month dates have lower emphasis; future daily
  tiles carry no training value, and future weekly tiles have no observed score.
- Remove the selected-value box above the Daily chart. Tiles are read-only,
  with no day/week selection or black today/current-week outlines. Keep the
  accessible today/current-week wording and availability markings.
- Preserve the existing target heading, metric options, saved view/window
  caption and Settings-owned Daily/Weekly choice. Apply the shared layout to
  both history kinds and every supported metric.
- The active metric box uses the theme's `accent` fill and `surface` text,
  replacing the black fill. The palette gates this pair at ≥4.5:1 across
  presets and custom hues; selection remains announced accessibly.
- Retain full figures, theme tokens and at least 44pt interactive targets.
  Resolve small-phone or long-value fit during integration; do not clip,
  abbreviate or split a figure's digits to imitate the mock.

## UX contract for implementation

| Flow | Trigger and steps | Success / edge outcome |
| --- | --- | --- |
| Browse Daily history | Open a muscle or exercise history in saved Daily mode; scroll through months. | All history in the saved window is reachable. Loading, retryable error and empty states share the active body. |
| Read a day | Read its tile or focus it with VoiceOver. | Its value is visible directly and its full date is announced accessibly. Rest, zero, unavailable and future remain distinct. |
| Read the week | Read the eighth tile or change the active metric. | The tile matches that calendar week's weekly heatmap result and colour, including partial current weeks and cross-month weeks. |

## Verification before shipping

**Read-only amendment, approved 2026-10-06:** the operator removed pointless
day selection and the black borders because tapping revealed no additional
information. This applies to both day and Week tiles in the Daily calendar;
the separate Weekly view retains its selection and detail banner.

**Metric-colour amendment, approved 2026-10-06:** the operator replaced the top
metric control's black active box with a high-contrast theme colour. This
applies to both history kinds in Daily and Weekly modes. The reference's black
active metric fill predates this amendment.

The reference shows exercise Volume, adjoining-month days, future cells and
weekly tiles. Its Monday 5 October selection and Tuesday 6 October outline
predate this amendment. It is design evidence, not an implemented screen or
runtime-test result.

Implementation must add/update Jest coverage and compare native captures with
this target for muscle/exercise history, supported metrics, theme changes,
read-only tiles, rest/zero/unavailable states, month/year boundaries, short/long
look-back and small/large phones. Agree the implementation lane set with the
operator under the quality gates before running lanes beyond fast. Record
intentional differences and runtime evidence in the implementation PR.
