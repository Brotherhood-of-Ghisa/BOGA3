# Progress muscle heatmap — implementation target

## UX contract

- Existing Progress Muscle view: replace its table with the boxed heatmap below the existing three filter chips, using the existing page scroll. Keep Exercise and Sessions unchanged.
- Every muscle activation selects it and reveals one contribution table below the map without scrolling. Repeated activation stays in Progress. The contribution header places the existing three compact history-icon buttons to the right of the name: Timeline, Daily Heatmap and Weekly Heatmap. Each opens that view with the selected metric.
- Contributor activation opens its exercise Timeline. All links carry the metric and use view entry overrides without writing the saved history view. Native back preserves Progress and restores accessibility focus.
- Families retain exact reference-model rectangular areas. Readability changes remain inside each family. All 25 muscles remain, including zeros. No anatomical percentages, subtitles, footnotes or Total row.
- Existing loading, failed read/Retry, empty contributions, accounting and formatting remain. Families are inert. Tile selection is conveyed accessibly and by the named contribution panel; no tile caret.

## Design target

[Boxed reference](assets/progress-muscle-map.png), amended by the approved UX contract above. Existing app tokens, native chrome and filter controls govern integration. The 2026-10-18 user-requested interaction revision overrides the target's selection marker and prior two-activation navigation. Research-source/mapping details live with the presentation constants; no research text appears in the app.

## Validation

Agreed: fast, ios-data-smoke, jest-coverage, complexity, dependencies. Jest proves geometry, figures, taps, entry override and restoration; simulator screenshots prove small/standard/large phone layout and touch/scroll integration. No new committed Maestro scenarios. The operator approved a temporary native capture script on 2026-10-17. Evidence and deviations are recorded in the PR and generated artifacts.


## 2026-10-18 — optional heatmap

Target amendment from the product owner: the existing muscle list is the default;
a pinned List / Heatmap filter opts into the map. The existing screenshot target
continues to govern the map itself.

UX Contract: open Muscle → list with inert family bands and Now / Prev / Change;
name opens saved history, chevron discloses inline contributors. Change the layout
filter → map, retaining metric, period and selected muscle, starting at the top.
The map keeps its contributions and three history links. Switch back → list with
selection intact. Return from history → chosen layout and scroll intact. Fresh
launch/account → list. Exercise breakdown is unchanged. No persisted layout setting.
Both presentations share contribution rows, formatting and empty states.
