# Copy

### copy.no-subtitles · principle · accepted

Screen, sheet, card and section titles stand alone: no descriptive line beneath.

- **Test:** remove lines describing the thing; retain data: dates, durations,
  counts, `3 sets · 1RM 102.5`.
- **Bad:** "Your training at a glance" under `Today`.
- **Good:** `06-10-2026 · 52 min` under a session title.
- **Kept:** `<group> · group view` identifies otherwise-unknown ownership
  above group session titles (decided 2026-10-08).

### copy.no-inline-explanation · principle · accepted

Screens show data and controls: no explanatory footnotes, formulas, hints,
tutorials or rule provenance (`Rules N · …`).

- **Test:** replace explanations with clearer labels/design.
- **Exceptions:** a Settings section's one-line footnote stating when a change
  applies or its status (`System follows the phone’s mode`, `Off by default while we try it` under Experiments); an error line with its
  action; an empty state's one line, never a tutorial; a destructive alert naming what goes (`its N sets`); the
  agent-consent page's grant; the explicitly opened RM curve and Counting explainers.
- **Incomplete figures:** plain `Volume`, even when excluding uncalculable
  loads or kg a group cannot see.
- **Bad:** `Sets = primary + ½ secondary` under Sets by muscle.
- **Good:** `% of target` ramp: `0%`…`100%` ([[comparison.colour-scale]]).

### copy.blank-history · presentation · accepted

Figures without training (rest or outside the data) stay blank: no `Rest`,
`?`, dash or zero. Known zero stays numeric. Accessibility distinguishes rest,
unavailable and known zero.

Recovery family tiles show the numeric sum, including zero when no child
contributes; absent individual-muscle cells stay blank.

Why: distinguish missing data from measurements.
Code: `apps/mobile/components/heatmaps/calendar-tile.tsx`; `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`.

### copy.no-weight-unit · presentation · accepted

While kg is the sole weight unit, visible/spoken labels omit kg/kilograms,
including compound volume units. Retain `per side` and `%BW`. Stored
values, wire units and coaching/import payloads stay unchanged.
Today's weekly box and pace chart may show Volume in metric tonnes: `Tons`
in the weekly heading, `t` beside chart figures, spoken as tonnes. Display
tonnes rounded to one decimal place with trailing zeros removed.
Exercise names carry no generated unit suffix. Group percentage figures retain
small `%BW` units beside the value or in its column heading, including Volume. Shared-session set rows
abbreviate these to `%` with the existing inline metric labels and no column
headings. Spoken figures retain complete units.

Code: `apps/mobile/src/groups/competition-view-model.ts` and mobile label components.

### copy.calendar-dates · presentation · accepted

Date format pairs numeric, yearless short and compact named-month forms,
including Today. Compact days are unpadded; only year-first compact dates use
four-digit years. Spoken/edited dates stay full numeric; images follow
visible presentation. Preserve local days, stored instants and month-only,
weekday, relative and time-only roles.

| Date format | Yearless short | Compact complete |
| --- | --- | --- |
| `DD-MM-YYYY` | `17 Sep` | `17 Sep 26` |
| `MM-DD-YYYY` | `Sep 17` | `Sep 17 26` |
| `YYYY-MM-DD` | `Sep 17` | `2026 Sep 17` |

Compact timestamps append 24-hour time. Ranges share month/year where possible;
cross-year endpoints retain both years.

Calendar-week headings retain selected order and only the end date's four-digit
year, even across New Year.

- **Exception — schedule picker:** iOS uses preference-mapped
  locales with abbreviations and omitted years; Android uses system
  date order and language. App-owned labels follow Date format.

Code: `apps/mobile/src/utils/local-time.ts`.
